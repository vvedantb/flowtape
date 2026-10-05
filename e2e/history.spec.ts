import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { demoRoot, historyFile, removeHistory, waitForHistory } from './history';

const repoRoot = path.resolve(demoRoot, '../..');

/** Run the built `@vvedantb/flowtape` bin the way a user would, from the repo root. */
function flowtapeCli(...args: string[]) {
  return spawnSync('npx', ['--no-install', '@vvedantb/flowtape', ...args], { cwd: repoRoot, encoding: 'utf8' });
}

test.afterEach(async ({ page }) => {
  if (!process.env.FLOWTAPE_KEEP) await removeHistory(page);
});

test('session history is on by default, writes redacted JSONL and remembers the toggle', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByRole('region', { name: 'flowtape recorder' });
  const toggle = overlay.getByRole('switch', { name: 'Session history' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await page.getByTestId('login-email').fill('ada@example.test');
  await page.getByTestId('login-password').fill('SuperSecretPass!');
  await page.getByTestId('login-member-id').fill('123-45-6789');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/notes$/);

  const lines = await waitForHistory(page, '/notes');
  expect(lines.length).toBeGreaterThan(4);
  const events = lines.slice(1).map((line) => JSON.parse(line));
  expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['navigate', 'input', 'click', 'submit']));
  expect(events.find((e) => e.selector === '[data-testid="login-password"]')).toMatchObject({ redacted: true, value: null });
  for (const secret of ['SuperSecretPass!', '123-45-6789']) expect(lines.join('\n')).not.toContain(secret);
  await expect(overlay.getByTestId('flowtape-history')).toContainText('.flowtape/history/');

  // Off survives a reload, and nothing more is written.
  const file = await historyFile(page);
  if (!file) throw new Error('History file missing');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  const before = fs.readFileSync(file, 'utf8');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('note-input').fill('Not logged');
  await page.getByTestId('note-add').click();
  await page.waitForTimeout(1500);
  expect(fs.readFileSync(file, 'utf8')).toBe(before);

  // On again: same tab session, same file.
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('note-input').fill('Logged again');
  await page.getByTestId('note-add').click();
  const after = await waitForHistory(page, 'Logged again');
  expect(await historyFile(page)).toBe(file);
  expect(after.join('\n')).not.toContain('Not logged');
});

test('npx @vvedantb/flowtape history lists the session file', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('login-email').fill('cli@example.test');
  await waitForHistory(page, 'cli@example.test');
  const file = await historyFile(page);
  if (!file) throw new Error('History file missing');

  const listed = flowtapeCli('history', 'examples/vite-demo');
  expect(listed.status).toBe(0);
  const first = listed.stdout.split('\n')[0];
  expect(first).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC +\d+(\.\d)? (B|KB|MB)  /);
  expect(first.endsWith(path.relative(repoRoot, file))).toBe(true);

  const unknown = flowtapeCli('nope');
  expect(unknown.status).toBe(1);
  expect(unknown.stdout).toContain('Usage: flowtape history [path]');
});
