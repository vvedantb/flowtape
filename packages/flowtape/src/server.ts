import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { flowToPrompt } from './prompt';
import { redactFlow } from './redact';
import { FlowDocumentSchema, SLUG_PATTERN } from './schemas';
import type { FlowDocument, FlowSummary, SavedFlow } from './types';

export const ENDPOINT = '/__flowtape';
const MAX_BODY = 5 * 1024 * 1024;

export interface FlowtapeServerOptions {
  /** Project root. Files land in `<root>/<dir>/flows` and `<root>/<dir>/prompts`. */
  root: string;
  /** Default `.flowtape`. */
  dir?: string;
  enabled: boolean;
}

interface Paths {
  base: string;
  flows: string;
  prompts: string;
}

function pathsFor(opts: FlowtapeServerOptions): Paths {
  const base = path.resolve(opts.root, opts.dir ?? '.flowtape');
  return { base, flows: path.join(base, 'flows'), prompts: path.join(base, 'prompts') };
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

function readBody(req: IncomingMessage): Promise<string> {
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

function send(res: ServerResponse, status: number, body: object): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Connect-style middleware for `/__flowtape/*`. */
export function createMiddleware(getOptions: () => FlowtapeServerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(`${ENDPOINT}/`)) return next();
    const opts = getOptions();
    const route = url.pathname.slice(ENDPOINT.length + 1).replace(/\/$/, '');
    const method = req.method ?? 'GET';

    if (route === 'health') return send(res, 200, { ok: true, enabled: opts.enabled });
    if (!opts.enabled) return send(res, 403, { error: 'flowtape is disabled' });

    try {
      if (route === 'flows' && method === 'POST') {
        const parsed = FlowDocumentSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) return send(res, 400, { error: 'Invalid flow', issues: parsed.error.issues });
        return send(res, 201, saveFlow(opts, parsed.data));
      }
      if (route === 'flows' && method === 'GET') return send(res, 200, { flows: listFlows(opts) });
      const match = /^flows\/([^/]+)$/.exec(route);
      if (match && method === 'GET') {
        const doc = readFlow(opts, match[1]);
        return doc ? send(res, 200, doc) : send(res, 404, { error: 'Flow not found' });
      }
      return send(res, 404, { error: 'Not found' });
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}
