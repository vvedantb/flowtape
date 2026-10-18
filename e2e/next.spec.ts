import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { NEXT_PORT } from '../playwright.config';

const nextRoot = path.resolve(import.meta.dirname, '../examples/next-demo');
const base = `http://localhost:${NEXT_PORT}`;
const files = [path.join(nextRoot, '.flowtape/flows/next-smoke.json'), path.join(nextRoot, '.flowtape/prompts/next-smoke.md')];
const historyDir = path.join(nextRoot, '.flowtape/history');

test.afterEach(() => {
  if (process.env.FLOWTAPE_KEEP) return;
  files.forEach((file) => fs.rmSync(file, { force: true }));
  fs.rmSync(historyDir, { recursive: true, force: true });
});

test('Next.js App Router: record → stop → export writes the flow, prompt and session history', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('flowtape:history', '1'));
  await page.goto(base);
  const overlay = page.getByRole('region', { name: 'flowtape recorder' });

  await overlay.getByRole('button', { name: 'Record' }).click();
  await page.getByTestId('note-input').fill('Water the plants');
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('note-item')).toHaveText('Water the plants');
  await page.getByTestId('about-link').click();
  await expect(page).toHaveURL(/\/about$/);
  // The overlay lives in the root layout, so it survives a client-side navigation.
  await expect(overlay).toBeVisible();

  await overlay.getByRole('button', { name: 'Stop' }).click();
  await overlay.getByLabel('Flow name').fill('Next smoke');
  await overlay.getByRole('button', { name: 'Export' }).click();
  await expect(overlay.getByTestId('flowtape-saved')).toContainText('.flowtape/prompts/next-smoke.md');

  const flow = JSON.parse(fs.readFileSync(files[0], 'utf8'));
  expect(flow.events.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(['navigate', 'input', 'click']));
  expect(flow.events.some((e: { url?: string }) => e.url?.endsWith('/about'))).toBe(true);
  expect(fs.readFileSync(files[1], 'utf8')).toContain('Water the plants');

  await expect.poll(() => (fs.existsSync(historyDir) ? fs.readdirSync(historyDir).filter((f) => f.endsWith('.jsonl')).length : 0)).toBeGreaterThan(0);
});

test('Next.js Pages Router: the API route saves and reads a flow', async ({ request }) => {
  const flow = {
    version: 1,
    id: 'next-pages-router',
    name: 'Next smoke',
    slug: 'next-smoke',
    createdAt: '2026-10-17T10:00:00.000Z',
    updatedAt: '2026-10-17T10:00:00.000Z',
    startUrl: `${base}/`,
    events: [{ type: 'click', ts: 0, selector: '[data-testid="note-add"]', text: 'Add note' }],
  };
  const saved = await request.post(`${base}/api/flowtape-pages/flows`, { data: flow });
  expect(saved.status()).toBe(201);
  expect(await saved.json()).toMatchObject({ promptFile: '.flowtape/prompts/next-smoke.md' });
  expect((await request.get(`${base}/api/flowtape-pages/flows/next-smoke`)).status()).toBe(200);
  expect(fs.existsSync(files[1])).toBe(true);
});
