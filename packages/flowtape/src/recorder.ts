import { isMaskedElement, redactEvent, redactHistoryEvent, scrubText, watchSecretFields } from './redact';
import { z } from 'zod';
import { FLOW_VERSION, FlowEventSchema, slugify } from './schemas';
import type { AssertEvent, FlowDocument, FlowEvent, FlowMeta, HistoryEvent, InputEvent, NavigateEvent } from './types';

/** Mark the overlay (or any dev tooling) with this so its clicks are not recorded. */
export const UI_ATTR = 'data-flowtape-ui';

export interface RecorderSnapshot {
  recording: boolean;
  events: FlowEvent[];
  startUrl?: string;
  /** True between `assertNext()` and the click that picks the element. */
  asserting: boolean;
  /** What the next pick checks. */
  check: AssertCheck;
  /** A `gone` check was picked and waits for its element to leave the page. */
  waitingGone: boolean;
}

export interface Recorder {
  /** Start a fresh recording. Clears any previous events. */
  start(): void;
  stop(): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RecorderSnapshot;
  /** While recording: the next click on the page records an assertion on that element instead of a click. */
  /** Called again while armed, it switches what the pick checks. Default `text`. */
  assertNext(check?: AssertCheck): void;
  cancelAssert(): void;
}

export const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, [role], [data-testid], [onclick], [tabindex]';
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color']);
const MAX_TEXT = 80;

function clean(text: string | null | undefined): string | undefined {
  const out = text?.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return out || undefined;
}

/**
 * Text that counts toward an accessible name: an element's text without `aria-hidden="true"` subtrees. A required
 * marker such as `<span aria-hidden="true">*</span>` is not part of the name the runner and screen readers use.
 */
function nameText(node: Node | null | undefined): string {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return '';
  return [...node.childNodes].map(nameText).join('');
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isStableId(id: string): boolean {
  // Skips React `useId` output (`:r1:`, `«r1»`) and ids with long numeric runs.
  return /^[A-Za-z][\w-]*$/.test(id) && !/\d{4,}/.test(id);
}

function stableSelector(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid=${quote(testId)}]`;
  const aria = el.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label=${quote(aria)}]`;
  const name = el.getAttribute('name');
  if (name) return `${tag}[name=${quote(name)}]`;
  if (el.id && isStableId(el.id)) return `#${el.id}`;
  return null;
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName) : [];
  return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(el) + 1})` : tag;
}

/** Stable attribute selector when possible, else a short CSS path anchored on the nearest stable ancestor. */
export function selectorFor(el: Element): string {
  const stable = stableSelector(el);
  if (stable) return stable;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.tagName !== 'HTML' && parts.length < 4) {
    const anchor = node === el ? null : stableSelector(node);
    if (anchor) {
      parts.unshift(anchor);
      break;
    }
    parts.unshift(segment(node));
    if (node.tagName === 'BODY') break;
    node = node.parentElement;
  }
  return parts.join(' > ');
}

export function isField(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function fieldType(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  return el instanceof HTMLInputElement ? el.type.toLowerCase() || 'text' : el.tagName.toLowerCase();
}

export function isTextEntry(el: Element): boolean {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(fieldType(el)));
}

/** ARIA role, explicit or implied by the tag. */
export function roleFor(el: Element): string | undefined {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  if (el instanceof HTMLAnchorElement) return el.hasAttribute('href') ? 'link' : undefined;
  if (el instanceof HTMLButtonElement || el.tagName === 'SUMMARY') return 'button';
  if (el instanceof HTMLSelectElement) return 'combobox';
  if (el instanceof HTMLTextAreaElement) return 'textbox';
  if (el instanceof HTMLInputElement) {
    const type = fieldType(el);
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    if (type === 'checkbox' || type === 'radio') return type;
    if (type === 'range') return 'slider';
    return 'textbox';
  }
  return undefined;
}

/** The name from aria-label, aria-labelledby or a field's <label>: never from the element's own content or hints. */
function labelNameFor(el: Element): string | undefined {
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => nameText(el.ownerDocument.getElementById(id)))
      .join(' ');
    if (clean(text)) return clean(text);
  }
  return isField(el) ? clean(nameText(el.labels?.[0])) : undefined;
}

/** Accessible name, roughly per the ARIA naming order. */
export function nameFor(el: Element): string | undefined {
  const label = labelNameFor(el);
  if (label) return label;
  if (isField(el)) {
    if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(fieldType(el))) return clean(el.value);
    return clean(el.getAttribute('placeholder')) ?? clean(el.getAttribute('title'));
  }
  return clean(el.getAttribute('title')) ?? clean(nameText(el));
}

/**
 * The name to record. A masked field is named only by its label, as its placeholder, title or value can hold
 * example data shaped like the secret (123-45-6789). A masked non-field (a person's name on a link) has no name.
 */
function recordedNameFor(el: Element): string | undefined {
  if (!isMaskedElement(el)) return nameFor(el);
  return isField(el) ? labelNameFor(el) : undefined;
}

export type SelectorStrategy = 'test-id' | 'role' | 'label' | 'placeholder' | 'text' | 'css';

export interface SelectorCandidate {
  strategy: SelectorStrategy;
  /** test-id: data-testid value. role: the accessible name. label, placeholder, text: the string. css: a CSS path. */
  value: string;
  role?: string;
  name?: string;
}

const MAX_SELECTOR_TEXT = 50;

/**
 * Ordered selector strategies for replay, most stable first. Missing ones are skipped. Masked elements never offer
 * their text or placeholder, and are named only as `recordedNameFor` allows.
 */
export function selectorsFor(el: Element): SelectorCandidate[] {
  const out: SelectorCandidate[] = [];
  const masked = isMaskedElement(el);
  const testId = el.getAttribute('data-testid');
  if (testId) out.push({ strategy: 'test-id', value: scrubText(testId) });
  const role = roleFor(el);
  const name = recordedNameFor(el);
  if (role && name) out.push({ strategy: 'role', role, name: scrubText(name), value: scrubText(name) });
  const label = isField(el) ? clean(nameText(el.labels?.[0])) ?? clean(el.getAttribute('aria-label')) : undefined;
  if (label) out.push({ strategy: 'label', value: scrubText(label) });
  // A masked field's placeholder can hold example data in the shape of the secret (123-45-6789), so it is not offered.
  const placeholder = masked ? undefined : clean(el.getAttribute('placeholder'));
  if (placeholder) out.push({ strategy: 'placeholder', value: scrubText(placeholder) });
  const text = isField(el) || masked ? undefined : clean(el.textContent);
  if (text && text.length <= MAX_SELECTOR_TEXT) out.push({ strategy: 'text', value: scrubText(text) });
  out.push({ strategy: 'css', value: scrubText(selectorFor(el)) });
  return out;
}

/** A selector strategy with how many elements on the page it matched when recorded. */
export type LocatorCandidate = SelectorCandidate & { matches: number };

/** Visible, as the e2e runner's exactly-one rule counts. Without `checkVisibility` (test DOMs), everything counts. */
function isVisible(el: Element): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** How many visible elements in `doc` a candidate matches, with the same exact semantics the runner uses. */
function countMatches(doc: Document, candidate: SelectorCandidate): number {
  const all = (selector: string) => [...doc.querySelectorAll(selector)].filter(isVisible);
  switch (candidate.strategy) {
    case 'test-id':
      return all('[data-testid]').filter((e) => e.getAttribute('data-testid') === candidate.value).length;
    case 'role':
      return all('*').filter((e) => roleFor(e) === candidate.role && nameFor(e) === candidate.name).length;
    case 'label':
      return all('input, textarea, select').filter((e) => isField(e) && (clean(nameText(e.labels?.[0])) ?? clean(e.getAttribute('aria-label'))) === candidate.value).length;
    case 'placeholder':
      return all('[placeholder]').filter((e) => clean(e.getAttribute('placeholder')) === candidate.value).length;
    case 'text':
      // Innermost match only: a container whose whole text is the same string is not a second match.
      return all('*').filter((e) => clean(e.textContent) === candidate.value && ![...e.children].some((child) => clean(child.textContent) === candidate.value)).length;
    case 'css':
      try {
        return all(candidate.value).length;
      } catch {
        return 0;
      }
  }
}

/**
 * Every selector strategy for `el` with its match count on the live page, so a test generator can use the first
 * that is unique instead of guessing. Values are scrubbed, as in `selectorsFor`.
 */
export function locatorsFor(el: Element): LocatorCandidate[] {
  return selectorsFor(el).map((candidate) => ({ ...candidate, matches: countMatches(el.ownerDocument, candidate) }));
}

function inputEvent(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, ts: number): InputEvent {
  const inputType = fieldType(el);
  const raw = el instanceof HTMLInputElement && (inputType === 'checkbox' || inputType === 'radio') ? (el.checked ? 'checked' : 'unchecked') : el.value;
  const masked = isMaskedElement(el);
  return {
    type: 'input',
    ts,
    selector: selectorFor(el),
    locators: locatorsFor(el),
    inputType,
    name: recordedNameFor(el),
    redacted: masked,
    value: masked ? null : raw,
    length: masked ? raw.length : undefined,
  };
}

/** Position of `el` among the elements that match `selector`, or undefined when the selector is unique. */
function nthOf(el: Element, selector: string): number | undefined {
  try {
    const all = [...el.ownerDocument.querySelectorAll(selector)];
    return all.length > 1 && all.includes(el) ? all.indexOf(el) : undefined;
  } catch {
    return undefined;
  }
}

const MAX_ASSERT_TEXT = 200;

/**
 * A selector for elements like `el`, with no position in it, so it matches the other rows of a list too: its test id,
 * else the nearest ancestor test id that other rows share (the row a child sits in, not the list around it), else its
 * own id, name or label when other elements share it, else its parent's CSS path and its tag, else tag and classes.
 * Undefined when only a positional selector would do.
 */
function sharedSelectorFor(el: Element): string | undefined {
  const doc = el.ownerDocument;
  const testIdOf = (node: Element) => `[data-testid=${quote(node.getAttribute('data-testid') ?? '')}]`;
  if (el.hasAttribute('data-testid')) return testIdOf(el);
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node.hasAttribute('data-testid') && doc.querySelectorAll(testIdOf(node)).length > 1) return testIdOf(node);
  }
  // An id or a per-row label names only this element, so it counts 1 however many rows there are.
  const own = stableSelector(el);
  if (own && doc.querySelectorAll(own).length > 1) return own;
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  const path = parent && parent.tagName !== 'HTML' ? `${selectorFor(parent)} > ${tag}` : tag;
  if (!path.includes(':nth-of-type(')) return path;
  const classes = [...el.classList].filter((c) => /^[A-Za-z_][\w-]*$/.test(c));
  return classes.length ? `${el.tagName.toLowerCase()}.${classes.join('.')}` : undefined;
}

export type AssertCheck = 'text' | 'count' | 'gone';

/** The element the user picked in assert mode. A masked element gives a visibility-only check. */
function assertEvent(picked: Element, ts: number, check: AssertCheck = 'text'): AssertEvent {
  const el = picked.closest('input, textarea, select') ?? picked;
  const masked = isMaskedElement(el);
  const text = masked ? undefined : isField(el) ? el.value : clean(el.textContent);
  const selector = selectorFor(el);
  const locators = locatorsFor(el);
  const shared = check === 'text' ? undefined : sharedSelectorFor(el);
  return {
    type: 'assert',
    ts,
    selector,
    role: roleFor(el),
    name: recordedNameFor(el),
    text: text ? text.slice(0, MAX_ASSERT_TEXT) : undefined,
    nth: nthOf(el, selector),
    locators,
    check: check === 'text' ? undefined : check,
    sharedSelector: shared,
    // Visible elements like this one, which a list's rows share.
    count: shared === undefined ? undefined : countMatches(el.ownerDocument, { strategy: 'css', value: shared }),
  };
}

function isUi(el: Element): boolean {
  return !!el.closest(`[${UI_ATTR}]`);
}

function targetOf(event: Event): Element | null {
  return event.target instanceof Element && !isUi(event.target) ? event.target : null;
}

/** Typing into the same field twice in a row keeps only the final value. */
export function appendEvent<T extends HistoryEvent>(events: T[], event: T): T[] {
  const last = events[events.length - 1];
  const sameField = last?.type === 'input' && event.type === 'input' && last.selector === event.selector;
  return sameField ? [...events.slice(0, -1), event] : [...events, event];
}

/** Shift an event's absolute `ts` (from `Capture.now`) to milliseconds since `origin`. */
export function rebase<T extends HistoryEvent>(event: T, origin: number): T {
  return { ...event, ts: Math.max(0, event.ts - origin) };
}

export interface Capture {
  /**
   * Receive every redacted event. `ts` is absolute (`now()`), so rebase it per consumer.
   * DOM listeners attach on the first subscriber and detach after the last.
   */
  subscribe(listener: (event: HistoryEvent) => void): () => void;
  /** Emit debounced typing now. */
  flush(): void;
  /** The current page as a navigate event, for a consumer that is just starting. */
  page(): NavigateEvent;
  now(): number;
}

export interface CaptureOptions {
  /** Quiet time before a burst of typing becomes one input event. Default 400ms. */
  debounceMs?: number;
  now?: () => number;
}

/**
 * Notify external-store subscribers once, in a microtask. Routers change the URL during a React commit
 * (Next.js calls `pushState` in `useInsertionEffect`), and React forbids store updates there.
 * The snapshot itself updates at once, so `getSnapshot()` is never stale.
 */
export function notifyLater(listeners: Set<() => void>): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      listeners.forEach((listener) => listener());
    });
  };
}

/**
 * One set of page listeners that any number of consumers (named recording, session history) share.
 * Each DOM event is captured and redacted once, then fanned out.
 */
export function createCapture(options: CaptureOptions = {}): Capture {
  const debounceMs = options.debounceMs ?? 400;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<(event: HistoryEvent) => void>();
  let lastUrl = '';
  let pending: { el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; timer: ReturnType<typeof setTimeout> } | null = null;
  let teardown: (() => void) | null = null;

  const emit = (event: HistoryEvent) => {
    const redacted = redactHistoryEvent(event);
    listeners.forEach((listener) => listener(redacted));
  };

  // Pre-scrubbed so `page()` is safe to hand straight to a consumer.
  const page = (): NavigateEvent => ({ type: 'navigate', ts: now(), url: scrubText(location.href), title: document.title ? scrubText(document.title) : undefined });

  const recordValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => emit(inputEvent(el, now()));

  const flushInput = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { el } = pending;
    pending = null;
    recordValue(el);
  };

  const checkUrl = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    flushInput();
    emit(page());
  };

  const onClick = (event: MouseEvent) => {
    const target = targetOf(event);
    if (!target) return;
    const el = target.closest(INTERACTIVE) ?? target;
    // Focus clicks on text fields are noise; label clicks re-fire on their control.
    if (isTextEntry(el) || (el instanceof HTMLLabelElement && el.control)) return;
    flushInput();
    const masked = isMaskedElement(el);
    const selector = selectorFor(el);
    emit({
      type: 'click',
      ts: now(),
      selector,
      role: roleFor(el),
      name: recordedNameFor(el),
      text: masked ? undefined : clean(el.textContent),
      href: el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? undefined : undefined,
      nth: nthOf(el, selector),
      locators: locatorsFor(el),
    });
  };

  const onInput = (event: Event) => {
    const el = targetOf(event);
    if (!el || !isField(el)) return;
    if (!isTextEntry(el)) {
      flushInput();
      recordValue(el);
      return;
    }
    if (pending && pending.el !== el) flushInput();
    if (pending) clearTimeout(pending.timer);
    pending = { el, timer: setTimeout(flushInput, debounceMs) };
  };

  const onChange = (event: Event) => {
    const el = targetOf(event);
    if (!el || !isField(el)) return;
    if (pending?.el === el) flushInput();
    else recordValue(el);
  };

  const onSubmit = (event: SubmitEvent) => {
    const form = targetOf(event);
    if (!(form instanceof HTMLFormElement)) return;
    flushInput();
    emit({
      type: 'submit',
      ts: now(),
      selector: selectorFor(form),
      action: form.getAttribute('action') ?? undefined,
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
    });
  };

  // Only the message, file, line and column. Stacks and error objects are never kept; redaction truncates the message.
  const onError = (event: ErrorEvent) => {
    emit({
      type: 'error',
      ts: now(),
      kind: 'error',
      message: (event.error instanceof Error ? event.error.message : event.message) || 'Unknown error',
      source: event.filename || undefined,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const { reason } = event;
    emit({ type: 'error', ts: now(), kind: 'unhandledrejection', message: (reason instanceof Error ? reason.message : String(reason)) || 'Unknown error' });
  };

  const attach = () => {
    const { pushState, replaceState } = history;
    let attached = true;
    // A password field stays masked after a "show password" toggle switches it to text.
    const unwatchSecrets = watchSecretFields(document);
    const patchedPush = function (this: History, ...args: Parameters<History['pushState']>) {
      pushState.apply(this, args);
      if (attached) checkUrl();
    };
    const patchedReplace = function (this: History, ...args: Parameters<History['replaceState']>) {
      replaceState.apply(this, args);
      if (attached) checkUrl();
    };
    history.pushState = patchedPush;
    history.replaceState = patchedReplace;
    lastUrl = location.href;
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', checkUrl);
    window.addEventListener('hashchange', checkUrl);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      attached = false;
      unwatchSecrets();
      // Leave someone else's later patch in place; ours is inert once detached.
      if (history.pushState === patchedPush) history.pushState = pushState;
      if (history.replaceState === patchedReplace) history.replaceState = replaceState;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', checkUrl);
      window.removeEventListener('hashchange', checkUrl);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      teardown ??= attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        if (pending) clearTimeout(pending.timer);
        pending = null;
        teardown?.();
        teardown = null;
      };
    },
    flush: flushInput,
    page,
    now,
  };
}

export interface RecorderOptions extends CaptureOptions {
  /** Share page listeners with session history. Default: a private capture built from the other options. */
  capture?: Capture;
  /**
   * Keep the recording in `sessionStorage`, so it survives full page loads (server-rendered forms,
   * `location.href`, reloads) in the same tab. It holds only redacted events and ends with the tab. Default true.
   */
  persist?: boolean;
}

/** sessionStorage key for a recording that must survive a full page load. */
export const RECORDING_KEY = 'flowtape:recording';

const StoredRecordingSchema = z.object({
  recording: z.boolean(),
  events: z.array(FlowEventSchema),
  startUrl: z.string().optional(),
  /** Absolute `capture.now()` at start, so `ts` keeps counting across pages. */
  startedAt: z.number(),
});
type StoredRecording = z.infer<typeof StoredRecordingSchema>;

/** sessionStorage is missing during SSR and can throw when storage is blocked or full. */
const recordingStore = {
  read(): StoredRecording | null {
    try {
      const raw = sessionStorage.getItem(RECORDING_KEY);
      const parsed = raw ? StoredRecordingSchema.safeParse(JSON.parse(raw)) : null;
      return parsed?.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  write(value: StoredRecording | null): void {
    try {
      if (value) sessionStorage.setItem(RECORDING_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(RECORDING_KEY);
    } catch {
      // A recording that cannot be stored still works on this page.
    }
  },
};

/** Named flow recording. Accumulates events until the overlay exports them. */
export function createRecorder(options: RecorderOptions = {}): Recorder {
  const capture = options.capture ?? createCapture(options);
  const persist = options.persist ?? true;
  const listeners = new Set<() => void>();
  const stored = persist ? recordingStore.read() : null;
  let snapshot: RecorderSnapshot = stored
    ? { recording: stored.recording, events: stored.events, startUrl: stored.startUrl, asserting: false, check: 'text', waitingGone: false }
    : { recording: false, events: [], asserting: false, check: 'text', waitingGone: false };
  let startedAt = stored?.startedAt ?? 0;
  let unsubscribe: (() => void) | null = null;
  const notify = notifyLater(listeners);

  const set = (next: Partial<RecorderSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    if (persist) recordingStore.write(snapshot.events.length || snapshot.recording ? { recording: snapshot.recording, events: snapshot.events, startUrl: snapshot.startUrl, startedAt } : null);
    notify();
  };

  const onEvent = (event: HistoryEvent) => {
    if (event.type === 'error') return;
    set({ events: appendEvent(snapshot.events, rebase(event, startedAt)) });
  };

  // The page is going away: typing that is still debounced must be stored before it unloads.
  const onPageHide = () => capture.flush();

  const listen = () => {
    unsubscribe = capture.subscribe(onEvent);
    window.addEventListener('pagehide', onPageHide);
  };

  // Assert mode swallows the whole pointer sequence on the page, so the app never acts on the picking click.
  // Window capture listeners run before the page capture and the app's own handlers. Overlay clicks pass.
  const swallow = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(`[${UI_ATTR}]`)) return null;
    event.preventDefault();
    event.stopImmediatePropagation();
    return target;
  };
  const record = (event: AssertEvent) => set({ events: appendEvent(snapshot.events, rebase(redactEvent(event), startedAt)) });
  let stopWaiting = () => {};
  const onAssertClick = (event: MouseEvent) => {
    const target = swallow(event);
    if (!target) return;
    const { check } = snapshot;
    disarm();
    capture.flush();
    const picked = assertEvent(target, capture.now(), check);
    if (check !== 'gone') return record(picked);
    // The check belongs after the action that removes the element, so it is recorded when the element goes.
    const el = target.closest('input, textarea, select') ?? target;
    const gone = () => !el.isConnected || (typeof el.checkVisibility === 'function' && !el.checkVisibility());
    const observer = new MutationObserver(() => {
      if (!gone()) return;
      stopWaiting();
      // Debounced typing (a filter box) can be what removed it, so it is recorded first.
      capture.flush();
      record({ ...picked, ts: capture.now() });
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    stopWaiting = () => {
      observer.disconnect();
      stopWaiting = () => {};
      set({ waitingGone: false });
    };
    set({ waitingGone: true });
  };
  const onAssertKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') disarm();
  };
  const ASSERT_SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup'] as const;
  const disarm = () => {
    if (!snapshot.asserting) return;
    window.removeEventListener('click', onAssertClick, true);
    window.removeEventListener('keydown', onAssertKey, true);
    ASSERT_SWALLOWED.forEach((type) => window.removeEventListener(type, swallow, true));
    set({ asserting: false });
  };

  // A recording that was running on the previous page carries on here, starting with this page.
  if (stored?.recording) {
    const page = rebase(capture.page(), startedAt);
    const last = [...snapshot.events].reverse().find((event) => event.type === 'navigate');
    if (last?.type !== 'navigate' || last.url !== page.url) set({ events: appendEvent(snapshot.events, page) });
    listen();
  }

  return {
    start() {
      if (snapshot.recording) return;
      startedAt = capture.now();
      set({ recording: true, events: [rebase(capture.page(), startedAt)], startUrl: scrubText(location.href) });
      listen();
    },
    stop() {
      if (!snapshot.recording) return;
      disarm();
      stopWaiting();
      capture.flush();
      unsubscribe?.();
      unsubscribe = null;
      window.removeEventListener('pagehide', onPageHide);
      set({ recording: false });
    },
    clear() {
      set({ events: [], startUrl: undefined });
    },
    assertNext(check = 'text') {
      if (!snapshot.recording) return;
      if (snapshot.asserting) return set({ check });
      stopWaiting();
      window.addEventListener('click', onAssertClick, true);
      window.addEventListener('keydown', onAssertKey, true);
      ASSERT_SWALLOWED.forEach((type) => window.addEventListener(type, swallow, true));
      set({ asserting: true, check });
    },
    cancelAssert: () => {
      disarm();
      stopWaiting();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateFlowInput {
  name: string;
  events: FlowEvent[];
  startUrl?: string;
  meta?: FlowMeta;
  now?: Date;
}

/** Wrap recorded events in a FlowDocument. Redaction runs again on the server and in the prompt. */
export function createFlowDocument(input: CreateFlowInput): FlowDocument {
  const at = (input.now ?? new Date()).toISOString();
  const name = input.name.trim() || 'Untitled flow';
  return {
    version: FLOW_VERSION,
    id: randomId(),
    slug: slugify(name),
    name,
    createdAt: at,
    updatedAt: at,
    startUrl: input.startUrl,
    events: input.events.map(redactEvent),
    meta: input.meta,
  };
}
