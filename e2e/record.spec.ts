import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const demoRoot = fileURLToPath(new URL('../examples/vite-demo/', import.meta.url));
const slug = 'e2e-smoke';
const files = [path.join(demoRoot, `.flowtape/flows/${slug}.json`), path.join(demoRoot, `.flowtape/prompts/${slug}.md`)];

// Set FLOWTAPE_KEEP=1 to inspect the output.
test.afterEach(() => {
  if (!process.env.FLOWTAPE_KEEP) files.forEach((file) => fs.rmSync(file, { force: true }));
});

test('record → stop → export writes a redacted flow and prompt', async ({ page }) => {
  await page.goto('/');
  const overlay = page.getByRole('region', { name: 'flowtape recorder' });
  await overlay.getByRole('button', { name: 'Record' }).click();

  await page.getByTestId('login-email').fill('ada@example.test');
  await page.getByTestId('login-password').fill('SuperSecretPass!');
  await page.getByTestId('login-member-id').fill('123-45-6789');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByTestId('note-input').fill('Water the plants');
  await page.getByTestId('note-add').click();
  await expect(page.getByTestId('note-item').last()).toHaveText('Water the plants');

  await overlay.getByRole('button', { name: 'Stop' }).click();
  await overlay.getByLabel('Flow name').fill('E2E smoke');
  await overlay.getByRole('button', { name: 'Export' }).click();
  await expect(overlay.getByTestId('flowtape-saved')).toContainText(`.flowtape/prompts/${slug}.md`);

  const [flow, prompt] = files.map((file) => fs.readFileSync(file, 'utf8'));
  for (const secret of ['SuperSecretPass!', '123-45-6789']) {
    expect(flow).not.toContain(secret);
    expect(prompt).not.toContain(secret);
  }
  expect(prompt).toContain('# Flow: E2E smoke');
  expect(prompt).toContain('Type `ada@example.test` into the field "Email"');
  expect(prompt).toContain('$FLOWTAPE_PASSWORD');
  expect(prompt).toContain('$FLOWTAPE_MEMBER_ID');
  expect(prompt).toContain('Wait for the app to move to `/notes`');
  expect(prompt).toContain('Type `Water the plants` into the field "New note"');

  const health = await page.request.get('/__flowtape/health');
  expect(await health.json()).toEqual({ ok: true, enabled: true });
});
