import type { FlowDocument, FlowEvent, InputEvent } from './types';

/** Put this on any element (or ancestor) whose value must never be stored. */
export const MASK_ATTR = 'data-flowtape-mask';
/** Replaces secrets found inside free text. */
export const REDACTED = '[REDACTED]';

/** Field names, ids and autocomplete hints that mean "secret". */
const SENSITIVE_NAME =
  /pass(word|wd|code|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential|ssn|social[-_]?security|cvv|cvc|card[-_]?number|cc-(number|csc)|one-time-code|otp|(^|[^a-z])pin([^a-z]|$)/i;

/** Order matters: the specific token shapes run before the generic long-token sweep. */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
  // `https://user:pass@host`
  [/\/\/[^/\s:@]+:[^/\s@]+@/g, `//${REDACTED}@`],
  // `password=...`, `token=...` in query strings, form bodies and free text.
  [
    /\b(pass(?:word)?|passwd|pwd|secret|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|auth|authorization|session(?:[_-]?id)?|sid|credential|code|ssn)=([^&\s#"'`]+)/gi,
    `$1=${REDACTED}`,
  ],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b[spr]k_(?:live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{20,})/g, REDACTED],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAIza[0-9A-Za-z_-]{35}/g, REDACTED],
  // Long random-looking runs: mixed-case base64 with digits, or long hex. Lowercase slugs and paths survive.
  [/(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])[A-Za-z0-9+/_-]{32,}={0,2}/g, REDACTED],
  [/\b[a-fA-F0-9]{32,}\b/g, REDACTED],
];

/** Replace every secret-looking substring with `[REDACTED]`. */
export function scrubText(text: string): string {
  return SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}

function scrubOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : scrubText(text);
}

/** True when a field name, id, selector or autocomplete hint looks like a secret. */
export function isSensitiveName(text: string | undefined | null): boolean {
  return !!text && SENSITIVE_NAME.test(text);
}

/** Record-time check: must this element's value be withheld? */
export function isMaskedElement(el: Element): boolean {
  if (el.closest(`[${MASK_ATTR}]`)) return true;
  if ((el.getAttribute('type') ?? '').toLowerCase() === 'password') return true;
  return ['name', 'id', 'autocomplete'].some((attr) => isSensitiveName(el.getAttribute(attr)));
}

function isSensitiveInput(event: InputEvent): boolean {
  return event.redacted || event.inputType === 'password' || isSensitiveName(event.selector) || isSensitiveName(event.name);
}

/** Sensitive inputs lose their value entirely and keep only its length. Others get secrets scrubbed. */
export function redactInput(event: InputEvent): InputEvent {
  const base = { ...event, selector: scrubText(event.selector), name: scrubOptional(event.name) };
  if (!isSensitiveInput(event)) return { ...base, value: event.value === null ? null : scrubText(event.value) };
  return { ...base, redacted: true, value: null, length: event.length ?? event.value?.length };
}

/** Scrub one event. */
export function redactEvent(event: FlowEvent): FlowEvent {
  switch (event.type) {
    case 'navigate':
      return { ...event, url: scrubText(event.url), title: scrubOptional(event.title) };
    case 'click':
      return {
        ...event,
        selector: scrubText(event.selector),
        text: scrubOptional(event.text),
        role: scrubOptional(event.role),
        name: scrubOptional(event.name),
        href: scrubOptional(event.href),
      };
    case 'input':
      return redactInput(event);
    case 'submit':
      return { ...event, selector: scrubOptional(event.selector), action: scrubOptional(event.action), method: scrubOptional(event.method) };
  }
}

/** Scrub a whole flow. Safe to run more than once. */
export function redactFlow(doc: FlowDocument): FlowDocument {
  return {
    ...doc,
    name: scrubText(doc.name),
    startUrl: scrubOptional(doc.startUrl),
    events: doc.events.map(redactEvent),
    meta: doc.meta && { ...doc.meta, userAgent: scrubOptional(doc.meta.userAgent) },
  };
}
