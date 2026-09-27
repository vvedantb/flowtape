import { isMaskedElement, redactEvent, redactInput, scrubText } from './redact';
import { FLOW_VERSION, slugify } from './schemas';
import type { FlowDocument, FlowEvent, FlowMeta, InputEvent } from './types';

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

export interface RecorderOptions {
  /** Quiet time before a burst of typing becomes one input event. Default 400ms. */
  debounceMs?: number;
  now?: () => number;
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

export function createRecorder(options: RecorderOptions = {}): Recorder {
  const debounceMs = options.debounceMs ?? 400;
  const now = options.now ?? (() => Date.now());
  const listeners = new Set<() => void>();
  let snapshot: RecorderSnapshot = { recording: false, events: [] };
  let startedAt = 0;
  let lastUrl = '';
  let pending: { el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement; timer: ReturnType<typeof setTimeout> } | null = null;
  let teardown: (() => void) | null = null;

  const set = (next: Partial<RecorderSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };
  const elapsed = () => Math.max(0, now() - startedAt);
  const push = (event: FlowEvent) => set({ events: [...snapshot.events, redactEvent(event)] });

  // Typing into the same field twice in a row keeps only the final value.
  const recordValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    const event = redactInput(inputEvent(el, elapsed()));
    const events = snapshot.events;
    const last = events[events.length - 1];
    if (last?.type === 'input' && last.selector === event.selector) set({ events: [...events.slice(0, -1), event] });
    else set({ events: [...events, event] });
  };

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
    push({ type: 'navigate', ts: elapsed(), url: location.href, title: document.title || undefined });
  };

  const onClick = (event: MouseEvent) => {
    const target = targetOf(event);
    if (!target) return;
    const el = target.closest(INTERACTIVE) ?? target;
    // Focus clicks on text fields are noise; label clicks re-fire on their control.
    if (isTextEntry(el) || (el instanceof HTMLLabelElement && el.control)) return;
    flushInput();
    const masked = isMaskedElement(el);
    push({
      type: 'click',
      ts: elapsed(),
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
    push({
      type: 'submit',
      ts: elapsed(),
      selector: selectorFor(form),
      action: form.getAttribute('action') ?? undefined,
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
    });
  };

  const attach = () => {
    const { pushState, replaceState } = history;
    history.pushState = function (this: History, ...args: Parameters<History['pushState']>) {
      pushState.apply(this, args);
      checkUrl();
    };
    history.replaceState = function (this: History, ...args: Parameters<History['replaceState']>) {
      replaceState.apply(this, args);
      checkUrl();
    };
    document.addEventListener('click', onClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', checkUrl);
    window.addEventListener('hashchange', checkUrl);
    return () => {
      history.pushState = pushState;
      history.replaceState = replaceState;
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('popstate', checkUrl);
      window.removeEventListener('hashchange', checkUrl);
    };
  };

  return {
    start() {
      if (snapshot.recording) return;
      startedAt = now();
      lastUrl = '';
      set({ recording: true, events: [], startUrl: scrubText(location.href) });
      teardown = attach();
      checkUrl();
    },
    stop() {
      if (!snapshot.recording) return;
      flushInput();
      teardown?.();
      teardown = null;
      set({ recording: false });
    },
    clear() {
      if (pending) clearTimeout(pending.timer);
      pending = null;
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
