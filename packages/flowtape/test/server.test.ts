import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMiddleware, listFlows, readFlow, saveFlow } from '../src/server';
import { LOGIN_EVENTS, makeFlow } from './fixtures';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-'));
const opts = { root, enabled: true };

describe('saveFlow', () => {
  it('writes the flow JSON and the Claude Code prompt', () => {
    const saved = saveFlow(opts, makeFlow(LOGIN_EVENTS));
    expect(saved).toMatchObject({ slug: 'login-and-add-note', flowFile: '.flowtape/flows/login-and-add-note.json', promptFile: '.flowtape/prompts/login-and-add-note.md' });
    expect(fs.readFileSync(path.join(root, saved.promptFile), 'utf8')).toBe(saved.prompt);
    expect(saved.prompt).toContain('Source: `.flowtape/flows/login-and-add-note.json`');
    expect(readFlow(opts, 'login-and-add-note')?.events).toHaveLength(LOGIN_EVENTS.length);
    expect(listFlows(opts)).toEqual([{ slug: 'login-and-add-note', name: 'Login and add note', updatedAt: '2026-09-27T10:00:00.000Z', events: LOGIN_EVENTS.length }]);
  });

  it('redacts again before writing', () => {
    const leaky = makeFlow([{ type: 'input', ts: 0, selector: '#pw', value: 'hunter2', inputType: 'password', redacted: false }], { slug: 'leaky' });
    saveFlow(opts, leaky);
    expect(fs.readFileSync(path.join(root, '.flowtape/flows/leaky.json'), 'utf8')).not.toContain('hunter2');
  });

  it('keeps secrets in the flow name out of the slug and file names', () => {
    const saved = saveFlow(opts, makeFlow([], { name: 'Deploy sk-test-LEAKME123', slug: 'deploy-sk-test-leakme123' }));
    expect(saved).toMatchObject({ slug: 'deploy-redacted', flowFile: '.flowtape/flows/deploy-redacted.json' });
    expect(fs.readdirSync(path.join(root, '.flowtape/flows')).join()).not.toMatch(/leakme/i);
    expect(fs.readFileSync(path.join(root, saved.flowFile), 'utf8')).not.toMatch(/leakme/i);
    expect(saved.prompt).not.toMatch(/leakme/i);
  });

  it('refuses path traversal', () => {
    expect(readFlow(opts, '../../etc/passwd')).toBeNull();
    expect(() => saveFlow(opts, makeFlow([], { slug: '../escape' }))).toThrow();
  });
});

describe('middleware', () => {
  let server: http.Server;
  let base = '';
  let enabled = true;

  beforeAll(async () => {
    const middleware = createMiddleware(() => ({ root, enabled }));
    server = http.createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 418;
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address: AddressInfo | string | null = server.address();
    base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/__flowtape` : '';
  });

  afterAll(() => {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves health, save, list and read', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, enabled: true });
    const post = await fetch(`${base}/flows`, { method: 'POST', body: JSON.stringify(makeFlow(LOGIN_EVENTS, { slug: 'via-http' })) });
    expect(post.status).toBe(201);
    expect(await post.json()).toMatchObject({ slug: 'via-http', promptFile: '.flowtape/prompts/via-http.md' });
    const list = await (await fetch(`${base}/flows`)).json();
    expect(list.flows.map((f: { slug: string }) => f.slug)).toContain('via-http');
    expect((await fetch(`${base}/flows/via-http`)).status).toBe(200);
    expect((await fetch(`${base}/flows/missing`)).status).toBe(404);
  });

  it('rejects invalid bodies and passes other paths through', async () => {
    expect((await fetch(`${base}/flows`, { method: 'POST', body: '{"version":1}' })).status).toBe(400);
    expect((await fetch(`${base}/flows`, { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await fetch(base.replace('/__flowtape', '/other'))).status).toBe(418);
  });

  it('reports disabled and refuses writes', async () => {
    enabled = false;
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, enabled: false });
    expect((await fetch(`${base}/flows`)).status).toBe(403);
    enabled = true;
  });
});
