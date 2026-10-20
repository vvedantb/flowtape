/**
 * Node only. Scans saved flowtape files for personal data and secrets that redaction left behind, so a commit
 * hook can stop them. Findings never print the suspect text in full.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REDACTED, isExampleEmail, scrubText } from './redact';

export type AuditSeverity = 'error' | 'warning';

export interface AuditFinding {
  severity: AuditSeverity;
  /** `pattern`, `invalid-json`, `name`, `date-of-birth`, `address`, `unmasked-field` or `screenshots`. */
  kind: string;
  file: string;
  /** A JSON path (`events[3].value`) for JSON files, a line number for text files. */
  where: string;
  message: string;
}

export interface AuditOptions {
  /** Files or folders to scan. Default: the nearest `.flowtape/` at or above `cwd`. */
  paths?: string[];
  cwd?: string;
  /** Files already read, such as staged content. Replaces `paths`. */
  files?: AuditSource[];
  /**
   * Exact strings to ignore. Default: lines of `.flowtape/audit-allow.txt`, when it exists. A script's path, relative to
   * `.flowtape/` or to the folder that holds it, accepts that script's screenshots.
   */
  allow?: string[];
}

export interface AuditSource {
  /** Absolute path. */
  file: string;
  text: string;
}

const SCANNED = /\.(json|jsonl|md|ts)$/;

/** Titles before a surname, and common UK given names before a capitalised word. Heuristics: warnings, not errors. */
const TITLE_NAME = /\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\.? [A-Z][a-z'-]+(?: [A-Z][a-z'-]+)?\b/g;
const GIVEN_NAMES = new Set(
  (
    'Aaron Abigail Adam Adrian Aisha Alan Albert Alex Alexander Alfie Alice Alison Amelia Amy Andrew Angela Ann Anna Anne Anthony Arthur Ava Barbara Ben Benjamin Beth Betty Bill Brian Carol Caroline Catherine Charles Charlie Charlotte Chloe Chris Christine Christopher Claire Colin Daniel David Deborah Dennis Diane Donald Dorothy Edward Eileen Elizabeth Ella Ellie Emily Emma Eric Ethan Evelyn Frank Freddie Gary George Grace Graham Hannah Harry Harvey Hazel Helen Henry Ian Isabella Isla Jack Jacob Jacqueline James Jane Janet Jean Jennifer Jessica Joan Joe John Jonathan Joseph Joshua Joyce Julie Karen Kate Katherine Kathleen Keith Kenneth Kevin Laura Lauren Leo Lily Linda Lisa Liam Lucy Margaret Maria Marie Mark Martin Mary Matthew Megan Michael Michelle Mohammed Muhammad Nancy Nicholas Nicola Noah Olivia Oliver Oscar Pamela Patricia Patrick Paul Pauline Peter Philip Poppy Rachel Raymond Rebecca Richard Robert Ronald Rose Ruby Ryan Samuel Sandra Sarah Sharon Shirley Sophia Sophie Stephen Steven Stuart Susan Thomas Tom Tony Valerie Victoria William Zara'
  ).split(' '),
);
const CAPITALISED_PAIR = /\b([A-Z][a-z]+) ([A-Z][a-z'-]+)\b/g;
const ADDRESS = /\b\d{1,4}[A-Za-z]? (?:[A-Z][a-z]+ ){1,3}(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Drive|Way|Court|Crescent|Place|Gardens|Terrace|Grove|Hill|Park|Row|Square|Mews)\b/g;
/** An old date in a value: dates of birth. Recent dates (appointments, start dates) are left alone. */
const OLD_DATE = /\b(?:(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](19\d\d|200\d|201[0-5])|(19\d\d|200\d|201[0-5])-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/g;
/** Field labels that usually hold personal data. A stored value under one of these deserves a look. */
const PERSONAL_FIELD = /\b(?:full ?name|first ?name|last ?name|surname|forename|given name|name|address|street|town|city|postcode|phone|mobile|telephone|e-?mail|date of birth|dob|gender|sex|ethnicity|religion|diagnosis|medication|condition|allergies|care needs?|notes?|comments?|next of kin)\b/i;

/** "Jane Doe" becomes "J*** D**": enough to find it, not enough to read it. Digits are always hidden. */
function hint(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => (/\s/.test(part) ? part : (/\d/.test(part[0]) ? '*' : part[0]) + '*'.repeat(Math.max(0, part.length - 1))))
    .join('')
    .slice(0, 40);
}

function nearestFlowtapeDir(from: string): string | undefined {
  let current = path.resolve(from);
  for (;;) {
    const candidate = path.join(current, '.flowtape');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function filesUnder(target: string): string[] {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return SCANNED.test(target) ? [target] : [];
  return fs
    .readdirSync(target, { withFileTypes: true })
    .flatMap((entry) => filesUnder(path.join(target, entry.name)))
    // Replay failure screenshots are images: they cannot be scanned as text.
    .filter((file) => !file.includes(`${path.sep}replay-failures${path.sep}`));
}

/** Every string in a JSON value with its path, for example `events[3].value`. */
function strings(value: unknown, at = ''): Array<{ at: string; text: string; parent: Record<string, unknown> | undefined }> {
  if (typeof value === 'string') return [{ at, text: value, parent: undefined }];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${at}[${i}]`));
  if (value && typeof value === 'object') {
    const record = Object.fromEntries(Object.entries(value));
    return Object.entries(record).flatMap(([key, item]) =>
      strings(item, at ? `${at}.${key}` : key).map((found) => ({ ...found, parent: found.parent ?? record })),
    );
  }
  return [];
}

/** Pattern hits: text the current redaction rules would change. Catches hand edits and files from older versions. */
function patternFinding(file: string, where: string, text: string): AuditFinding | undefined {
  const scrubbed = scrubText(text);
  if (scrubbed === text) return undefined;
  // Show only the part redaction would replace, masked.
  const start = [...text].findIndex((char, i) => char !== scrubbed[i]);
  return { severity: 'error', kind: 'pattern', file, where, message: `matches a secret or personal-data rule near "${hint(text.slice(start, start + 20))}"` };
}

function heuristicFindings(file: string, where: string, text: string, allow: Set<string>): AuditFinding[] {
  const out: AuditFinding[] = [];
  const add = (kind: string, match: string, what: string) => {
    if (!allow.has(match)) out.push({ severity: 'warning', kind, file, where, message: `looks like ${what}: "${hint(match)}"` });
  };
  for (const [match] of text.matchAll(TITLE_NAME)) add('name', match, "a person's name");
  for (const [match, first] of text.matchAll(CAPITALISED_PAIR)) if (GIVEN_NAMES.has(first)) add('name', match, "a person's name");
  for (const [match] of text.matchAll(ADDRESS)) add('address', match, 'a street address');
  for (const [match] of text.matchAll(OLD_DATE)) add('date-of-birth', match, 'a date of birth');
  return out;
}

/** Steps and events that store what was typed or chosen: flow and history inputs, script `type` and `select` steps. */
const VALUE_TYPES = new Set(['input', 'type', 'select']);

/**
 * Fields whose value is what people type: inputs and checks, not the interface's own labels. A top-level `name` is
 * the title of a flow or script; on a flat history event (it has a `type`) it is a field label.
 */
function isValue(at: string, parent: Record<string, unknown> | undefined): boolean {
  return /(?:^|\.)(?:value|text)$/.test(at) || (at === 'name' && parent?.type === undefined);
}

function auditJson(file: string, doc: unknown, allow: Set<string>, shotsAllowed = false): AuditFinding[] {
  const out: AuditFinding[] = [];
  for (const { at, text, parent } of strings(doc)) {
    if (allow.has(text) || at.endsWith('.screenshots.page') || at.endsWith('.screenshots.target')) continue;
    const pattern = patternFinding(file, at, text);
    if (pattern) out.push(pattern);
    else if (isValue(at, parent)) out.push(...heuristicFindings(file, at, text, allow));
    // A stored value under a personal-sounding label.
    if ((at === 'value' || at.endsWith('.value')) && text && typeof parent?.type === 'string' && VALUE_TYPES.has(parent.type) && parent.redacted !== true && typeof parent.name === 'string' && PERSONAL_FIELD.test(parent.name) && !text.includes(REDACTED) && !isExampleEmail(text)) {
      out.push({ severity: 'warning', kind: 'unmasked-field', file, where: at, message: `"${parent.name}" stored its value. Mask the field (data-flowtape-mask) or use allowlist mode.` });
    }
  }
  const shots = strings(doc).filter(({ at }) => at.endsWith('.screenshots.page') || at.endsWith('.screenshots.target')).length;
  if (shots && !shotsAllowed) out.push({ severity: 'warning', kind: 'screenshots', file, where: 'steps', message: `${shots} screenshot(s). Text rules cannot read images: look at them, or record in allowlist mode.` });
  return out;
}

function auditText(file: string, text: string, allow: Set<string>): AuditFinding[] {
  return text.split('\n').flatMap((line, i) => {
    if (allow.has(line.trim())) return [];
    const pattern = patternFinding(file, `line ${i + 1}`, line);
    if (pattern) return [pattern];
    // Prompts and tests quote what was typed: only those parts are values. Interface text is left alone.
    return [...line.matchAll(/`([^`]+)`|"([^"]+)"/g)].flatMap((quoted) => heuristicFindings(file, `line ${i + 1}`, quoted[1] ?? quoted[2] ?? '', allow));
  });
}

/** Scan saved flows, prompts, e2e drafts, replay scripts and history. */
export function auditFlowtape(options: AuditOptions = {}): AuditFinding[] {
  const cwd = options.cwd ?? process.cwd();
  const base = nearestFlowtapeDir(cwd);
  const allowFile = base && path.join(base, 'audit-allow.txt');
  const allow = new Set(options.allow ?? (allowFile && fs.existsSync(allowFile) ? fs.readFileSync(allowFile, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean) : []));
  // An explicit empty list (nothing staged) scans nothing; no list scans the nearest .flowtape/.
  const targets = options.paths ? options.paths.map((p) => path.resolve(cwd, p)) : base ? [base] : [];
  const sources = options.files ?? targets.flatMap(filesUnder).map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
  return sources.flatMap(({ file, text: raw }) => {
    const shown = path.relative(cwd, file) || file;
    if (file.endsWith('.json')) {
      let doc: unknown;
      try {
        doc = JSON.parse(raw);
      } catch {
        return auditText(shown, raw, allow);
      }
      return auditJson(shown, doc, allow, allowedPaths(file, shown).some((p) => allow.has(p)));
    }
    if (file.endsWith('.jsonl')) {
      return raw.split('\n').flatMap((line, i) => {
        if (!line.trim()) return [];
        try {
          return auditJson(`${shown}:${i + 1}`, JSON.parse(line), allow);
        } catch {
          const invalid: AuditFinding = { severity: 'error', kind: 'invalid-json', file: shown, where: `line ${i + 1}`, message: 'is not valid JSON, so it was not scanned.' };
          return [invalid];
        }
      });
    }
    return auditText(shown, raw, allow);
  });
}

/** Ways to name a file in audit-allow.txt: relative to `.flowtape/`, to the folder that holds `.flowtape/`, or to cwd. */
function allowedPaths(file: string, shown: string): string[] {
  const parts = file.split(path.sep);
  const at = parts.lastIndexOf('.flowtape');
  const named = at < 0 ? [shown] : [parts.slice(at + 1).join('/'), parts.slice(at).join('/'), shown];
  return named.map((p) => p.split(path.sep).join('/'));
}

/**
 * Staged files under a `.flowtape/` folder (added, copied, modified or renamed), read from the index rather than the
 * working tree, so a cleaned-up working copy cannot hide a staged secret. Throws when a staged file cannot be read.
 */
export function stagedFlowtapeFiles(cwd = process.cwd()): AuditSource[] {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  const listed = execFileSync('git', ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { cwd: top, encoding: 'utf8' });
  return listed
    .split('\0')
    .filter((rel) => rel.split('/').includes('.flowtape') && SCANNED.test(rel) && !rel.split('/').includes('replay-failures'))
    .map((rel) => {
      try {
        return { file: path.join(top, rel), text: execFileSync('git', ['show', `:${rel}`], { cwd: top, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
      } catch (error) {
        throw new Error(`Cannot read staged file ${rel}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

export function formatFindings(findings: AuditFinding[]): string {
  return findings.map((f) => `${f.severity === 'error' ? 'error  ' : 'warning'} ${f.file} ${f.where}: ${f.kind}: ${f.message}`).join('\n');
}
