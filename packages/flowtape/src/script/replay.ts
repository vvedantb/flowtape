/** Node only. Replays a script with Playwright. Tries selectors in order, then optionally asks Jev where the target is. */
import fs from 'node:fs';
import path from 'node:path';
import { envVarFor } from '../prompt';
import { fitImage, type FittedImage } from './image';
import { createJevClient, type JevClient, type JevQuestion } from './jev';
import { ReplayScriptSchema, type ReplayScript, type ReplaySelector, type ReplayStep } from './schema';
import { loadChromium } from './playwright';

/** The slice of Playwright's `Page` and `Locator` that replay uses. A real `Page` fits. */
export interface ReplayLocator {
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<void>;
  fill(value: string, options?: { timeout?: number }): Promise<void>;
  selectOption(value: string, options?: { timeout?: number }): Promise<unknown>;
  press(key: string, options?: { timeout?: number }): Promise<void>;
}

export interface ReplayPage {
  url(): string;
  goto(url: string, options?: { waitUntil?: 'networkidle'; timeout?: number }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', options?: { timeout?: number }): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(fn: (arg: any) => unknown, arg?: unknown): Promise<unknown>;
  locator(selector: string): ReplayLocator;
  getByRole(role: any, options: { name: string; exact: boolean }): ReplayLocator;
  getByLabel(text: string, options: { exact: boolean }): ReplayLocator;
  getByPlaceholder(text: string, options: { exact: boolean }): ReplayLocator;
  getByText(text: string, options: { exact: boolean }): ReplayLocator;
  mouse: { click(x: number, y: number): Promise<void> };
  keyboard: { press(key: string): Promise<void>; insertText(text: string): Promise<void> };
  screenshot(options?: { type: 'png'; scale: 'css' }): Promise<Buffer>;
  viewportSize(): { width: number; height: number } | null;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
}

export interface ReplayOptions {
  page: ReplayPage;
  /** Replay against this URL instead of `script.startUrl`. */
  startUrl?: string;
  /** Visual fallback. Leave unset for selector-only replay: nothing then touches the network. */
  jev?: JevClient;
  /** Minimum confidence per step. Default 0.7. */
  threshold?: number;
  /** Where failure screenshots go. Default `.flowtape/replay-failures`. */
  failureDir?: string;
  /** How long to keep retrying selectors before giving up on them. Default 3000 ms. */
  selectorTimeoutMs?: number;
  /** How long to wait for a step's expected outcome. Default 5000 ms. */
  expectTimeoutMs?: number;
  /** Time the DOM must stay quiet. Default 300 ms. */
  stableMs?: number;
  /** Where `FLOWTAPE_*` secrets come from. Default `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface TriedSelector {
  strategy: ReplaySelector['strategy'];
  value: string;
  matches: number;
}

export interface StepResult {
  index: number;
  type: ReplayStep['type'];
  /** What found the target: a selector strategy, `jev`, or `none` for steps without a target. */
  via: ReplaySelector['strategy'] | 'jev' | 'none';
  tried: TriedSelector[];
  /** 1 for selector hits. For Jev, the lowest confidence it returned. */
  confidence: number;
  note?: string;
}

export interface ReplayFailure {
  index: number;
  type: ReplayStep['type'];
  tried: TriedSelector[];
  reason: string;
  before?: string;
  after?: string;
}

export interface ReplayResult {
  ok: boolean;
  steps: StepResult[];
  error?: ReplayFailure;
}

class StepFailure extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ACTION_TIMEOUT = 5000;
const POLL_MS = 250;

function locatorFor(page: ReplayPage, s: ReplaySelector): ReplayLocator {
  switch (s.strategy) {
    case 'test-id':
      return page.locator(`[data-testid=${JSON.stringify(s.value)}]`);
    case 'role':
      return page.getByRole(s.role ?? '', { name: s.name ?? s.value, exact: true });
    case 'label':
      return page.getByLabel(s.value, { exact: true });
    case 'placeholder':
      return page.getByPlaceholder(s.value, { exact: true });
    case 'text':
      return page.getByText(s.value, { exact: true });
    case 'css':
      return page.locator(s.value);
  }
}

/** Network idle, then no DOM mutations for `quietMs` (capped), so the next step sees a settled page. */
async function settle(page: ReplayPage, quietMs: number): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
  await page
    .evaluate(
      ({ quiet, max }: { quiet: number; max: number }) =>
        new Promise<void>((resolve) => {
          let timer = setTimeout(done, quiet);
          const cap = setTimeout(done, max);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(done, quiet);
          });
          function done() {
            observer.disconnect();
            clearTimeout(timer);
            clearTimeout(cap);
            resolve();
          }
          observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
        }),
      { quiet: quietMs, max: 3000 },
    )
    .catch(() => undefined);
}

/** First selector, in recorded order, that matches exactly one element. Retries until the timeout. */
async function findBySelectors(page: ReplayPage, selectors: ReplaySelector[], timeoutMs: number): Promise<{ locator?: ReplayLocator; via?: ReplaySelector['strategy']; tried: TriedSelector[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const tried: TriedSelector[] = [];
    for (const selector of selectors) {
      const locator = locatorFor(page, selector);
      const matches = await locator.count().catch(() => 0);
      tried.push({ strategy: selector.strategy, value: selector.value, matches });
      // Two matches are ambiguous. Moving on is safer than clicking the wrong one.
      if (matches === 1) return { locator, via: selector.strategy, tried };
    }
    if (Date.now() >= deadline) return { tried };
    await sleep(POLL_MS);
  }
}

function describeTarget(step: ReplayStep): string {
  const role = step.selectors.find((s) => s.strategy === 'role');
  if (role) return `the ${role.role} named "${role.name ?? role.value}"`;
  const text = step.selectors.find((s) => s.strategy === 'text' || s.strategy === 'label' || s.strategy === 'placeholder');
  return text ? `the element with ${text.strategy} "${text.value}"` : 'the element';
}

interface VisualHit {
  x: number;
  y: number;
  confidence: number;
}

/** Jev: is the target on screen (noul), and where (box)? Returns the centre in page CSS pixels. */
async function jevLocate(jev: JevClient, page: ReplayPage, step: ReplayStep, threshold: number): Promise<VisualHit> {
  const shot = fitImage(await page.screenshot({ type: 'png', scale: 'css' }));
  const assets: Record<string, { type: 'image'; format: 'png'; data_base64: string }> = { ft_page: { type: 'image', format: 'png', data_base64: shot.png.toString('base64') } };
  let target = describeTarget(step);
  if (step.screenshots?.target) {
    assets.ft_target = { type: 'image', format: 'png', data_base64: fitImage(Buffer.from(step.screenshots.target, 'base64')).png.toString('base64') };
    target = `the UI element shown in \`target\` (${target})`;
  }
  const state: Record<string, string> = { page: 'ft_page' };
  if (assets.ft_target) state.target = 'ft_target';
  const questions: Record<string, JevQuestion> = {
    present: {
      type: 'noul',
      instructions: `Is ${target} visible in \`page\`?`,
      criteria: { true: 'The element is visible in the page screenshot', false: 'The element is not in the page screenshot' },
    },
    where: { type: 'box', instructions: `${target} as it appears in \`page\`` },
  };
  const { answers } = await jev.ask({ state, questions, assets });
  const presence = answers.present;
  const where = answers.where;
  if (presence?.type !== 'noul' || where?.type !== 'box') throw new StepFailure('Jev returned unexpected answer types');
  // The box question has no "not found", so a low presence score discards the box.
  if (presence.noul < threshold) throw new StepFailure(`Jev: target not found on the page (presence ${presence.noul.toFixed(2)} < ${threshold})`);
  const confidence = Math.min(presence.noul, where.confidence);
  if (confidence < threshold) throw new StepFailure(`Jev: confidence ${confidence.toFixed(2)} below threshold ${threshold}`);
  return { ...centre(where.box, shot), confidence };
}

/** Box edges are 0-1 of the fitted image. Undo padding and scaling to reach page pixels. */
function centre(box: { top: number; bottom: number; left: number; right: number }, shot: FittedImage): { x: number; y: number } {
  return {
    x: (((box.left + box.right) / 2) * shot.width - shot.offsetX) / shot.scale,
    y: (((box.top + box.bottom) / 2) * shot.height - shot.offsetY) / shot.scale,
  };
}

function urlMatches(current: string, expected: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(expected)) return current === expected;
  const url = new URL(current);
  return url.pathname + url.search + url.hash === expected;
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(100);
  }
}

async function expectationMet(page: ReplayPage, step: ReplayStep, timeoutMs: number): Promise<boolean> {
  const { expected } = step;
  if (expected.kind === 'url' && expected.url) return until(() => urlMatches(page.url(), expected.url as string), timeoutMs);
  if (expected.kind === 'element' && expected.selector) return until(async () => (await page.locator(expected.selector as string).count()) > 0, timeoutMs);
  return true;
}

function describeExpected(step: ReplayStep): string {
  const { expected } = step;
  if (expected.kind === 'url') return `the page is now at "${expected.url}"`;
  return `an element matching "${expected.selector}"${expected.text ? ` with text "${expected.text}"` : ''} is visible`;
}

function resolveUrl(page: ReplayPage, url: string): string {
  const base = page.url();
  return base && base !== 'about:blank' ? new URL(url, base).href : url;
}

/** Redacted values come from `FLOWTAPE_*` env vars. With none set, the field is left empty: flowtape never invents a secret. */
function secretFor(step: ReplayStep, env: Record<string, string | undefined>): string | undefined {
  return env[envVarFor({ type: 'input', ts: 0, selector: '', value: null, redacted: true, name: step.name, inputType: step.inputType })];
}

export async function replayScript(input: ReplayScript, options: ReplayOptions): Promise<ReplayResult> {
  const script = ReplayScriptSchema.parse(input);
  const { page, jev } = options;
  const threshold = options.threshold ?? 0.7;
  const stableMs = options.stableMs ?? 300;
  const env = options.env ?? process.env;
  const results: StepResult[] = [];
  const runDir = path.resolve(options.failureDir ?? '.flowtape/replay-failures', new Date().toISOString().replace(/[:.]/g, '-'));

  const current = page.viewportSize();
  if (!current || current.width !== script.viewport.width || current.height !== script.viewport.height) await page.setViewportSize(script.viewport);
  await page.goto(options.startUrl ?? script.startUrl, { waitUntil: 'networkidle' });
  await settle(page, stableMs);

  let tried: TriedSelector[] = [];
  for (const [index, step] of script.steps.entries()) {
    tried = [];
    const before = await page.screenshot({ type: 'png', scale: 'css' }).catch(() => undefined);
    try {
      results.push(await runStep(step, index));
    } catch (error) {
      return { ok: false, steps: results, error: await report(error, index, step, tried, before) };
    }
  }
  return { ok: true, steps: results };

  async function runStep(step: ReplayStep, index: number): Promise<StepResult> {
    const result: StepResult = { index, type: step.type, via: 'none', tried: [], confidence: 1 };
    if (step.type === 'navigate') {
      await page.goto(resolveUrl(page, step.url), { waitUntil: 'networkidle' });
    } else if (step.type === 'scroll') {
      await page.evaluate(({ x, y }: { x: number; y: number }) => window.scrollTo(x, y), step.scroll ?? { x: 0, y: 0 });
    } else if (step.type === 'key' && step.selectors.length === 0) {
      await page.keyboard.press(step.key ?? 'Enter');
    } else {
      const found = await findBySelectors(page, step.selectors, options.selectorTimeoutMs ?? 3000);
      result.tried = found.tried;
      tried = found.tried;
      if (found.locator && found.via) {
        result.via = found.via;
        await act(step, found.locator, result);
      } else if (jev) {
        const hit = await jevLocate(jev, page, step, threshold);
        result.via = 'jev';
        result.confidence = hit.confidence;
        await actAt(step, hit, result);
      } else {
        throw new StepFailure('No selector matched exactly one element');
      }
    }
    await settle(page, stableMs);
    if (!(await expectationMet(page, step, options.expectTimeoutMs ?? 5000))) {
      if (!jev) throw new StepFailure(`Expected outcome not reached: ${describeExpected(step)}`);
      const after = fitImage(await page.screenshot({ type: 'png', scale: 'css' }));
      const { answers } = await jev.ask({
        state: { after: 'ft_after' },
        questions: { outcome: { type: 'noul', instructions: `Does \`after\` show this outcome: ${describeExpected(step)}?`, criteria: { true: 'The outcome is visible', false: 'The outcome is not visible' } } },
        assets: { ft_after: { type: 'image', format: 'png', data_base64: after.png.toString('base64') } },
      });
      const answer = answers.outcome;
      const noul = answer?.type === 'noul' ? answer.noul : 0;
      if (noul < threshold) throw new StepFailure(`Expected outcome not reached: ${describeExpected(step)} (Jev ${noul.toFixed(2)} < ${threshold})`);
      result.confidence = Math.min(result.confidence, noul);
    }
    return result;
  }

  async function act(step: ReplayStep, locator: ReplayLocator, result: StepResult): Promise<void> {
    const timeout = { timeout: ACTION_TIMEOUT };
    if (step.type === 'click') await locator.click(timeout);
    else if (step.type === 'key') await locator.press(step.key ?? 'Enter', timeout);
    else if (step.type === 'select') await locator.selectOption(step.value ?? '', timeout);
    else if (step.type === 'type') {
      const value = step.redacted ? secretFor(step, env) : step.value ?? '';
      if (value === undefined) result.note = `Skipped: ${envVarFor({ type: 'input', ts: 0, selector: '', value: null, redacted: true, name: step.name, inputType: step.inputType })} is not set`;
      else await locator.fill(value, timeout);
    }
  }

  async function actAt(step: ReplayStep, at: { x: number; y: number }, result: StepResult): Promise<void> {
    if (step.type === 'select') throw new StepFailure('Jev cannot choose an option in a select. Fix the selectors.');
    await page.mouse.click(at.x, at.y);
    if (step.type === 'key') await page.keyboard.press(step.key ?? 'Enter');
    if (step.type === 'type') {
      const value = step.redacted ? secretFor(step, env) : step.value ?? '';
      if (value === undefined) result.note = 'Skipped: no FLOWTAPE_* value set';
      else {
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.insertText(value);
      }
    }
  }

  async function report(error: unknown, index: number, step: ReplayStep, tried: TriedSelector[], before: Buffer | undefined): Promise<ReplayFailure> {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    const failure: ReplayFailure = { index, type: step.type, tried, reason };
    try {
      const after = await page.screenshot({ type: 'png', scale: 'css' }).catch(() => undefined);
      fs.mkdirSync(runDir, { recursive: true });
      if (before) fs.writeFileSync((failure.before = path.join(runDir, `step-${index + 1}-before.png`)), before);
      if (after) fs.writeFileSync((failure.after = path.join(runDir, `step-${index + 1}-after.png`)), after);
    } catch {
      // The report matters more than its screenshots.
    }
    return failure;
  }
}

/** Plain-text failure report for stderr. */
export function formatFailure(f: ReplayFailure): string {
  const tried = f.tried.length ? f.tried.map((t) => `    ${t.strategy} ${JSON.stringify(t.value)}: ${t.matches} match${t.matches === 1 ? '' : 'es'}`).join('\n') : '    (none)';
  return [`Replay failed at step ${f.index + 1} (${f.type}).`, `  Reason: ${f.reason}`, '  Selectors tried:', tried, f.before ? `  Before: ${f.before}` : '', f.after ? `  After: ${f.after}` : ''].filter(Boolean).join('\n');
}

export interface ReplayCommandOptions {
  file: string;
  /** true: require Jev. false: selector-only. undefined: use Jev only when `TYPESAFE_API_KEY` is set. */
  jev?: boolean;
  threshold?: number;
  headed?: boolean;
}

/** `flowtape replay <file>`. Returns the process exit code. */
export async function replayCommand(options: ReplayCommandOptions): Promise<number> {
  const script = ReplayScriptSchema.parse(JSON.parse(fs.readFileSync(options.file, 'utf8')));
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (options.jev && !apiKey) {
    console.error('--jev needs TYPESAFE_API_KEY.');
    return 1;
  }
  const jev = options.jev !== false && apiKey ? createJevClient({ apiKey }) : undefined;
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const page = await browser.newPage({ viewport: script.viewport });
    const result = await replayScript(script, { page, jev, threshold: options.threshold });
    if (result.error) {
      console.error(formatFailure(result.error));
      return 1;
    }
    for (const step of result.steps) console.log(`${step.index + 1}. ${step.type} via ${step.via}${step.confidence < 1 ? ` (confidence ${step.confidence.toFixed(2)})` : ''}${step.note ? ` - ${step.note}` : ''}`);
    console.log(`Replayed ${result.steps.length} steps. ${jev ? 'Jev enabled.' : 'Selector-only.'}`);
    return 0;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
