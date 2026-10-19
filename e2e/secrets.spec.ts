import { expect, test, type Page } from '@playwright/test';
import { recordScript, replayScript } from '@vvedantb/flowtape/node';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decodePng } from '../packages/flowtape/src/script/image';
import { startFixture } from './fixture';

const SECRETS = { password: 'Hunter2-Secret!', code: '482913', setupKey: 'JBSWY3DPEHPK3PXP' };
const failureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-secrets-'));
let fixture: Awaited<ReturnType<typeof startFixture>>;

test.beforeAll(async () => {
  fixture = await startFixture();
});
test.afterAll(async () => {
  await fixture.close();
});

type Box = { x: number; y: number; width: number; height: number };

/** Share of pixels inside `box` (inset 3px) that are Playwright's mask colour, #ff00ff. */
function maskedShare(png: Buffer, box: Box): number {
  const { width, data } = decodePng(png);
  let hit = 0;
  let all = 0;
  for (let y = Math.ceil(box.y + 3); y < box.y + box.height - 3; y++) {
    for (let x = Math.ceil(box.x + 3); x < box.x + box.width - 3; x++) {
      const i = (y * width + x) * 4;
      all++;
      if (data[i] > 230 && data[i + 1] < 40 && data[i + 2] > 230) hit++;
    }
  }
  return hit / all;
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`No box for ${testId}`);
  return box;
}

async function recordSecrets(page: Page, url: string) {
  const recording = await recordScript({ page, name: 'Secrets' });
  await page.goto(url);
  await page.getByTestId('pw').pressSequentially(SECRETS.password);
  await page.waitForTimeout(600);
  await page.getByTestId('reveal').click();
  await page.waitForTimeout(400);
  await page.getByTestId('code').pressSequentially(SECRETS.code);
  await page.waitForTimeout(600);
  // A click on the row around the password: the crop is the row, so the field inside it must be masked.
  await page.getByTestId('pw-row').click({ position: { x: 590, y: 5 } });
  await page.getByTestId('setup-key').click();
  await page.getByTestId('verify').click();
  await page.waitForTimeout(600);
  return recording.stop();
}

test('a revealed password, a plain 2FA field and a setup key stay out of text and screenshots', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const script = await recordSecrets(page, `${fixture.url}secrets`);
  const pw = await boxOf(page, 'pw');
  const code = await boxOf(page, 'code');
  const reveal = await boxOf(page, 'reveal');
  const rowBox = await boxOf(page, 'pw-row');
  await page.close();

  const json = JSON.stringify(script);
  for (const secret of Object.values(SECRETS)) expect(json).not.toContain(secret);
  expect(script.steps.filter((s) => s.type === 'type').map((s) => [s.name, s.redacted])).toEqual([
    ['Enter your password', true],
    ['Verification code', true],
  ]);

  const clicks = script.steps.filter((s) => s.type === 'click');
  const revealClick = clicks.find((s) => s.selectors[0]?.value === 'reveal');
  // The crop is the clicked button, not whatever element came last.
  const crop = decodePng(Buffer.from(revealClick?.screenshots?.target ?? '', 'base64'));
  // Within a pixel of the button (sub-pixel layout); the password field is far larger.
  expect(Math.abs(crop.width - reveal.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(crop.height - reveal.height)).toBeLessThanOrEqual(1);
  expect(crop.width).toBeLessThan(pw.width / 2);
  // After the reveal the password is plain text on the page: every later page shot must still mask it.
  for (const step of clicks) {
    const shot = Buffer.from(step.screenshots?.page ?? '', 'base64');
    expect(maskedShare(shot, pw), `password in step ${step.selectors[0]?.value}`).toBeGreaterThan(0.95);
  }
  const row = clicks.find((s) => s.selectors[0]?.value === 'pw-row');
  const rowCrop = Buffer.from(row?.screenshots?.target ?? '', 'base64');
  expect(maskedShare(rowCrop, { x: pw.x - rowBox.x, y: pw.y - rowBox.y, width: pw.width, height: pw.height })).toBeGreaterThan(0.95);
  const verify = clicks.find((s) => s.selectors[0]?.value === 'verify');
  expect(maskedShare(Buffer.from(verify?.screenshots?.page ?? '', 'base64'), code)).toBeGreaterThan(0.95);

  // Replay fills both from FLOWTAPE_* values, reveals the password, then fails on a missing element.
  script.steps.push({ type: 'click', ts: 99_999, url: script.startUrl, selectors: [{ strategy: 'test-id', value: 'missing' }], expected: { kind: 'none' } });
  const replay = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const result = await replayScript(script, {
    page: replay,
    failureDir,
    selectorTimeoutMs: 300,
    env: { FLOWTAPE_ENTER_YOUR_PASSWORD: SECRETS.password, FLOWTAPE_VERIFICATION_CODE: SECRETS.code },
  });
  await expect(replay.getByTestId('pw')).toHaveAttribute('type', 'text');
  await expect(replay.getByTestId('pw')).toHaveValue(SECRETS.password);
  await replay.close();
  expect(result.error?.index).toBe(script.steps.length - 1);
  const after = fs.readFileSync(result.error?.after ?? '');
  expect(maskedShare(after, pw)).toBeGreaterThan(0.95);
  expect(maskedShare(after, code)).toBeGreaterThan(0.95);
});

test('allowlist mode records no screenshots at all', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const script = await recordSecrets(page, `${fixture.url}secrets?allowlist=1`);
  await page.close();
  expect(script.steps.length).toBeGreaterThan(3);
  expect(script.steps.filter((s) => s.screenshots)).toEqual([]);
});
