import { slugify } from './schemas';
import type { FlowDocument, FlowEvent, HistoryEvent, InputEvent } from './types';

/** Put this on any element (or ancestor) whose value must never be stored. */
export const MASK_ATTR = 'data-flowtape-mask';
/**
 * Allowlist mode. Inside an element with this attribute (for example `<body>`), every field is masked and
 * every non-control element drops its text, unless the element or an ancestor has `data-flowtape-safe`.
 */
export const ALLOWLIST_ATTR = 'data-flowtape-allowlist';
/** Marks a field or area whose values may be stored in allowlist mode. */
export const SAFE_ATTR = 'data-flowtape-safe';
/** Replaces secrets found inside free text. */
export const REDACTED = '[REDACTED]';

/** Field names, ids, labels and autocomplete hints that mean "secret" or "personal identifier". */
const SENSITIVE_NAME =
  /pass(word|wd|code|phrase)?|pwd|secret|token|api[-_]?key|private[-_]?key|credential|ssn|social[-_]?security|cvv|cvc|card[-_]?number|cc-(number|csc)|one-time-code|otp|(^|[^a-z])pin([^a-z]|$)|(^|[^a-z])dob([^a-z]|$)|date[-_\s]?of[-_\s]?birth|birth[-_\s]?(date|day)|bday|nhs[-_\s]?(number|no\b|num)|national[-_\s]?insurance|(^|[^a-z])ni[-_\s]?(number|no\b)/i;

/** NHS number check digit (modulus 11). A 10-digit run that fails it is not an NHS number. */
export function isNhsNumber(digits: string): boolean {
  if (!/^\d{10}$/.test(digits)) return false;
  const sum = [...digits.slice(0, 9)].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(digits[9]);
}

const RESERVED_EMAIL_DOMAIN = /@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|net|org)|[A-Za-z0-9-]+\.(?:test|example|invalid|localhost)|test|example|invalid|localhost)$/i;

/**
 * Personal data that can appear in any typed value, URL or label. Runs after the secret patterns.
 * Names, addresses and free-text notes have no reliable shape: use `data-flowtape-mask` or allowlist mode for those.
 */
const PERSONAL_PATTERNS: Array<[RegExp, (match: string) => string]> = [
  // NHS number: 10 digits, often grouped 3-3-4. Only runs that pass the check digit, so other ids survive.
  [/(?<!\d)\d{3}[ -]?\d{3}[ -]?\d{4}(?!\d)/g, (match) => (isNhsNumber(match.replace(/\D/g, '')) ? REDACTED : match)],
  // Email, except reserved example domains (RFC 2606, RFC 6761): no real person has one, and test accounts and placeholders use them.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, (match) => (RESERVED_EMAIL_DOMAIN.test(match) ? match : REDACTED)],
  // UK postcode, for example `SW1A 1AA` or `m1 1ae`.
  [/\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/gi, () => REDACTED],
  // UK mobile number.
  [/(?<![\d+])(?:\+44 ?7\d{3}|07\d{3}) ?\d{3} ?\d{3}(?!\d)/g, () => REDACTED],
];

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

/** Replace every secret-looking or personal-data-looking substring with `[REDACTED]`. */
export function scrubText(text: string): string {
  const scrubbed = SECRET_PATTERNS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
  return PERSONAL_PATTERNS.reduce((out, [pattern, replace]) => out.replace(pattern, replace), scrubbed);
}

/**
 * Text that a check can look for on the page. Recorded text with `[REDACTED]` in it never appears on the
 * page, so a check uses its longest clean part instead (`partial`). Undefined when no part is long enough.
 */
export function checkableText(text: string | undefined): { text: string; partial: boolean } | undefined {
  if (!text) return undefined;
  if (!text.includes(REDACTED)) return { text, partial: false };
  const longest = text
    .split(REDACTED)
    .map((part) => part.replace(/^[\s,.;:()-]+|[\s,.;:()-]+$/g, ''))
    .reduce((best, part) => (part.length > best.length ? part : best), '');
  return longest.length >= 3 ? { text: longest, partial: true } : undefined;
}

function scrubOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : scrubText(text);
}

/** True when a field name, id, selector or autocomplete hint looks like a secret. */
export function isSensitiveName(text: string | undefined | null): boolean {
  return !!text && SENSITIVE_NAME.test(text);
}

const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const CONTROL_ROLES = new Set(['button', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'checkbox', 'radio', 'switch', 'combobox']);

/** Buttons, tabs and similar controls. Their names are interface labels, so allowlist mode keeps them. */
function isControl(el: Element): boolean {
  const role = el.getAttribute('role');
  if (role) return CONTROL_ROLES.has(role);
  if (el.tagName === 'BUTTON' || el.tagName === 'SUMMARY') return true;
  return el.tagName === 'INPUT' && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes((el.getAttribute('type') ?? '').toLowerCase());
}

/** The element's own label text, for a field labelled "Date of birth" with no telling name or id. */
function labelOf(el: Element): string | undefined {
  const labels = 'labels' in el && el.labels instanceof NodeList ? [...el.labels] : [];
  return [el.getAttribute('aria-label'), ...labels.map((label) => label.textContent)].filter(Boolean).join(' ') || undefined;
}

/** Record-time check: must this element's value (or, for a non-field, its text) be withheld? */
export function isMaskedElement(el: Element): boolean {
  if (el.closest(`[${MASK_ATTR}]`)) return true;
  if ((el.getAttribute('type') ?? '').toLowerCase() === 'password') return true;
  if (['name', 'id', 'autocomplete'].some((attr) => isSensitiveName(el.getAttribute(attr)))) return true;
  if (FIELD_TAGS.has(el.tagName) && isSensitiveName(labelOf(el))) return true;
  // Allowlist mode: nothing inside is stored unless it is marked safe. Control names are kept.
  if (el.closest(`[${ALLOWLIST_ATTR}]`) && !el.closest(`[${SAFE_ATTR}]`)) return FIELD_TAGS.has(el.tagName) || !isControl(el);
  return false;
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
    case 'assert':
      return { ...event, selector: scrubText(event.selector), role: scrubOptional(event.role), name: scrubOptional(event.name), text: scrubOptional(event.text) };
  }
}

const MAX_ERROR_MESSAGE = 500;

/** Scrub a session history event. Error messages are scrubbed and truncated; stacks are never kept. */
export function redactHistoryEvent(event: HistoryEvent): HistoryEvent {
  if (event.type !== 'error') return redactEvent(event);
  return { ...event, message: scrubText(event.message).slice(0, MAX_ERROR_MESSAGE), source: scrubOptional(event.source) };
}

/** Scrub a whole flow. Safe to run more than once. The slug names files, so a secret in the name must not survive in it. */
export function redactFlow(doc: FlowDocument): FlowDocument {
  const name = scrubText(doc.name);
  return {
    ...doc,
    name,
    slug: name === doc.name ? slugify(scrubText(doc.slug)) : slugify(name),
    startUrl: scrubOptional(doc.startUrl),
    events: doc.events.map(redactEvent),
    meta: doc.meta && { ...doc.meta, userAgent: scrubOptional(doc.meta.userAgent) },
  };
}
