/**
 * Runs inside the recorded page (built as an IIFE, `dist/inject.global.js`).
 * Reports each user action to Node through the `__flowtapeEmit` binding. Never imported by Node code.
 */
import { INTERACTIVE, UI_ATTR, isField, isTextEntry, nameFor, selectorsFor } from '../recorder';
import { isMaskedElement, redactInput, watchSecretFields } from '../redact';
import type { SelectorCandidate } from '../recorder';

export interface PagePayload {
  type: 'click' | 'type' | 'select' | 'scroll' | 'key';
  url: string;
  viewport: { width: number; height: number };
  selectors: SelectorCandidate[];
  value?: string | null;
  redacted?: boolean;
  length?: number;
  inputType?: string;
  name?: string;
  key?: string;
  scroll?: { x: number; y: number };
  /** Key of this event's element in `__flowtapeTargets`. Steps queue in Node, so a single "last target" would be stale. */
  targetId?: number;
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
type Host = Window & {
  __flowtapeMask?: (on: boolean) => void;
  __flowtapeIsMasked?: (el: Element) => boolean;
  __flowtapeEmit?: (payload: PagePayload) => Promise<void>;
  __flowtapeTargets?: Map<number, Element>;
  __flowtapeInstalled?: boolean;
};

const DEBOUNCE_MS = 400;
const SCROLL_MS = 250;
const KEYS = new Set(['Enter', 'Escape', 'Tab']);

function install(host: Host) {
  if (host.__flowtapeInstalled || !host.__flowtapeEmit) return;
  host.__flowtapeInstalled = true;
  const send = host.__flowtapeEmit;
  let pending: { el: Field; timer: ReturnType<typeof setTimeout> } | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  const isUi = (el: Element) => !!el.closest(`[${UI_ATTR}]`);
  const targets = (host.__flowtapeTargets = new Map<number, Element>());
  let nextTarget = 0;
  const emit = (el: Element | null, payload: Omit<PagePayload, 'url' | 'viewport' | 'selectors' | 'targetId'>) => {
    const targetId = el ? ++nextTarget : undefined;
    if (el && targetId) targets.set(targetId, el);
    void send({ ...payload, url: location.href, viewport: { width: innerWidth, height: innerHeight }, selectors: el ? selectorsFor(el) : [], targetId });
  };

  const emitValue = (el: Field) => {
    const inputType = el instanceof HTMLInputElement ? el.type.toLowerCase() || 'text' : el.tagName.toLowerCase();
    // Same redaction as the overlay: masked and sensitive fields keep only their length.
    const { value, redacted, length, name } = redactInput({ type: 'input', ts: 0, selector: '', value: el.value, inputType, name: nameFor(el), redacted: isMaskedElement(el) });
    emit(el, { type: el instanceof HTMLSelectElement ? 'select' : 'type', value, redacted, length, inputType, name });
  };

  const flush = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { el } = pending;
    pending = null;
    emitValue(el);
  };

  const onClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || isUi(event.target)) return;
    const el = event.target.closest(INTERACTIVE) ?? event.target;
    if (isTextEntry(el) || (el instanceof HTMLLabelElement && el.control) || el instanceof HTMLSelectElement) return;
    flush();
    emit(el, { type: 'click' });
  };

  const onInput = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element) || isUi(el) || !isField(el) || !isTextEntry(el)) return;
    if (pending && pending.el !== el) flush();
    if (pending) clearTimeout(pending.timer);
    pending = { el: el as Field, timer: setTimeout(flush, DEBOUNCE_MS) };
  };

  const onChange = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element) || isUi(el) || !isField(el)) return;
    if (pending?.el === el) flush();
    else if (isTextEntry(el) || el instanceof HTMLSelectElement) emitValue(el);
  };

  const onKey = (event: KeyboardEvent) => {
    const el = event.target instanceof Element && event.target !== document.body ? event.target : null;
    if (!KEYS.has(event.key) || (el && isUi(el))) return;
    // Enter on buttons and links also fires a click, and in a textarea it is typing.
    if (event.key === 'Enter' && !(el instanceof HTMLInputElement && isTextEntry(el))) return;
    flush();
    emit(el, { type: 'key', key: event.key });
  };

  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => emit(null, { type: 'scroll', scroll: { x: Math.round(scrollX), y: Math.round(scrollY) } }), SCROLL_MS);
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  // A full page load must not lose the last typed value.
  window.addEventListener('pagehide', flush);
}

// Screenshots hide masked fields: the recorder marks them, shoots with a mask, then unmarks.
const MASKED_ATTR = 'data-flowtape-shot-mask';
(window as Host).__flowtapeIsMasked = isMaskedElement;
// A password field stays masked after a "show password" toggle switches it to text.
watchSecretFields(document);
(window as Host).__flowtapeMask = (on) => {
  for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
    if (!on) el.removeAttribute(MASKED_ATTR);
    else if (isMaskedElement(el)) el.setAttribute(MASKED_ATTR, '');
  }
};

install(window as Host);
