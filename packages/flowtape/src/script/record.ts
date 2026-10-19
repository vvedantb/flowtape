/** Node only. Records a replay script from a Playwright page. */
import fs from 'node:fs';
import path from 'node:path';
import type { Page, Request, Response } from 'playwright';
import { ALLOWLIST_ATTR, REDACTED, SECRET_SCREENSHOT_SELECTOR, scrubText } from '../redact';
import { slugify } from '../schemas';
import type { PagePayload } from './inject';
import { ReplayScriptSchema, SCRIPT_VERSION, type ReplayScript, type ReplayStep } from './schema';
import { loadChromium } from './playwright';

export interface RecordOptions {
  page: Page;
  name?: string;
  /** Pause after each action before the outcome is read. Default 300 ms. */
  settleMs?: number;
  /** Longest time a redirect chain stays open while requests are still in flight. Default 5000 ms. */
  redirectMs?: number;
  /** Called for each step left out of the script, for example a page that only a one-time token opens. Default `console.warn`. */
  onWarning?: (message: string) => void;
  /** In-page agent source. Default: `inject.global.js` next to this build. */
  injectSource?: string;
}

export interface ScriptRecording {
  /** Stop listening and return the script. */
  stop(): Promise<ReplayScript>;
}

const MASK_SELECTOR = `[data-flowtape-shot-mask], ${SECRET_SCREENSHOT_SELECTOR}`;

type PageHost = {
  __flowtapeMask?: (on: boolean) => void;
  __flowtapeIsMasked?: (el: Element) => boolean;
  __flowtapeTargets?: Map<number, Element>;
  /** The element to crop for the step being shot. */
  __flowtapeCrop?: Element;
};

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

/** Quiet network time after which an action has settled, as in Playwright's `networkidle`. */
const IDLE_MS = 500;

/** True when scrubbing replaces part of the URL, so the recorded URL no longer opens the same page. */
const isRedacted = (url: string) => scrubText(url).includes(REDACTED);

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
  const redirectMs = options.redirectMs ?? 5000;
  // A redirect chain: navigations that the app or server starts after the last load or step.
  // They update the outcome of the step that started the chain (`null` is the start URL) and never become steps.
  let chainOwner: ReplayStep | null = null;
  let chainAt = Date.now();
  let activityAt = chainAt;
  const inflight = new Set<Request>();
  const isDocument = (request: Request) => request.isNavigationRequest() && request.frame() === page.mainFrame();
  // Steps are handled one at a time, so the recorder can fall well behind the user. Navigations during handling go
  // on a timeline, and stop() sorts them out by time: a navigation that started after the user's latest action had
  // settled (settleMs passed, nothing in flight, IDLE_MS of quiet network) is the user's own, and becomes a step.
  let lastActionAt: number | undefined;
  const busyNavigations: Array<{ url: string; at: number; late: boolean }> = [];
  /** When each action happened, for ordering. A merged typing step keeps its latest time. */
  const actionTimes = new Map<ReplayStep, number>();
  const settled = (now: number) => lastActionAt !== undefined && now - lastActionAt > settleMs && inflight.size === 0 && now - activityAt >= IDLE_MS;
  /** The document request behind the next main-frame navigation: when it started and whether the user had settled. */
  let documentRequest: { at: number; late: boolean } | undefined;
  const onRequest = (request: Request) => {
    // A new document drops the old one's requests, and those never report that they finished.
    if (isDocument(request)) {
      const now = Date.now();
      documentRequest = { at: now, late: settled(now) };
      return inflight.clear();
    }
    // A stream stays open, so it would hold every chain open until `redirectMs`.
    if (request.resourceType() !== 'eventsource') inflight.add(request);
  };
  // Apps redirect as soon as a response arrives, often before the request reports that it finished.
  const onResponse = (response: Response) => {
    if (!isDocument(response.request())) activityAt = Date.now();
  };
  const onRequestDone = (request: Request) => {
    if (inflight.delete(request)) activityAt = Date.now();
  };
  const chainOpen = () => {
    const now = Date.now();
    return now - chainAt < redirectMs && (inflight.size > 0 || now - activityAt < settleMs);
  };
  const startChain = (owner: ReplayStep | null, at = Date.now()) => {
    chainOwner = owner;
    chainAt = activityAt = at;
  };
  const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));

  /** `at` is when the action happened. Steps queue up behind each other, so it can be well before now. */
  const push = (step: ReplayStep, at?: number) => {
    const prev = steps[steps.length - 1];
    // Typing into one field twice in a row keeps only the final value, as in the overlay.
    const same = prev && prev.type === step.type && (step.type === 'type' || step.type === 'select') && JSON.stringify(prev.selectors) === JSON.stringify(step.selectors);
    if (same) steps[steps.length - 1] = step;
    else steps.push(step);
    if (at !== undefined && step.type !== 'navigate') actionTimes.set(step, at);
    startChain(step, at);
  };

  async function shoot(payload: PagePayload): Promise<ReplayStep['screenshots']> {
    const skip = payload.redacted || payload.type === 'scroll';
    // One round trip: take this event's own element out of the page's map, read allowlist mode, decide whether
    // the element may be cropped, and mark masked fields. Steps queue up, so every extra trip delays the next one.
    const plan = await page
      .evaluate(
        ({ id, skip, allowlist, selector }) => {
          const host = window as unknown as PageHost;
          const el = id === undefined ? undefined : host.__flowtapeTargets?.get(id);
          if (id !== undefined) host.__flowtapeTargets?.delete(id);
          const blocked = skip || !!document.querySelector(`[${allowlist}]`);
          if (blocked) return { shoot: false, crop: false, cropMask: false };
          host.__flowtapeMask?.(true);
          // A masked target (a revealed password, a masked area) gets no crop: the crop would be all secret.
          const crop = !!el && !(host.__flowtapeIsMasked?.(el) ?? true);
          host.__flowtapeCrop = crop ? el : undefined;
          // Most targets (buttons, links) hold no secret field, and a mask makes each crop slower.
          const cropMask = crop && !!el?.querySelector(selector);
          return { shoot: true, crop, cropMask };
        },
        { id: payload.targetId, skip, allowlist: ALLOWLIST_ATTR, selector: MASK_SELECTOR },
      )
      .catch(() => ({ shoot: false, crop: false, cropMask: false }));
    // A secret never reaches a screenshot: redacted steps get none, and allowlist mode none at all.
    if (!plan.shoot) return undefined;
    const shots: NonNullable<ReplayStep['screenshots']> = {};
    try {
      const mask = [page.locator(MASK_SELECTOR)];
      shots.page = b64(await page.screenshot({ type: 'png', scale: 'css', mask, timeout: 3000 }));
      const target = plan.crop ? (await page.evaluateHandle(() => (window as unknown as PageHost).__flowtapeCrop ?? null)).asElement() : null;
      if (target) shots.target = b64(await target.screenshot({ type: 'png', scale: 'css', mask: plan.cropMask ? mask : [], timeout: 1000 }));
    } catch {
      // The page may be navigating away. A step without screenshots still replays.
    } finally {
      await page.evaluate(() => (window as unknown as PageHost).__flowtapeMask?.(false)).catch(() => undefined);
    }
    return shots.page || shots.target ? shots : undefined;
  }

  async function handle(payload: PagePayload, at: number): Promise<void> {
    busy++;
    try {
      const ts = at - startedAt;
      const screenshots = await shoot(payload);
      await page.waitForTimeout(settleMs / 2);
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => undefined);
      await page.waitForTimeout(settleMs / 2);
      // The outcome comes from the timeline in stop(): the page may have moved on because of a later action.
      lastUrl = page.url();
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
        expected: { kind: 'none' },
        screenshots,
      }, at);
    } finally {
      busy--;
    }
  }

  const onNavigate = (frame: ReturnType<Page['mainFrame']>) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (startUrl === 'about:blank') {
      startUrl = lastUrl = url;
      startChain(null);
      return;
    }
    const now = Date.now();
    const request = documentRequest;
    documentRequest = undefined;
    if (busy > 0) {
      busyNavigations.push({ url, at: request?.at ?? now, late: request?.late ?? settled(now) });
      return;
    }
    if (url === lastUrl) return;
    lastUrl = url;
    if (chainOpen()) {
      // A one-time link (a magic sign-in link, a ticket) cannot be replayed once its token is redacted.
      // When it redirects to a clean page, replay opens that page instead.
      if (chainOwner === null && isRedacted(startUrl) && !isRedacted(url)) startUrl = url;
      else if (chainOwner?.type === 'navigate' && isRedacted(chainOwner.url) && !isRedacted(url)) chainOwner.url = scrubText(url);
      // Replay reaches this URL by itself, so it is the outcome of the chain's first step.
      if (chainOwner) chainOwner.expected = { kind: 'url', url: expectedUrl(chainOwner.url, url) };
      chainAt = activityAt = Date.now();
      return;
    }
    push({ type: 'navigate', ts: Date.now() - startedAt, url: scrubText(url), selectors: [], expected: { kind: 'url', url: scrubText(url) } });
  };

  await page.exposeBinding('__flowtapeEmit', (_source, payload: PagePayload) => {
    const at = Date.now();
    lastActionAt = at;
    queue = queue.then(() => handle(payload, at)).catch(() => undefined);
  });
  const source = options.injectSource ?? loadInject();
  await page.addInitScript(source);
  if (startUrl !== 'about:blank') await page.evaluate(source);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onRequestDone);
  page.on('requestfailed', onRequestDone);
  page.on('framenavigated', onNavigate);

  /**
   * Turn the timeline into steps. An action's outcome is the last on-time navigation after it and before the next
   * step, unless a redirect chain already set a later one. A late navigation becomes a navigate step at its time,
   * ending at the last on-time navigation after it (a redirect chain collapses into it).
   */
  const placeBusyNavigations = () => {
    const timeOf = (step: ReplayStep) => actionTimes.get(step) ?? startedAt + step.ts;
    const lateSteps: ReplayStep[] = [];
    busyNavigations.forEach((nav, i) => {
      if (!nav.late) return;
      const next = busyNavigations.slice(i + 1).find((n) => n.late);
      const following = busyNavigations.slice(i + 1).filter((n) => !n.late && (!next || n.at < next.at));
      const final = following.at(-1)?.url ?? nav.url;
      lateSteps.push({ type: 'navigate', ts: nav.at - startedAt, url: scrubText(nav.url), selectors: [], expected: { kind: 'url', url: scrubText(final) } });
    });
    const all = [...steps, ...lateSteps].sort((a, b) => timeOf(a) - timeOf(b));
    all.forEach((step, i) => {
      if (step.type === 'navigate' || step.expected.kind !== 'none') return;
      const start = timeOf(step);
      const end = all[i + 1] ? timeOf(all[i + 1]) : Infinity;
      const outcome = busyNavigations.filter((n) => !n.late && n.at > start && n.at < end).at(-1);
      if (outcome && outcome.url !== step.url) step.expected = { kind: 'url', url: expectedUrl(step.url, outcome.url) };
    });
    steps.splice(0, steps.length, ...all);
  };

  return {
    async stop() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onRequestDone);
      page.off('requestfailed', onRequestDone);
      page.off('framenavigated', onNavigate);
      // Flushes typing that is still debounced.
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))).catch(() => undefined);
      await page.waitForTimeout(50).catch(() => undefined);
      await queue;
      placeBusyNavigations();
      const warn = options.onWarning ?? ((message: string) => console.warn(message));
      if (isRedacted(startUrl)) warn(`flowtape: the start URL holds a redacted value, so replay cannot open it: ${scrubText(startUrl)}`);
      const replayable = steps.filter((step) => !(step.type === 'navigate' && isRedacted(step.url)));
      if (replayable.length < steps.length) warn(`flowtape: left out ${steps.length - replayable.length} navigation(s) to a URL with a redacted value. Replay cannot open them.`);
      return ReplayScriptSchema.parse({
        version: SCRIPT_VERSION,
        kind: 'flowtape-replay-script',
        id: globalThis.crypto.randomUUID(),
        name,
        createdAt: new Date(startedAt).toISOString(),
        startUrl: scrubText(startUrl),
        viewport,
        steps: replayable,
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
  const chromium = await loadChromium();
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
