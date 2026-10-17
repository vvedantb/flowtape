/** Node only. Records a replay script from a Playwright page. */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { scrubText } from '../redact';
import { slugify } from '../schemas';
import type { PagePayload } from './inject';
import { ReplayScriptSchema, SCRIPT_VERSION, type ReplayScript, type ReplayStep } from './schema';

export interface RecordOptions {
  page: Page;
  name?: string;
  /** Pause after each action before the outcome is read. Default 300 ms. */
  settleMs?: number;
  /** In-page agent source. Default: `inject.global.js` next to this build. */
  injectSource?: string;
}

export interface ScriptRecording {
  /** Stop listening and return the script. */
  stop(): Promise<ReplayScript>;
}

const MASK_SELECTOR = '[data-flowtape-shot-mask], [data-flowtape-mask], [data-flowtape-mask] *';

type PageHost = { __flowtapeMask?: (on: boolean) => void; __flowtapeTarget?: Element | null };

function loadInject(): string {
  return fs.readFileSync(new URL('./inject.global.js', import.meta.url), 'utf8');
}

/** Same-origin URLs become path + search + hash, so a script replays against another host. */
export function expectedUrl(from: string, to: string): string {
  const a = new URL(from);
  const b = new URL(to);
  return scrubText(a.origin === b.origin ? b.pathname + b.search + b.hash : b.href);
}

const b64 = (png: Buffer) => png.toString('base64');

export async function recordScript(options: RecordOptions): Promise<ScriptRecording> {
  const { page } = options;
  const settleMs = options.settleMs ?? 300;
  const name = options.name?.trim() || 'Recorded flow';
  const startedAt = Date.now();
  const steps: ReplayStep[] = [];
  let startUrl = page.url();
  let lastUrl = startUrl;
  let busy = 0;
  let queue: Promise<void> = Promise.resolve();
  const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));

  const push = (step: ReplayStep) => {
    const prev = steps[steps.length - 1];
    // Typing into one field twice in a row keeps only the final value, as in the overlay.
    const same = prev && prev.type === step.type && (step.type === 'type' || step.type === 'select') && JSON.stringify(prev.selectors) === JSON.stringify(step.selectors);
    if (same) steps[steps.length - 1] = step;
    else steps.push(step);
  };

  async function shoot(payload: PagePayload): Promise<ReplayStep['screenshots']> {
    // A secret must never reach a screenshot, so redacted steps get none.
    if (payload.redacted || payload.type === 'scroll') return undefined;
    const shots: NonNullable<ReplayStep['screenshots']> = {};
    try {
      await page.evaluate(() => (window as unknown as PageHost).__flowtapeMask?.(true));
      shots.page = b64(await page.screenshot({ type: 'png', scale: 'css', mask: [page.locator(MASK_SELECTOR)], timeout: 3000 }));
      const target = (await page.evaluateHandle(() => (window as unknown as PageHost).__flowtapeTarget ?? null)).asElement();
      if (target) shots.target = b64(await target.screenshot({ type: 'png', scale: 'css', timeout: 1000 }));
    } catch {
      // The page may be navigating away. A step without screenshots still replays.
    } finally {
      await page.evaluate(() => (window as unknown as PageHost).__flowtapeMask?.(false)).catch(() => undefined);
    }
    return shots.page || shots.target ? shots : undefined;
  }

  async function handle(payload: PagePayload): Promise<void> {
    busy++;
    try {
      const ts = Date.now() - startedAt;
      const screenshots = await shoot(payload);
      await page.waitForTimeout(settleMs / 2);
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(settleMs / 2);
      const after = page.url();
      const moved = after !== lastUrl;
      lastUrl = after;
      push({
        type: payload.type,
        ts,
        url: scrubText(payload.url),
        viewport: payload.viewport,
        selectors: payload.selectors,
        value: payload.type === 'type' || payload.type === 'select' ? payload.value ?? null : undefined,
        redacted: payload.redacted || undefined,
        length: payload.length,
        inputType: payload.inputType,
        name: payload.name,
        key: payload.key,
        scroll: payload.scroll,
        expected: moved ? { kind: 'url', url: expectedUrl(payload.url, after) } : { kind: 'none' },
        screenshots,
      });
    } finally {
      busy--;
    }
  }

  const onNavigate = (frame: ReturnType<Page['mainFrame']>) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (startUrl === 'about:blank') {
      startUrl = lastUrl = url;
      return;
    }
    // Navigations during an action belong to that action's `expected`.
    if (busy > 0 || url === lastUrl) return;
    lastUrl = url;
    steps.push({ type: 'navigate', ts: Date.now() - startedAt, url: scrubText(url), selectors: [], expected: { kind: 'url', url: scrubText(url) } });
  };

  await page.exposeBinding('__flowtapeEmit', (_source, payload: PagePayload) => {
    queue = queue.then(() => handle(payload)).catch(() => undefined);
  });
  const source = options.injectSource ?? loadInject();
  await page.addInitScript(source);
  if (startUrl !== 'about:blank') await page.evaluate(source);
  page.on('framenavigated', onNavigate);

  return {
    async stop() {
      page.off('framenavigated', onNavigate);
      // Flushes typing that is still debounced.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))).catch(() => undefined);
      await page.waitForTimeout(50).catch(() => undefined);
      await queue;
      return ReplayScriptSchema.parse({
        version: SCRIPT_VERSION,
        kind: 'flowtape-replay-script',
        id: globalThis.crypto.randomUUID(),
        name,
        createdAt: new Date(startedAt).toISOString(),
        startUrl: scrubText(startUrl),
        viewport,
        steps,
      });
    },
  };
}

export interface RecordCommandOptions {
  url: string;
  out?: string;
  headed?: boolean;
  name?: string;
}

/** `flowtape record <url>`: open a browser, record until Ctrl+C or the window closes, then write JSON. */
export async function recordCommand(options: RecordCommandOptions): Promise<string> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const name = options.name ?? `Recording of ${new URL(options.url).host}`;
    const recording = await recordScript({ page, name });
    await page.goto(options.url);
    console.error(`Recording ${options.url}. Press Ctrl+C to stop.`);
    await new Promise<void>((resolve) => {
      process.once('SIGINT', () => resolve());
      process.once('SIGTERM', () => resolve());
      page.once('close', () => resolve());
    });
    const script = await recording.stop();
    const file = path.resolve(options.out ?? `.flowtape/scripts/${slugify(name)}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(script, null, 2)}\n`);
    return file;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
