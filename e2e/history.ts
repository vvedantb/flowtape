import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const demoRoot = fileURLToPath(new URL('../examples/vite-demo/', import.meta.url));
const historyDir = path.join(demoRoot, '.flowtape/history');

/** History file for the session shown in the overlay, or null before the first write. */
export async function historyFile(page: Page): Promise<string | null> {
  const sessionId = await page.getByTestId('flowtape-history-session').textContent();
  expect(sessionId).toMatch(/^[a-f0-9]{10}$/);
  const name = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).find((f) => f.endsWith(`-${sessionId}.jsonl`)) : undefined;
  return name ? path.join(historyDir, name) : null;
}

async function readHistory(page: Page): Promise<string> {
  const file = await historyFile(page);
  return file ? fs.readFileSync(file, 'utf8') : '';
}

/** Wait until the session's history file contains `text`, then return its lines. */
export async function waitForHistory(page: Page, text: string): Promise<string[]> {
  await expect.poll(() => readHistory(page)).toContain(text);
  return (await readHistory(page)).trimEnd().split('\n');
}

export async function removeHistory(page: Page): Promise<void> {
  const file = await historyFile(page);
  if (file) fs.rmSync(file, { force: true });
}
