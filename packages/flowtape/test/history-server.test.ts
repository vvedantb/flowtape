import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HistoryEventSchema, HistorySessionLineSchema } from '../src/schemas';
import { appendHistory, createMiddleware, findHistoryDir, listHistory } from '../src/server';
import type { HistoryBatch, HistoryEvent } from '../src/types';
import { LEAKY_EVENTS, LOGIN_EVENTS, PLANTED } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-history-'));
const opts = { root, enabled: true };

function batch(sessionId: string, events: HistoryEvent[]): HistoryBatch {
  return {
    sessionId,
    startedAt: '2026-09-27T10:00:00.000Z',
    startUrl: 'http://localhost:5173/login?token=url-token-LEAKME',
    meta: { userAgent: 'test', viewport: { width: 800, height: 600 } },
    events,
  };
}

function lines(file: string): string[] {
  return fs.readFileSync(path.join(root, file), 'utf8').trimEnd().split('\n');
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('appendHistory', () => {
  it('creates the history folder and appends JSONL with one session line first', () => {
    expect(fs.existsSync(path.join(root, '.flowtape/history'))).toBe(false);
    const first = appendHistory(opts, batch('abc123def0', LOGIN_EVENTS.slice(0, 3)));
    const second = appendHistory(opts, batch('abc123def0', LOGIN_EVENTS.slice(3)));
    expect(first).toEqual({ file: '.flowtape/history/2026-09-27-abc123def0.jsonl', appended: 3 });
    expect(second.file).toBe(first.file);

    const [header, ...events] = lines(first.file);
    expect(HistorySessionLineSchema.parse(JSON.parse(header))).toMatchObject({ type: 'session', sessionId: 'abc123def0', startedAt: '2026-09-27T10:00:00.000Z' });
    expect(events.map((line) => HistoryEventSchema.parse(JSON.parse(line)).type)).toEqual(LOGIN_EVENTS.map((e) => e.type));
  });

  it('keeps one file per session', () => {
    appendHistory(opts, batch('other00001', LOGIN_EVENTS.slice(0, 1)));
    expect(fs.readdirSync(path.join(root, '.flowtape/history')).sort()).toEqual(['2026-09-27-abc123def0.jsonl', '2026-09-27-other00001.jsonl']);
  });

  it('scrubs planted secrets from events, error messages and the session line', () => {
    const errors: HistoryEvent[] = [
      { type: 'error', ts: 100, kind: 'error', message: 'fetch failed: Bearer sk-test-LEAKME123', source: 'http://localhost:5173/app.js?api_key=sk-test-LEAKME123', line: 3, column: 7 },
      { type: 'error', ts: 110, kind: 'unhandledrejection', message: 'password=SuperSecretPass! ghp_LEAKME456' },
    ];
    const { file } = appendHistory(opts, batch('leaky00001', [...LEAKY_EVENTS, ...errors]));
    const written = fs.readFileSync(path.join(root, file), 'utf8');
    for (const secret of PLANTED) expect(written).not.toContain(secret);
    expect(written).toContain('[REDACTED]');
    expect(lines(file)).toHaveLength(1 + LEAKY_EVENTS.length + errors.length);
  });

  it('rejects bad session ids and redacted inputs that still carry a value', () => {
    expect(() => appendHistory(opts, batch('../escape', []))).toThrow();
    expect(() => appendHistory(opts, batch('abc123def0', [{ type: 'input', ts: 0, selector: '#pw', value: 'hunter2', redacted: true }]))).toThrow();
  });
});

describe('listHistory / findHistoryDir', () => {
  it('lists session files newest first and finds the nearest history folder', () => {
    const dir = path.join(root, '.flowtape/history');
    const touch = (id: string, iso: string) => fs.utimesSync(path.join(dir, `2026-09-27-${id}.jsonl`), new Date(iso), new Date(iso));
    touch('abc123def0', '2026-09-27T11:00:00Z');
    touch('leaky00001', '2026-09-27T13:00:00Z');
    touch('other00001', '2026-09-27T12:00:00Z');
    const files = listHistory(dir).map((f) => path.basename(f.file));
    expect(files).toEqual(['2026-09-27-leaky00001.jsonl', '2026-09-27-other00001.jsonl', '2026-09-27-abc123def0.jsonl']);
    expect(listHistory(dir).every((f) => f.size > 0)).toBe(true);

    const nested = path.join(root, 'src/deep');
    fs.mkdirSync(nested, { recursive: true });
    expect(findHistoryDir(nested)).toBe(dir);
    expect(listHistory(path.join(root, 'missing'))).toEqual([]);
  });
});

describe('POST /__flowtape/history', () => {
  let server: http.Server;
  let base = '';
  let enabled = true;

  beforeAll(async () => {
    const middleware = createMiddleware(() => ({ root, enabled }));
    server = http.createServer((req, res) => void middleware(req, res, () => res.end()));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address: AddressInfo | string | null = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/__flowtape` : '';
  });

  afterAll(() => server.close());

  it('appends a batch and never writes request headers or cookies', async () => {
    const res = await fetch(`${base}/history`, {
      method: 'POST',
      headers: { Authorization: 'Bearer header-LEAKME-token', Cookie: 'sid=cookie-LEAKME' },
      body: JSON.stringify(batch('http000001', LOGIN_EVENTS)),
    });
    expect(res.status).toBe(201);
    const { file } = await res.json();
    expect(file).toBe('.flowtape/history/2026-09-27-http000001.jsonl');
    const written = fs.readFileSync(path.join(root, file), 'utf8');
    expect(written).not.toContain('LEAKME');
    expect(written).not.toContain('Authorization');
  });

  it('rejects invalid batches and refuses writes when disabled', async () => {
    expect((await fetch(`${base}/history`, { method: 'POST', body: '{"sessionId":"x"}' })).status).toBe(400);
    enabled = false;
    expect((await fetch(`${base}/history`, { method: 'POST', body: JSON.stringify(batch('off0000001', [])) })).status).toBe(403);
    enabled = true;
  });
});
