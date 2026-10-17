import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { flowToPrompt } from './prompt';
import { redactFlow, redactHistoryEvent, scrubText } from './redact';
import { FLOW_VERSION, FlowDocumentSchema, HistoryBatchSchema, SLUG_PATTERN } from './schemas';
import type { FlowDocument, FlowSummary, HistoryAppendResult, HistoryBatch, HistoryFileSummary, HistorySessionLine, SavedFlow } from './types';

export const ENDPOINT = '/__flowtape';
/** Largest request body, in characters. */
export const MAX_BODY = 5 * 1024 * 1024;

export interface FlowtapeServerOptions {
  /** Project root. Files land in `<root>/<dir>/flows`, `<root>/<dir>/prompts` and `<root>/<dir>/history`. */
  root: string;
  /** Default `.flowtape`. */
  dir?: string;
  enabled: boolean;
}

interface Paths {
  base: string;
  flows: string;
  prompts: string;
  history: string;
}

function pathsFor(opts: FlowtapeServerOptions): Paths {
  const base = path.resolve(opts.root, opts.dir ?? '.flowtape');
  return { base, flows: path.join(base, 'flows'), prompts: path.join(base, 'prompts'), history: path.join(base, 'history') };
}

function relative(opts: FlowtapeServerOptions, file: string): string {
  return path.relative(opts.root, file).split(path.sep).join('/');
}

/** Validate, redact again, then write `flows/<slug>.json` and `prompts/<slug>.md`. */
export function saveFlow(opts: FlowtapeServerOptions, input: FlowDocument): SavedFlow {
  const doc = redactFlow(FlowDocumentSchema.parse(input));
  const dirs = pathsFor(opts);
  fs.mkdirSync(dirs.flows, { recursive: true });
  fs.mkdirSync(dirs.prompts, { recursive: true });
  const flowFile = path.join(dirs.flows, `${doc.slug}.json`);
  const promptFile = path.join(dirs.prompts, `${doc.slug}.md`);
  const prompt = flowToPrompt(doc, { flowFile: relative(opts, flowFile) });
  fs.writeFileSync(flowFile, `${JSON.stringify(doc, null, 2)}\n`);
  fs.writeFileSync(promptFile, prompt);
  return { slug: doc.slug, flowFile: relative(opts, flowFile), promptFile: relative(opts, promptFile), prompt };
}

export function readFlow(opts: FlowtapeServerOptions, slug: string): FlowDocument | null {
  if (!SLUG_PATTERN.test(slug)) return null;
  const file = path.join(pathsFor(opts).flows, `${slug}.json`);
  if (!fs.existsSync(file)) return null;
  return FlowDocumentSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Saved flows, newest first. Files that fail validation are skipped. */
export function listFlows(opts: FlowtapeServerOptions): FlowSummary[] {
  const dir = pathsFor(opts).flows;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      try {
        const doc = FlowDocumentSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
        return [{ slug: doc.slug, name: doc.name, updatedAt: doc.updatedAt, events: doc.events.length }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Append a batch to `history/<YYYY-MM-DD>-<sessionId>.jsonl`, redacting again first.
 * A new file starts with one `session` line; every later line is one event.
 */
export function appendHistory(opts: FlowtapeServerOptions, input: HistoryBatch): HistoryAppendResult {
  const batch = HistoryBatchSchema.parse(input);
  const dir = pathsFor(opts).history;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${batch.startedAt.slice(0, 10)}-${batch.sessionId}.jsonl`);
  const lines = batch.events.map((event) => JSON.stringify(redactHistoryEvent(event)));
  if (!fs.existsSync(file)) {
    const header: HistorySessionLine = {
      type: 'session',
      version: FLOW_VERSION,
      sessionId: batch.sessionId,
      startedAt: batch.startedAt,
      startUrl: batch.startUrl === undefined ? undefined : scrubText(batch.startUrl),
      meta: batch.meta && { ...batch.meta, userAgent: batch.meta.userAgent === undefined ? undefined : scrubText(batch.meta.userAgent) },
    };
    lines.unshift(JSON.stringify(header));
  }
  if (lines.length > 0) fs.appendFileSync(file, `${lines.join('\n')}\n`);
  return { file: relative(opts, file), appended: batch.events.length };
}

/** Session history files in `dir`, newest first. */
export function listHistory(dir: string): HistoryFileSummary[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => {
      const stat = fs.statSync(path.join(dir, file));
      return { file: path.join(dir, file), size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** Nearest `<dir>/history` folder at or above `from`, or null. */
export function findHistoryDir(from: string, dir = '.flowtape'): string | null {
  let current = path.resolve(from);
  for (;;) {
    const candidate = path.join(current, dir, 'history');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Read a Node request body as text, up to `MAX_BODY`. */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
      if (raw.length > MAX_BODY) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

export interface FlowtapeResponse {
  status: number;
  body: object;
}

/**
 * Route one `<endpoint>/<route>` request. Framework adapters (Vite, Next.js) only translate
 * their request and response types. `readBody` is called only for routes that take a body.
 */
export async function handleRequest(opts: FlowtapeServerOptions, method: string, route: string, readBody: () => Promise<string>): Promise<FlowtapeResponse> {
  route = route.replace(/^\/+|\/+$/g, '');
  if (route === 'health') return { status: 200, body: { ok: true, enabled: opts.enabled } };
  if (!opts.enabled) return { status: 403, body: { error: 'flowtape is disabled' } };

  try {
    if (route === 'flows' && method === 'POST') {
      const parsed = FlowDocumentSchema.safeParse(JSON.parse(await readBody()));
      if (!parsed.success) return { status: 400, body: { error: 'Invalid flow', issues: parsed.error.issues } };
      return { status: 201, body: saveFlow(opts, parsed.data) };
    }
    if (route === 'flows' && method === 'GET') return { status: 200, body: { flows: listFlows(opts) } };
    // History ignores request headers and cookies; only the parsed event batch is written.
    if (route === 'history' && method === 'POST') {
      const parsed = HistoryBatchSchema.safeParse(JSON.parse(await readBody()));
      if (!parsed.success) return { status: 400, body: { error: 'Invalid history batch', issues: parsed.error.issues } };
      return { status: 201, body: appendHistory(opts, parsed.data) };
    }
    const match = /^flows\/([^/]+)$/.exec(route);
    if (match && method === 'GET') {
      const doc = readFlow(opts, match[1]);
      return doc ? { status: 200, body: doc } : { status: 404, body: { error: 'Flow not found' } };
    }
    return { status: 404, body: { error: 'Not found' } };
  } catch (err) {
    return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } };
  }
}

/** Headers for every flowtape response. */
export const RESPONSE_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export function writeResponse(res: ServerResponse, { status, body }: FlowtapeResponse): void {
  res.statusCode = status;
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}

/** Connect-style middleware for `/__flowtape/*`. */
export function createMiddleware(getOptions: () => FlowtapeServerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(`${ENDPOINT}/`)) return next();
    writeResponse(res, await handleRequest(getOptions(), req.method ?? 'GET', url.pathname.slice(ENDPOINT.length + 1), () => readBody(req)));
  };
}
