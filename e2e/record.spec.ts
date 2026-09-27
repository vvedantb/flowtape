import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { demoRoot, removeHistory, waitForHistory } from './history';

const slugs = ['e2e-smoke', 'e2e-copy-fails'];
const filesFor = (slug: string) => [path.join(demoRoot, `.flowtape/flows/${slug}.json`), path.join(demoRoot, `.flowtape/prompts/${slug}.md`)];
const files = filesFor('e2e-smoke');

const SECRETS = ['SuperSecretPass!', '123-45-6789'];
// Secret-looking strings typed into an ordinary free-text field. Only the scrubber can catch these.
const PLANTED_NOTE = 'Rotate sk-e2eLEAKME0123456789 and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJlMmUifQ.e2eLEAKMEsig';

// Set FLOWTAPE_KEEP=1 to inspect the output.
test.afterEach(async ({ page }) => {
  if (process.env.FLOWTAPE_KEEP) return;
  slugs.flatMap(filesFor).forEach((file) => fs.rmSync(file, { force: true }));
  await removeHistory(page);
});

function overlayOf(page: Page) {
  return page.getByRole('region', { name: 'flowtape recorder' });
}

test('record → stop → export writes a redacted flow and prompt while session history runs', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const overlay = overlayOf(page);
  const historyToggle = overlay.getByRole('switch', { name: 'Session history' });

  // A discarded take: Clear must drop it from the export.
  await overlay.getByRole('button', { name: 'Record' }).click();
  await page.getByTestId('login-email').fill('discarded@example.test');
  await overlay.getByRole('button', { name: 'Stop' }).click();
  await overlay.getByRole('button', { name: 'Clear' }).click();
  await expect(overlay.getByTestId('flowtape-count')).toHaveText('Idle · 0 events');

  await overlay.getByRole('button', { name: 'Record' }).click();
  await page.getByTestId('login-email').fill('ada@example.test');
  await page.getByTestId('login-password').fill('SuperSecretPass!');
  await page.getByTestId('login-member-id').fill('123-45-6789');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByTestId('note-input').fill('Water the plants');
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('note-item').last()).toHaveText('Water the plants');
  // Overlay clicks mid-recording must not become steps.
  await historyToggle.click();
  await historyToggle.click();
  await expect(historyToggle).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('note-input').fill(PLANTED_NOTE);
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('note-item').last()).toHaveText(PLANTED_NOTE);

  await overlay.getByRole('button', { name: 'Stop' }).click();
  await overlay.getByLabel('Flow name').fill('E2E smoke');
  await overlay.getByRole('button', { name: 'Export' }).click();
  await expect(overlay.getByTestId('flowtape-saved')).toContainText('.flowtape/prompts/e2e-smoke.md');

  const [flow, prompt] = files.map((file) => fs.readFileSync(file, 'utf8'));
  for (const text of [flow, prompt]) {
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain('LEAKME');
    expect(text).not.toContain('discarded@example.test');
  }
  expect(prompt).toContain('# Flow: E2E smoke');
  const headings = ['## Goal', '## Preconditions', '## Steps', '## Assertions', '## Fuzz hints', '## Out of bounds'];
  const positions = headings.map((heading) => prompt.split('\n').indexOf(heading));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(prompt).toContain('Type `ada@example.test` into the field "Email"');
  expect(prompt).toContain('$FLOWTAPE_PASSWORD');
  expect(prompt).toContain('$FLOWTAPE_MEMBER_ID');
  expect(prompt).toContain('Wait for the app to move to `/notes`');
  expect(prompt).toContain('Type `Water the plants` into the field "New note"');
  expect(prompt).toContain('Type `Rotate [REDACTED] and [REDACTED]` into the field "New note"');

  // Only app actions: no Record / Stop / Clear / Export / history toggle / flow name.
  const events: Array<{ type: string; selector?: string; name?: string }> = JSON.parse(flow).events;
  expect(events.filter((e) => e.type === 'click').map((e) => e.selector)).toEqual([
    '[data-testid="login-submit"]',
    '[data-testid="note-add"]',
    '[data-testid="note-add"]',
  ]);
  expect(events.filter((e) => e.type === 'input').map((e) => e.selector)).toEqual([
    '[data-testid="login-email"]',
    '[data-testid="login-password"]',
    '[data-testid="login-member-id"]',
    '[data-testid="note-input"]',
    '[data-testid="note-input"]',
  ]);
  expect(flow).not.toMatch(/Record|Stop|Clear|Export|Session history|Flow name/);

  await overlay.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(overlay.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);

  // Session history ran alongside the named recording, redacted the same way.
  const lines = await waitForHistory(page, '[REDACTED] and [REDACTED]');
  expect(JSON.parse(lines[0])).toMatchObject({ type: 'session' });
  const history = lines.join('\n');
  for (const secret of SECRETS) expect(history).not.toContain(secret);
  expect(history).not.toContain('LEAKME');
  const logged = lines.slice(1).map((line) => JSON.parse(line));
  const clicks = logged.filter((e) => e.type === 'click');
  expect(clicks.filter((e) => e.selector === '[data-testid="login-submit"]')).toHaveLength(1);
  expect(clicks.every((e) => e.selector.startsWith('[data-testid="'))).toBe(true);

  const health = await page.request.get('/__flowtape/health');
  expect(await health.json()).toEqual({ ok: true, enabled: true });
});

test('a failed clipboard write shows an error instead of an unhandled rejection', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await page.goto('/');
  const overlay = overlayOf(page);
  await overlay.getByRole('button', { name: 'Record' }).click();
  await page.getByTestId('login-email').fill('ada@example.test');
  await overlay.getByRole('button', { name: 'Stop' }).click();
  await overlay.getByLabel('Flow name').fill('E2E copy fails');
  await overlay.getByRole('button', { name: 'Export' }).click();
  await overlay.getByRole('button', { name: 'Copy prompt' }).click();
  await expect(overlay.getByRole('alert')).toContainText('Copy failed: denied. The prompt is saved in .flowtape/prompts/e2e-copy-fails.md.');

  // Anything logged after the copy lands after its would-be error line.
  await page.getByTestId('login-email').fill('after-copy@example.test');
  const lines = await waitForHistory(page, 'after-copy@example.test');
  expect(lines.slice(1).map((line) => JSON.parse(line).type)).not.toContain('error');
});
