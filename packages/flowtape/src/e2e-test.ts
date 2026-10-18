import { REDACTED, redactFlow } from './redact';
import type { FlowDocument, FlowEvent, InputEvent } from './types';

export interface E2ETestOptions {
  /** A sign-in session from the runner config (`sessions` in e2e.config.ts), for example `testUser`. */
  session?: string;
  /** Path to the flow JSON named in the header comment. Default `.flowtape/flows/<slug>.json`. */
  flowFile?: string;
}

/** Roles the runner's `getByRole` resolves by accessible name. Others fall back to text or CSS. */
const NAMED_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'combobox', 'textbox', 'heading']);
/** Assert targets whose recorded text is the field's value, not its text content. */
const VALUE_ROLES = new Set(['textbox', 'combobox', 'slider']);
const TEST_ID = /^\[data-testid="([^"\\]+)"\]$/;

/** A JavaScript string literal. */
const str = (text: string) => JSON.stringify(text);

/** `name` in the runner's secrets: kebab case of the field label, as `E2E_SECRET_<NAME>` in the environment. */
export function secretNameFor(event: InputEvent): string {
  const base = (event.name ?? event.inputType ?? 'secret')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'secret';
}

interface Target {
  selector: string;
  role?: string;
  name?: string;
  /** Visible text, used to narrow a selector that matched several elements. */
  text?: string;
  nth?: number;
}

/**
 * Most stable locator first: test id, role and accessible name, label, then CSS through `browser`.
 * The runner fails on a locator that matches several nodes, so a test id or CSS selector that did
 * when recorded is narrowed: by its text when it has some (order can change), else by position.
 */
function locator(target: Target, kind: 'action' | 'field'): string {
  const narrow = (base: string) => {
    if (target.nth === undefined) return base;
    return target.text ? `${base}.filter({ hasText: ${str(target.text)} })` : `${base}.nth(${target.nth})`;
  };
  const testId = TEST_ID.exec(target.selector)?.[1];
  if (testId) return narrow(`screen.getByTestId(${str(testId)})`);
  if (target.name && target.role && NAMED_ROLES.has(target.role) && kind === 'action') return `screen.getByRole(${str(target.role)}, ${str(target.name)})`;
  if (target.name && kind === 'field') return `screen.getByLabel(${str(target.name)})`;
  return narrow(`browser.locator(${str(target.selector)})`);
}

function pathOf(url: string, origin: string | undefined): string {
  try {
    const parsed = new URL(url, origin);
    return parsed.origin === origin ? parsed.pathname + parsed.search + parsed.hash : parsed.href;
  } catch {
    return url;
  }
}

function inputLines(event: InputEvent, secrets: Set<string>): string[] {
  const field = locator(event, 'field');
  if (event.redacted) {
    const name = secretNameFor(event);
    secrets.add(name);
    return [`await ${field}.fill(secrets.get(${str(name)}));`];
  }
  if (event.inputType === 'checkbox' || event.inputType === 'radio') return [`await ${field}.${event.value === 'checked' ? 'check' : 'uncheck'}();`];
  const value = event.value ?? '';
  if (event.inputType === 'select') return [`await ${field}.selectOption({ value: ${str(value)} });`];
  const todo = value.includes(REDACTED) ? ['// TODO: part of the recorded value looked like a secret or personal data. Use a synthetic value.'] : [];
  return [...todo, `await ${field}.fill(${str(value)});`];
}

function stepLines(event: FlowEvent, index: number, events: FlowEvent[], origin: string | undefined, secrets: Set<string>): string[] {
  const previous = events[index - 1];
  switch (event.type) {
    case 'navigate': {
      const path = pathOf(event.url, origin);
      // A navigation caused by the previous action is its outcome: check it, do not open it.
      if (previous && (previous.type === 'click' || previous.type === 'submit')) return [`await expect(browser).toHaveURL(${str(path)});`];
      return [`await app.open(${str(path)});`];
    }
    case 'click':
      return [`await ${locator(event, 'action')}.tap();`];
    case 'input':
      return inputLines(event, secrets);
    case 'submit': {
      // A submit right after a click is that click's effect.
      if (previous?.type === 'click') return [];
      const field = [...events.slice(0, index)].reverse().find((e): e is InputEvent => e.type === 'input');
      return field ? [`await ${locator(field, 'field')}.press("Enter");`] : ['// TODO: the recording submitted a form here without a click. Submit it.'];
    }
    case 'assert': {
      const target = locator(event, 'action');
      const lines = [`await expect(${target}).toBeVisible();`];
      if (event.text) lines.push(`await expect(${target}).${event.role && VALUE_ROLES.has(event.role) ? 'toHaveValue' : 'toContainText'}(${str(event.text)});`);
      return lines;
    }
  }
}

/**
 * A test file for the `e2e` runner (`@e2e-dev/web`) that replays the flow with exact steps.
 * The flow is redacted again first. Masked values come from the runner's `secrets`, never from the file.
 */
export function flowToE2ETest(input: FlowDocument, options: E2ETestOptions = {}): string {
  const doc = redactFlow(input);
  const origin = doc.startUrl ? new URL(doc.startUrl).origin : undefined;
  const secrets = new Set<string>();
  const body = doc.events.flatMap((event, index, events) => stepLines(event, index, events, origin, secrets));
  if (!doc.events.some((event) => event.type === 'assert')) body.push('// TODO: check the final state, or record a check with Assert in the flowtape overlay.');

  const imports = secrets.size ? 'import { expect, secrets } from "e2e";' : 'import { expect } from "e2e";';
  const testOptions = options.session ? `{ session: ${str(options.session)}, requires: ["browser"] }` : '{ requires: ["browser"] }';
  const flowFile = options.flowFile ?? `.flowtape/flows/${doc.slug}.json`;
  // The runner reads E2E_SECRET_<NAME> only as an override of a declared secret, and a declared value must
  // be 6+ characters or a provider. A provider that returns "" loads the config and fails clearly at fill time.
  const names = [...secrets];
  const secretNote = names.length
    ? [
        `// Masked values come from the runner's secrets. Declare them in e2e.config.ts: secrets: { ${names.map((name) => `${str(name)}: () => ""`).join(', ')} },`,
        `// then supply them per run (6+ characters) with ${names.map((name) => `E2E_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`).join(', ')}.`,
      ]
    : [];

  return [
    `// Generated by flowtape from ${flowFile}. Review it before you move it into your tests folder:`,
    '// recorded names are approximate, and the runner matches names exactly.',
    ...secretNote,
    'import { test } from "@e2e-dev/web";',
    imports,
    '',
    `test(${str(doc.name)}, ${testOptions}, async ({ app, screen, browser }) => {`,
    ...body.map((line) => `  ${line}`),
    '});',
    '',
  ].join('\n');
}
