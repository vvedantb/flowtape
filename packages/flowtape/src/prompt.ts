import { REDACTED, redactFlow, scrubText } from './redact';
import type { FlowDocument, FlowEvent, InputEvent } from './types';

export interface PromptOptions {
  /** Where the app runs. Default: the origin of the flow's start URL. */
  baseUrl?: string;
  /** Path to the flow JSON shown in the prompt header. Default `.flowtape/flows/<slug>.json`. */
  flowFile?: string;
}

const MAX_VALUE = 200;
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'number', 'textarea']);
const FREE_TEXT_TYPES = new Set(['text', 'search', 'textarea']);

/** Inline code that survives backticks inside the value. */
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return longest ? `${fence} ${text} ${fence}` : `${fence}${text}${fence}`;
}

function truncate(text: string): string {
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Env var an agent should read a redacted value from, e.g. `FLOWTAPE_PASSWORD`. */
export function envVarFor(event: InputEvent): string {
  const base = (event.name ?? event.inputType ?? 'secret').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `FLOWTAPE_${base || 'SECRET'}`;
}

function target(label: string | undefined, selector: string | undefined): string {
  const name = label ? `"${label}" ` : '';
  return selector ? `${name}(${code(selector)})` : name.trim();
}

function isTextInput(event: InputEvent): boolean {
  return TEXT_TYPES.has(event.inputType ?? 'text');
}

function describe(event: FlowEvent, index: number, events: FlowEvent[], pathOf: (url: string) => string): string {
  const previous = events[index - 1];
  switch (event.type) {
    case 'navigate': {
      const where = code(pathOf(event.url));
      if (!previous) return `Open ${where}.`;
      if (previous.type === 'click' || previous.type === 'submit') return `Wait for the app to move to ${where}.`;
      return `Navigate to ${where}.`;
    }
    case 'click': {
      const what = event.role ?? 'element';
      const href = event.href ? ` It links to ${code(pathOf(event.href))}.` : '';
      return `Click the ${what} ${target(event.name, event.selector)}.${href}`;
    }
    case 'input': {
      const field = target(event.name, event.selector);
      if (event.redacted) {
        const size = event.length ? ` (${event.length} characters when recorded)` : '';
        return `Fill the ${event.inputType ?? 'text'} field ${field} with the value from ${code(`$${envVarFor(event)}`)}${size}. **Redacted:** the recorded value was not stored. Never print or log it.`;
      }
      if (event.inputType === 'checkbox' || event.inputType === 'radio') {
        return `${event.value === 'checked' ? 'Check' : 'Uncheck'} the ${event.inputType} ${field}.`;
      }
      if (!event.value) return `Clear the field ${field}.`;
      // A raw line break would end the step and let typed text start new Markdown blocks.
      const value = code(truncate(event.value).replace(/\r\n?|\n/g, '\\n'));
      if (event.inputType === 'select') return `Select ${value} in ${field}.`;
      const breaks = /[\r\n]/.test(event.value) ? ' `\\n` marks a line break.' : '';
      const scrubbed = event.value.includes(REDACTED) ? ' **Redacted:** part of the recorded value looked like a secret. Type a synthetic value in its place.' : '';
      return `Type ${value} into the field ${field}.${breaks}${scrubbed}`;
    }
    case 'submit': {
      const how = [event.method?.toUpperCase(), event.action].filter(Boolean).join(' ');
      const form = `the form${event.selector ? ` ${code(event.selector)}` : ''}${how ? ` (${how})` : ''}`;
      // A submit right after a click is that click's effect, not a second action.
      if (previous?.type === 'click') return `The click in step ${index} submits ${form}. Do not submit it again.`;
      return `Submit ${form}, for example by pressing Enter in the last field.`;
    }
  }
}

/** Last index before `end` matching `test`, or -1. */
function lastIndex(events: FlowEvent[], end: number, test: (event: FlowEvent) => boolean): number {
  for (let i = end - 1; i >= 0; i--) if (test(events[i])) return i;
  return -1;
}

function assertions(events: FlowEvent[], pathOf: (url: string) => string): string[] {
  const out: string[] = [];
  events.forEach((event, index) => {
    const next = events[index + 1];
    const step = index + 1;
    if ((event.type === 'click' || event.type === 'submit') && next?.type === 'navigate') {
      out.push(`After step ${step}, the URL path is ${code(pathOf(next.url))} and the new page renders without an error screen.`);
    }
    if (event.type === 'submit') {
      out.push(`After step ${step} (submit), the form shows a success state or clear validation messages. It does not fail silently.`);
      // Same-page submits usually echo free text back (a new list item, a saved comment).
      if (next?.type === 'navigate') return;
      const start = lastIndex(events, index, (e) => e.type === 'submit' || e.type === 'navigate') + 1;
      const typed = lastIndex(events, index, (e) => e.type === 'input' && !e.redacted && !!e.value && FREE_TEXT_TYPES.has(e.inputType ?? 'text'));
      if (typed >= start) {
        out.push(`After step ${step}, the text typed in step ${typed + 1} appears on the page (for example as a new list item). TODO: confirm the exact outcome.`);
      }
    }
  });
  out.push('No uncaught console errors and no failed (4xx/5xx) network requests during the flow.');
  out.push('TODO: add product-specific checks for the final state.');
  return out;
}

function fuzzHints(events: FlowEvent[], pathOf: (url: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'input' || seen.has(event.selector)) continue;
    seen.add(event.selector);
    const field = target(event.name, event.selector);
    if (event.redacted) {
      out.push(`${field}: try an empty value and an obviously fake wrong value such as ${code('wrong-value-123')}. Never use real credentials.`);
    } else if (event.inputType === 'email') {
      out.push(`${field}: try empty, ${code('a@')}, ${code('@b.co')}, ${code('a b@c.co')} and a 300-character address.`);
    } else if (event.inputType === 'number') {
      out.push(`${field}: try empty, negative, decimal, ${code('1e309')} and non-numeric text.`);
    } else if (isTextInput(event)) {
      out.push(`${field}: try empty, whitespace only, 1,000+ characters, emoji and right-to-left text, and markup such as ${code('<b>x</b>')}.`);
    }
  }
  for (const event of events) {
    if (event.type === 'submit') {
      out.push(`Submit ${event.selector ? code(event.selector) : 'the form'} with all fields empty, then with one required field missing at a time. Double-submit quickly.`);
    }
  }
  const clicked = events.filter((e) => e.type === 'click');
  if (clicked.length) out.push('Try controls next to the recorded ones that the recording did not use, and double-click the recorded buttons.');
  const pages = [...new Set(events.filter((e) => e.type === 'navigate').map((e) => pathOf(e.url)))];
  if (pages.length > 1) out.push(`Reload the page and use browser Back/Forward on ${pages.map(code).join(', ')} mid-flow.`);
  return out;
}

/**
 * Turn a flow into a Claude Code prompt for end-to-end exploration.
 * Redaction runs again here, then once more over the final Markdown, so a secret that
 * slipped past the recorder still never reaches the prompt.
 */
export function flowToPrompt(input: FlowDocument, options: PromptOptions = {}): string {
  const doc = redactFlow(input);
  const firstNav = doc.events.find((e) => e.type === 'navigate');
  const startUrl = doc.startUrl ?? firstNav?.url;
  const baseUrl = (options.baseUrl ?? originOf(startUrl) ?? 'http://localhost:5173').replace(/\/$/, '');
  const pathOf = (url: string): string => {
    try {
      const parsed = new URL(url, baseUrl);
      return parsed.origin === baseUrl ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
    } catch {
      return url;
    }
  };
  const flowFile = options.flowFile ?? `.flowtape/flows/${doc.slug}.json`;
  const redacted = doc.events.filter((e): e is InputEvent => e.type === 'input' && e.redacted);
  const secretVars = [...new Set(redacted.map(envVarFor))];
  const submits = doc.events.filter((e) => e.type === 'submit').length;
  const pages = new Set(doc.events.filter((e) => e.type === 'navigate').map((e) => pathOf(e.url))).size;
  const viewport = doc.meta?.viewport;

  const steps = doc.events.map((event, i, events) => `${i + 1}. ${describe(event, i, events, pathOf)}`);

  const lines = [
    `# Flow: ${doc.name}`,
    '',
    `> Recorded with flowtape on ${formatDate(doc.createdAt)}. ${doc.events.length} events. Source: ${code(flowFile)}.`,
    '',
    '## Goal',
    '',
    `Replay the recorded journey "${doc.name}" in a real browser and confirm each step works as recorded. ` +
      `It covers ${pages || 1} page(s) and ${submits} form submission(s). Then explore around it using the fuzz hints and report what breaks.`,
    '',
    '## Preconditions',
    '',
    `- App running at ${code(baseUrl)}. Start the dev server first if it is not running.`,
    `- Start from ${code(pathOf(startUrl ?? baseUrl))}.`,
    '- A browser automation tool is available (for example Playwright MCP).',
    ...(viewport ? [`- Viewport about ${viewport.width}×${viewport.height}, as recorded.`] : []),
    ...(secretVars.length
      ? [`- Redacted fields read their values from environment variables: ${secretVars.map((v) => code(v)).join(', ')}. Use test credentials only.`]
      : []),
    '- Seed / known state: TODO: describe the accounts and data the app needs before step 1.',
    '',
    '## Steps',
    '',
    ...(steps.length ? steps : ['1. TODO: the recording has no events.']),
    '',
    '## Assertions',
    '',
    ...assertions(doc.events, pathOf).map((line) => `- ${line}`),
    '',
    '## Fuzz hints',
    '',
    ...fuzzHints(doc.events, pathOf).map((line) => `- ${line}`),
    '',
    '## Out of bounds',
    '',
    `- Stay on ${code(baseUrl)}. Do not follow links to other origins.`,
    '- Use synthetic test data only. Do not enter real personal data.',
    '- Secrets / credentials must never be logged, echoed, screenshotted or written to files. Refer to them by variable name only.',
    '- Do not try to recover redacted values from storage, network traffic or the flow file.',
    '- Do not change application code, databases or files under `.flowtape/` while exploring. Report findings instead.',
    '- Do not take destructive or irreversible actions (deleting data, payments, emails to real people) unless the recorded steps do.',
    '',
    '## Report back',
    '',
    '- For each step: pass or fail, with what you saw.',
    '- For each problem: exact steps to reproduce, expected result, actual result and any console or network errors.',
    '',
  ];
  return scrubText(lines.join('\n'));
}
