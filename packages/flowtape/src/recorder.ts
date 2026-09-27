import { isMaskedElement, redactEvent, redactHistoryEvent, scrubText } from './redact';
import { FLOW_VERSION, slugify } from './schemas';
import type { FlowDocument, FlowEvent, FlowMeta, HistoryEvent, InputEvent, NavigateEvent } from './types';

/** Mark the overlay (or any dev tooling) with this so its clicks are not recorded. */
export const UI_ATTR = 'data-flowtape-ui';

export interface RecorderSnapshot {
  recording: boolean;
  events: FlowEvent[];
  startUrl?: string;
}

export interface Recorder {
  /** Start a fresh recording. Clears any previous events. */
  start(): void;
  stop(): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): RecorderSnapshot;
}

const INTERACTIVE = 'a[href], button, input, select, textarea, summary, label, [role], [data-testid], [onclick], [tabindex]';
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'file', 'range', 'color']);
const MAX_TEXT = 80;

function clean(text: string | null | undefined): string | undefined {
  const out = text?.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return out || undefined;
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

function isField(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

function fieldType(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  return el instanceof HTMLInputElement ? el.type.toLowerCase() || 'text' : el.tagName.toLowerCase();
}

function isTextEntry(el: Element): boolean {
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

/** Accessible name, roughly per the ARIA naming order. */
export function nameFor(el: Element): string | undefined {
  const aria = clean(el.getAttribute('aria-label'));
  if (aria) return aria;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (clean(text)) return clean(text);
  }
  if (isField(el)) {
    const label = clean(el.labels?.[0]?.textContent);
    if (label) return label;
    if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(fieldType(el))) return clean(el.value);
    return clean(el.getAttribute('placeholder')) ?? clean(el.getAttribute('title'));
  }
  return clean(el.getAttribute('title')) ?? clean(el.textContent);
}

function inputEvent(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, ts: number): InputEvent {
  const inputType = fieldType(el);
  const raw = el instanceof HTMLInputElement && (inputType === 'checkbox' || inputType === 'radio') ? (el.checked ? 'checked' : 'unchecked') : el.value;
  const masked = isMaskedElement(el);
  return {
    type: 'input',
    ts,
    selector: selectorFor(el),
    inputType,
    name: nameFor(el),
    redacted: masked,
    value: masked ? null : raw,
    length: masked ? raw.length : undefined,
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
    emit({
      type: 'click',
      ts: now(),
      selector: selectorFor(el),
      role: roleFor(el),
      name: masked ? undefined : nameFor(el),
      text: masked ? undefined : clean(el.textContent),
      href: el instanceof HTMLAnchorElement ? el.getAttribute('href') ?? undefined : undefined,
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
}

/** Named flow recording. Accumulates events in memory until the overlay exports them. */
export function createRecorder(options: RecorderOptions = {}): Recorder {
  const capture = options.capture ?? createCapture(options);
  const listeners = new Set<() => void>();
  let snapshot: RecorderSnapshot = { recording: false, events: [] };
  let startedAt = 0;
  let unsubscribe: (() => void) | null = null;

  const set = (next: Partial<RecorderSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  const onEvent = (event: HistoryEvent) => {
    if (event.type === 'error') return;
    set({ events: appendEvent(snapshot.events, rebase(event, startedAt)) });
  };

  return {
    start() {
      if (snapshot.recording) return;
      startedAt = capture.now();
      set({ recording: true, events: [rebase(capture.page(), startedAt)], startUrl: scrubText(location.href) });
      unsubscribe = capture.subscribe(onEvent);
    },
    stop() {
      if (!snapshot.recording) return;
      capture.flush();
      unsubscribe?.();
      unsubscribe = null;
      set({ recording: false });
    },
    clear() {
      set({ events: [], startUrl: undefined });
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
