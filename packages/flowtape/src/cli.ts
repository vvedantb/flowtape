#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { flowToE2ETest } from './e2e-test';
import { FlowDocumentSchema } from './schemas';
import { findHistoryDir, listHistory } from './server';

const USAGE = `Usage: flowtape history [path]
       flowtape record <url> [--out file] [--headed] [--name name]
       flowtape replay <file> [--jev | --no-jev] [--threshold <0-1>] [--headed]
       flowtape e2e <flow.json> [--out file] [--session name]
       flowtape audit [paths...] [--staged] [--strict]

record   Open <url> in Chromium and save a replay script (default .flowtape/scripts/<name>.json). Ctrl+C stops.
replay   Replay a script with Playwright. Jev visual fallback runs when TYPESAFE_API_KEY is set, unless --no-jev.
audit    Scan saved flows, prompts, e2e drafts, scripts and history for secrets and personal data. Exits 1 on an error,
         or on any finding with --strict. --staged scans the staged .flowtape files (for a pre-commit hook).
e2e      Write a test for the e2e runner from a saved flow (default .flowtape/e2e/<slug>.e2e.ts). --session names a sign-in session from e2e.config.ts.
history  List recent session history files in the nearest .flowtape/history/ at or above [path] (default: cwd).`;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function history(from: string): void {
  const dir = findHistoryDir(from);
  if (!dir) {
    console.log(`No .flowtape/history/ found at or above ${path.resolve(from)}.`);
    return;
  }
  const files = listHistory(dir);
  if (files.length === 0) {
    console.log(`${path.relative(process.cwd(), dir) || '.'} is empty.`);
    return;
  }
  for (const { file, size, mtime } of files.slice(0, 20)) {
    console.log(`${formatTime(mtime)}  ${formatSize(size).padStart(8)}  ${path.relative(process.cwd(), file)}`);
  }
  if (files.length > 20) console.log(`… and ${files.length - 20} older`);
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Positional args: everything that is neither a flag nor a flag's value. */
function positional(args: string[], valueFlags: string[]): string[] {
  return args.filter((a, i) => !a.startsWith('--') && !valueFlags.includes(args[i - 1]?.slice(2) ?? ''));
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === 'history') {
    history(args[0] ?? process.cwd());
    return 0;
  }
  if (command === 'record') {
    const [url] = positional(args, ['out', 'name']);
    if (!url) return fail('record needs a URL.');
    const { recordCommand } = await import('./script/record');
    const file = await recordCommand({ url, out: option(args, 'out'), name: option(args, 'name'), headed: flag(args, 'headed') });
    console.log(`Saved ${path.relative(process.cwd(), file)}`);
    return 0;
  }
  if (command === 'replay') {
    const [file] = positional(args, ['threshold']);
    if (!file) return fail('replay needs a script file.');
    const raw = option(args, 'threshold');
    const threshold = raw === undefined ? undefined : Number(raw);
    if (threshold !== undefined && !(threshold >= 0 && threshold <= 1)) return fail('--threshold must be between 0 and 1.');
    if (flag(args, 'jev') && flag(args, 'no-jev')) return fail('Use --jev or --no-jev, not both.');
    const { replayCommand } = await import('./script/replay');
    return replayCommand({ file, jev: flag(args, 'jev') ? true : flag(args, 'no-jev') ? false : undefined, threshold, headed: flag(args, 'headed') });
  }
  if (command === 'audit') {
    const { auditFlowtape, formatFindings } = await import('./audit');
    const staged = flag(args, 'staged');
    const paths = staged ? stagedFlowtapeFiles() : positional(args, []);
    const findings = auditFlowtape({ paths: staged || paths.length ? paths : undefined });
    const errors = findings.filter((f) => f.severity === 'error').length;
    if (findings.length) console.log(formatFindings(findings));
    console.log(`${findings.length ? '' : 'No findings. '}${errors} error(s), ${findings.length - errors} warning(s).${findings.length ? ' Accept a false positive by adding the exact text to .flowtape/audit-allow.txt.' : ''}`);
    return errors || (flag(args, 'strict') && findings.length) ? 1 : 0;
  }
  if (command === 'e2e') {
    const [file] = positional(args, ['out', 'session']);
    if (!file) return fail('e2e needs a flow file.');
    const doc = FlowDocumentSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const out = path.resolve(option(args, 'out') ?? path.join(path.dirname(path.dirname(path.resolve(file))), 'e2e', `${doc.slug}.e2e.ts`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, flowToE2ETest(doc, { session: option(args, 'session'), flowFile: path.relative(process.cwd(), path.resolve(file)) }));
    console.log(`Saved ${path.relative(process.cwd(), out)}`);
    return 0;
  }
  console.log(USAGE);
  return command === undefined || command === '--help' || command === '-h' ? 0 : 1;
}

/** Staged files under a .flowtape/ folder, added, copied or modified. */
function stagedFlowtapeFiles(): string[] {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' });
  return out.split('\n').filter((file) => file.split('/').includes('.flowtape'));
}

function fail(message: string): number {
  console.error(`${message}\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
