import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { formatFailure, replayScript, type ReplayLocator, type ReplayPage } from '../src/script/replay';
import { encodePng } from '../src/script/image';
import type { JevClient } from '../src/script/jev';
import { SCRIPT_VERSION, type ReplayScript, type ReplayStep } from '../src/script/schema';

const VIEWPORT = { width: 400, height: 300 };
const png = encodePng({ width: 400, height: 300, data: Buffer.alloc(400 * 300 * 4, 200) });
const crop = encodePng({ width: 40, height: 20, data: Buffer.alloc(40 * 20 * 4, 100) }).toString('base64');

/** Tiny in-process page. `matches` maps a locator key to its match count. */
function fakePage(matches: Record<string, number>) {
  const log: string[] = [];
  const locator = (key: string): ReplayLocator => ({
    count: async () => matches[key] ?? 0,
    click: async () => void log.push(`click ${key}`),
    fill: async (v) => void log.push(`fill ${key} ${v}`),
    selectOption: async (v) => void log.push(`select ${key} ${v}`),
    press: async (k) => void log.push(`press ${key} ${k}`),
  });
  let url = 'about:blank';
  const page: ReplayPage = {
    url: () => url,
    goto: async (u) => void (url = u),
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    evaluate: async () => undefined,
    locator: (s) => locator(`css ${s}`),
    getByRole: (role, o) => locator(`role ${role} ${o.name}`),
    getByLabel: (t) => locator(`label ${t}`),
    getByPlaceholder: (t) => locator(`placeholder ${t}`),
    getByText: (t) => locator(`text ${t}`),
    mouse: { click: async (x, y) => void log.push(`mouse ${x} ${y}`) },
    keyboard: { press: async (k) => void log.push(`key ${k}`), insertText: async (t) => void log.push(`insert ${t}`) },
    screenshot: async () => png,
    viewportSize: () => VIEWPORT,
    setViewportSize: async () => undefined,
  };
  return { page, log };
}

const clickStep: ReplayStep = {
  type: 'click',
  ts: 0,
  url: 'http://app.test/',
  selectors: [
    { strategy: 'test-id', value: 'save' },
    { strategy: 'role', role: 'button', name: 'Save', value: 'Save' },
    { strategy: 'css', value: 'button.save' },
  ],
  expected: { kind: 'none' },
  screenshots: { target: crop },
};

const script = (...steps: ReplayStep[]): ReplayScript => ({
  version: SCRIPT_VERSION,
  kind: 'flowtape-replay-script',
  id: 'x',
  name: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  startUrl: 'http://app.test/',
  viewport: VIEWPORT,
  steps,
});

const failureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-test-'));
const base = { failureDir, selectorTimeoutMs: 0, expectTimeoutMs: 20, stableMs: 1 };

function mockJev(noul: number, confidence = 0.9) {
  const ask = vi.fn<JevClient['ask']>(async () => ({
    answers: {
      present: { type: 'noul', noul },
      // Box centre is (0.5, 0.5) of the fitted image.
      where: { type: 'box', box: { top: 0.4, bottom: 0.6, left: 0.4, right: 0.6 }, confidence },
    },
  }));
  return { jev: { ask } as JevClient, ask };
}

describe('replayScript', () => {
  it('tries selectors in order and the first hit wins', async () => {
    const { page, log } = fakePage({ 'css [data-testid="save"]': 0, 'role button Save': 1, 'css button.save': 1 });
    const result = await replayScript(script(clickStep), { ...base, page });
    expect(result.ok).toBe(true);
    expect(result.steps[0]).toMatchObject({ via: 'role', confidence: 1 });
    expect(result.steps[0].tried.map((t) => [t.strategy, t.matches])).toEqual([['test-id', 0], ['role', 1]]);
    expect(log).toEqual(['click role button Save']);
  });

  it('skips a selector that matches more than one element', async () => {
    const { page, log } = fakePage({ 'css [data-testid="save"]': 2, 'css button.save': 1 });
    const result = await replayScript(script(clickStep), { ...base, page });
    expect(result.steps[0].via).toBe('css');
    expect(log).toEqual(['click css button.save']);
  });

  it('asks Jev when every selector misses, and clicks the box centre', async () => {
    const { page, log } = fakePage({});
    const { jev, ask } = mockJev(0.95);
    const result = await replayScript(script(clickStep), { ...base, page, jev });
    expect(result.ok).toBe(true);
    expect(result.steps[0]).toMatchObject({ via: 'jev', confidence: 0.9 });
    expect(ask).toHaveBeenCalledTimes(1);
    const request = ask.mock.calls[0][0];
    expect(Object.entries(request.questions).map(([id, q]) => [id, q.type])).toEqual([['present', 'noul'], ['where', 'box']]);
    expect(request.state).toEqual({ page: 'ft_page', target: 'ft_target' });
    expect(Object.keys(request.assets ?? {})).toEqual(['ft_page', 'ft_target']);
    // The 400x300 page is padded to 400x300 (no change), so the centre is the middle of the page.
    expect(log).toEqual(['mouse 200 150']);
  });

  it('undoes padding when it maps the box to page pixels', async () => {
    const small = encodePng({ width: 100, height: 100, data: Buffer.alloc(100 * 100 * 4, 200) });
    const { page, log } = fakePage({});
    page.screenshot = async () => small;
    // Padded to 280x280 with 90 px each side. Box centre (0.5, 0.5) is source (50, 50).
    await replayScript(script(clickStep), { ...base, page, jev: mockJev(0.95).jev });
    expect(log).toEqual(['mouse 50 50']);
  });

  it('fails loudly, with a report, below the threshold', async () => {
    const { page, log } = fakePage({});
    const result = await replayScript(script(clickStep), { ...base, page, jev: mockJev(0.95, 0.5).jev, threshold: 0.7 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ index: 0, type: 'click' });
    expect(result.error?.reason).toMatch(/confidence 0\.50 below threshold 0\.7/);
    expect(result.error?.tried).toHaveLength(3);
    expect(log).toEqual([]);
    expect(fs.existsSync(result.error?.before ?? '')).toBe(true);
    expect(fs.existsSync(result.error?.after ?? '')).toBe(true);
    expect(formatFailure(result.error!)).toMatch(/step 1 \(click\)[\s\S]*test-id "save": 0 matches/);
  });

  it('fails when Jev says the target is not on the page', async () => {
    const { page, log } = fakePage({});
    const result = await replayScript(script(clickStep), { ...base, page, jev: mockJev(0.1).jev });
    expect(result.error?.reason).toMatch(/target not found/);
    expect(log).toEqual([]);
  });

  it('never calls Jev without it, and fails on a miss', async () => {
    const { page } = fakePage({});
    const result = await replayScript(script(clickStep), { ...base, page });
    expect(result.ok).toBe(false);
    expect(result.error?.reason).toMatch(/No selector matched/);
  });

  it('types recorded values, and leaves redacted fields empty unless FLOWTAPE_* is set', async () => {
    const field = (extra: Partial<ReplayStep>): ReplayStep => ({ type: 'type', ts: 0, url: 'http://app.test/', selectors: [{ strategy: 'label', value: 'Password' }], expected: { kind: 'none' }, name: 'Password', inputType: 'password', ...extra });
    const redacted = field({ redacted: true, value: null, length: 7 });
    const plain = field({ value: 'hello', selectors: [{ strategy: 'label', value: 'Note' }], name: 'Note', inputType: 'text' });
    const a = fakePage({ 'label Password': 1, 'label Note': 1 });
    const first = await replayScript(script(redacted, plain), { ...base, page: a.page, env: {} });
    expect(a.log).toEqual(['fill label Note hello']);
    expect(first.steps[0].note).toMatch(/FLOWTAPE_PASSWORD is not set/);
    const b = fakePage({ 'label Password': 1 });
    await replayScript(script(redacted), { ...base, page: b.page, env: { FLOWTAPE_PASSWORD: 's3cret' } });
    expect(b.log).toEqual(['fill label Password s3cret']);
  });

  it('checks a URL expectation, and fails without Jev when it is not met', async () => {
    const step: ReplayStep = { ...clickStep, expected: { kind: 'url', url: '/done' } };
    const { page } = fakePage({ 'css [data-testid="save"]': 1 });
    const result = await replayScript(script(step), { ...base, page });
    expect(result.error?.reason).toMatch(/Expected outcome not reached/);
  });
});
