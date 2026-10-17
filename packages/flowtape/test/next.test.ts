import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flowtapeApiHandler, flowtapeRouteHandlers } from '../src/next';
import { LOGIN_EVENTS, makeFlow } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-next-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const batch = { sessionId: 'abc123', startedAt: '2026-10-17T10:00:00.000Z', events: [{ type: 'click', ts: 5, selector: '#add', text: 'Add' }] };

describe('flowtapeRouteHandlers (App Router)', () => {
  const { GET, POST } = flowtapeRouteHandlers({ root, enabled: true });
  const url = (route: string) => `http://localhost:3000/api/flowtape/${route}`;

  it('serves health, save, list, read and history', async () => {
    expect(await (await GET(new Request(url('health')))).json()).toEqual({ ok: true, enabled: true });
    const post = await POST(new Request(url('flows'), { method: 'POST', body: JSON.stringify(makeFlow(LOGIN_EVENTS, { slug: 'app-router' })) }));
    expect(post.status).toBe(201);
    expect(post.headers.get('Cache-Control')).toBe('no-store');
    expect(await post.json()).toMatchObject({ slug: 'app-router', promptFile: '.flowtape/prompts/app-router.md' });
    const list = await (await GET(new Request(url('flows')))).json();
    expect(list.flows.map((f: { slug: string }) => f.slug)).toContain('app-router');
    expect((await GET(new Request(url('flows/app-router')))).status).toBe(200);
    expect((await GET(new Request(url('flows/missing')))).status).toBe(404);
    const history = await POST(new Request(url('history'), { method: 'POST', body: JSON.stringify(batch) }));
    expect(await history.json()).toEqual({ file: '.flowtape/history/2026-10-17-abc123.jsonl', appended: 1 });
  });

  it('matches the endpoint behind a basePath and rejects bad bodies', async () => {
    expect((await GET(new Request('http://localhost:3000/docs/api/flowtape/health'))).status).toBe(200);
    expect((await POST(new Request(url('flows'), { method: 'POST', body: 'not json' }))).status).toBe(400);
  });

  it('is off outside next dev', async () => {
    const off = flowtapeRouteHandlers({ root });
    expect(process.env.NODE_ENV).not.toBe('development');
    expect(await (await off.GET(new Request(url('health')))).json()).toEqual({ ok: true, enabled: false });
    expect((await off.POST(new Request(url('flows'), { method: 'POST', body: JSON.stringify(makeFlow(LOGIN_EVENTS, { slug: 'blocked' })) }))).status).toBe(403);
    expect(fs.existsSync(path.join(root, '.flowtape/flows/blocked.json'))).toBe(false);
  });
});

describe('flowtapeApiHandler (Pages Router)', () => {
  let server: http.Server;
  let base = '';
  // Next.js parses JSON bodies by default. `parsed` mimics that; without it the handler reads the stream.
  let parsed = true;

  beforeAll(async () => {
    const handler = flowtapeApiHandler({ root, enabled: true });
    server = http.createServer(async (req, res) => {
      if (!parsed) return handler(req, res);
      let raw = '';
      for await (const chunk of req) raw += chunk;
      return handler(Object.assign(req, { body: raw ? JSON.parse(raw) : undefined }), res);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address: AddressInfo | string | null = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/api/flowtape` : '';
  });
  afterAll(() => server.close());

  it('saves a flow from a body that Next.js already parsed', async () => {
    parsed = true;
    const post = await fetch(`${base}/flows`, { method: 'POST', body: JSON.stringify(makeFlow(LOGIN_EVENTS, { slug: 'pages-parsed' })) });
    expect(post.status).toBe(201);
    expect(fs.existsSync(path.join(root, '.flowtape/prompts/pages-parsed.md'))).toBe(true);
  });

  it('reads the stream when bodyParser is off', async () => {
    parsed = false;
    const post = await fetch(`${base}/flows`, { method: 'POST', body: JSON.stringify(makeFlow(LOGIN_EVENTS, { slug: 'pages-raw' })) });
    expect(post.status).toBe(201);
    expect((await fetch(`${base}/flows/pages-raw`)).status).toBe(200);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });
});
