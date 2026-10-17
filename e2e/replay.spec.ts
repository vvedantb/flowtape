import { expect, test, type Page } from '@playwright/test';
import { createJevClient, recordScript, replayScript } from '@vvedantb/flowtape/node';
import type { JevClient } from '@vvedantb/flowtape/node';
import { ReplayScriptSchema, type ReplayScript } from '@vvedantb/flowtape';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFixture } from './fixture';

const VIEWPORT = { width: 800, height: 600 };
const SECRET = 'correct-horse-battery';
const failureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-e2e-'));

let fixture: Awaited<ReturnType<typeof startFixture>>;
let script: ReplayScript;

test.beforeAll(async () => {
  fixture = await startFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

async function newPage(browser: import('@playwright/test').Browser): Promise<Page> {
  return browser.newPage({ viewport: VIEWPORT });
}

test.describe.configure({ mode: 'serial' });

test('records a script programmatically', async ({ browser }) => {
  const page = await newPage(browser);
  const recording = await recordScript({ page, name: 'Add a note' });
  await page.goto(fixture.url);
  await page.getByTestId('note-input').pressSequentially('hello');
  await page.waitForTimeout(700);
  await page.getByTestId('pw-input').fill(SECRET);
  await page.waitForTimeout(700);
  await page.getByTestId('add-btn').click();
  await expect(page.getByRole('status')).toHaveText('Added: hello');
  script = await recording.stop();
  await page.close();

  expect(ReplayScriptSchema.safeParse(script).success).toBe(true);
  expect(script.startUrl).toBe(fixture.url);
  expect(script.viewport).toEqual(VIEWPORT);
  expect(script.steps.map((s) => s.type)).toEqual(['type', 'type', 'click']);
  const [note, password, click] = script.steps;
  expect(note).toMatchObject({ value: 'hello', redacted: undefined });
  expect(note.selectors[0]).toEqual({ strategy: 'test-id', value: 'note-input' });
  expect(password).toMatchObject({ redacted: true, value: null, length: SECRET.length });
  expect(password.screenshots).toBeUndefined();
  expect(click.selectors.map((s) => s.strategy)).toEqual(['test-id', 'role', 'text', 'css']);
  expect(click.screenshots?.page).toBeTruthy();
  expect(click.screenshots?.target).toBeTruthy();
  expect(JSON.stringify(script)).not.toContain(SECRET);
  // Recorded outcome is "none". Tighten it by hand, as a user would: a status line must appear.
  click.expected = { kind: 'element', selector: '[role="status"]' };
});

test('replays against the same page by selector', async ({ browser }) => {
  const page = await newPage(browser);
  const result = await replayScript(script, { page, failureDir, env: { FLOWTAPE_PASSWORD: SECRET } });
  await page.close();
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.steps.map((s) => s.via)).toEqual(['test-id', 'test-id', 'test-id']);
});

test('replays a refactored page through later selector strategies', async ({ browser }) => {
  const page = await newPage(browser);
  const result = await replayScript(script, { page, startUrl: `${fixture.url}?variant=mutated`, failureDir, selectorTimeoutMs: 500, env: { FLOWTAPE_PASSWORD: SECRET } });
  await page.close();
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  for (const step of result.steps) {
    // test-id is tried first and misses, then a later strategy hits.
    expect(step.tried[0]).toMatchObject({ strategy: 'test-id', matches: 0 });
    expect(['role', 'label', 'placeholder', 'text']).toContain(step.via);
  }
});

/** Only selectors that no longer match, so Jev has to find the button. */
function brokenSelectors(source: ReplayScript): ReplayScript {
  const steps = source.steps.map((s) => (s.type === 'click' ? { ...s, selectors: [{ strategy: 'test-id' as const, value: 'add-btn' }, { strategy: 'css' as const, value: '#add' }] } : s));
  return { ...source, steps };
}

test('falls back to a mocked Jev when selectors fail', async ({ browser }) => {
  const page = await newPage(browser);
  const mutatedUrl = `${fixture.url}?variant=mutated`;
  const calls: Array<{ questions: string[]; assets: string[] }> = [];
  const jev: JevClient = {
    async ask(request) {
      calls.push({ questions: Object.values(request.questions).map((q) => q.type), assets: Object.keys(request.assets ?? {}) });
      // Same viewport, so the screenshot Jev sees is 800x600 and box edges are fractions of it.
      const box = await page.getByRole('button', { name: 'Add note' }).boundingBox();
      if (!box) throw new Error('Button missing');
      return {
        answers: {
          present: { type: 'noul', noul: 0.97 },
          where: { type: 'box', confidence: 0.9, box: { left: box.x / 800, right: (box.x + box.width) / 800, top: box.y / 600, bottom: (box.y + box.height) / 600 } },
        },
      };
    },
  };
  const result = await replayScript(brokenSelectors(script), { page, startUrl: mutatedUrl, jev, failureDir, selectorTimeoutMs: 200, env: { FLOWTAPE_PASSWORD: SECRET } });
  expect(result.error).toBeUndefined();
  expect(result.ok).toBe(true);
  expect(result.steps.map((s) => s.via)).toEqual(['role', 'role', 'jev']);
  expect(result.steps[2].confidence).toBe(0.9);
  expect(calls).toEqual([{ questions: ['noul', 'box'], assets: ['ft_page', 'ft_target'] }]);
  await expect(page.getByRole('status')).toHaveText('Added: hello');
  await page.close();
});

test('fails without Jev when selectors fail', async ({ browser }) => {
  const page = await newPage(browser);
  const result = await replayScript(brokenSelectors(script), { page, startUrl: `${fixture.url}?variant=mutated`, failureDir, selectorTimeoutMs: 200, env: { FLOWTAPE_PASSWORD: SECRET } });
  await page.close();
  expect(result.ok).toBe(false);
  expect(result.error).toMatchObject({ index: 2, type: 'click' });
  expect(fs.existsSync(result.error?.after ?? '')).toBe(true);
});

test('real Jev finds the button on the refactored page', async ({ browser }) => {
  test.skip(!process.env.TYPESAFE_API_KEY, 'Set TYPESAFE_API_KEY to call the real Jev API.');
  const page = await newPage(browser);
  const jev = createJevClient({ apiKey: process.env.TYPESAFE_API_KEY as string });
  const result = await replayScript(brokenSelectors(script), { page, startUrl: `${fixture.url}?variant=mutated`, jev, failureDir, env: { FLOWTAPE_PASSWORD: SECRET } });
  await page.close();
  expect(result.error).toBeUndefined();
  expect(result.steps[2].via).toBe('jev');
});
