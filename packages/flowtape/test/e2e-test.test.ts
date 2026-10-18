import { describe, expect, it } from 'vitest';
import { flowToE2ETest } from '../src/e2e-test';
import type { FlowEvent } from '../src/types';
import { makeFlow } from './fixtures';

const events: FlowEvent[] = [
  { type: 'navigate', ts: 0, url: 'http://localhost:5173/' },
  { type: 'input', ts: 1, selector: '[data-testid="login-email"]', inputType: 'email', name: 'Email', value: 'ada@example.test', redacted: false },
  { type: 'input', ts: 2, selector: '#pw', inputType: 'password', name: 'Password', value: null, redacted: true, length: 8 },
  { type: 'click', ts: 3, selector: 'form > button', role: 'button', name: 'Sign in' },
  { type: 'submit', ts: 4, selector: 'form', method: 'get' },
  { type: 'navigate', ts: 5, url: 'http://localhost:5173/notes' },
  { type: 'input', ts: 6, selector: '#tier', inputType: 'select', name: 'Care tier', value: '2', redacted: false },
  { type: 'input', ts: 7, selector: '#live-in', inputType: 'checkbox', name: 'Live-in', value: 'checked', redacted: false },
  { type: 'input', ts: 8, selector: '#note', inputType: 'text', name: 'Note', value: 'Water the plants', redacted: false },
  { type: 'submit', ts: 9, selector: '#add-form', method: 'get' },
  { type: 'assert', ts: 10, selector: '[data-testid="note-item"]', text: 'Water the plants' },
  { type: 'assert', ts: 11, selector: '#note', role: 'textbox', name: 'Note', text: '' },
];

describe('flowToE2ETest', () => {
  const out = flowToE2ETest(makeFlow(events, { startUrl: 'http://localhost:5173/' }));

  it('writes a runner test with exact steps, most stable locator first', () => {
    expect(out).toContain('import { test } from "@e2e-dev/web";');
    expect(out).toContain('import { expect, secrets } from "e2e";');
    expect(out).toContain('test("Login and add note", { requires: ["browser"] }, async ({ app, screen, browser }) => {');
    const steps = out.split('\n').filter((line) => line.startsWith('  await'));
    expect(steps).toEqual([
      '  await app.open("/");',
      '  await screen.getByTestId("login-email").fill("ada@example.test");',
      '  await screen.getByLabel("Password").fill(secrets.get("password"));',
      '  await screen.getByRole("button", "Sign in").tap();',
      '  await expect(browser).toHaveURL("/notes");',
      '  await screen.getByLabel("Care tier").selectOption({ value: "2" });',
      '  await screen.getByLabel("Live-in").check();',
      '  await screen.getByLabel("Note").fill("Water the plants");',
      '  await screen.getByLabel("Note").press("Enter");',
      '  await expect(screen.getByTestId("note-item")).toBeVisible();',
      '  await expect(screen.getByTestId("note-item")).toContainText("Water the plants");',
      '  await expect(screen.getByRole("textbox", "Note")).toBeVisible();',
    ]);
    expect(out).toContain('// Masked values come from the runner\'s secrets. Declare them in e2e.config.ts: secrets: { "password": () => "" },');
    expect(out).toContain('// then supply them per run (6+ characters) with E2E_SECRET_PASSWORD.');
    expect(out).not.toContain('TODO: check the final state');
  });

  it('never writes a masked value, and redacts again before writing', () => {
    const leaky = flowToE2ETest(
      makeFlow([
        { type: 'input', ts: 0, selector: '#pw', inputType: 'password', value: 'hunter2', redacted: false },
        { type: 'input', ts: 1, selector: '#nhs', name: 'NHS number', value: '943 476 5919', redacted: false },
        { type: 'input', ts: 2, selector: '#notes', name: 'Notes', value: 'Call 943 476 5919', redacted: false },
      ]),
    );
    expect(leaky).not.toMatch(/hunter2|943 476 5919/);
    expect(leaky).toContain('fill(secrets.get("nhs-number"))');
    expect(leaky).toContain('// TODO: part of the recorded value looked like a secret or personal data.');
    expect(leaky).toContain('// TODO: check the final state, or record a check with Assert');
  });

  it('narrows a selector that matched several elements when recorded', () => {
    const narrowed = flowToE2ETest(
      makeFlow([
        { type: 'assert', ts: 0, selector: '[data-testid="note-item"]', text: 'Water the plants', nth: 3 },
        { type: 'click', ts: 1, selector: 'ul > li > button', role: 'button', nth: 2 },
      ]),
    );
    expect(narrowed).toContain('await expect(screen.getByTestId("note-item").filter({ hasText: "Water the plants" })).toContainText("Water the plants");');
    expect(narrowed).toContain('await browser.locator("ul > li > button").nth(2).tap();');
  });

  it('adds a sign-in session and escapes strings', () => {
    const withSession = flowToE2ETest(makeFlow([{ type: 'click', ts: 0, selector: '#x', role: 'button', name: 'Say "hi"' }], { name: 'Quote "test"' }), { session: 'testUser' });
    expect(withSession).toContain('test("Quote \\"test\\"", { session: "testUser", requires: ["browser"] },');
    expect(withSession).toContain('screen.getByRole("button", "Say \\"hi\\"").tap();');
  });
});

describe('recorded text with redacted parts', () => {
  it('checks the longest clean part, or only visibility when none is left', () => {
    const out = flowToE2ETest(
      makeFlow([
        { type: 'assert', ts: 0, selector: '[data-testid="row"]', text: 'Seen at [REDACTED], mail [REDACTED]', nth: 2 },
        { type: 'assert', ts: 1, selector: '#nhs-label', text: 'No [REDACTED]' },
        { type: 'assert', ts: 2, selector: '#field', role: 'textbox', name: 'Notes', text: 'Call [REDACTED] today' },
      ]),
    );
    expect(out).not.toContain('[REDACTED]"');
    expect(out).not.toContain('hasText');
    expect(out).toContain('await expect(screen.getByTestId("row").nth(2)).toBeVisible();');
    expect(out).toContain('// Part of the recorded text was redacted. This checks the rest.');
    expect(out).toContain('await expect(screen.getByTestId("row").nth(2)).toContainText("Seen at");');
    expect(out).toContain('await expect(browser.locator("#nhs-label")).toBeVisible();\n  // TODO: the recorded text was redacted, so only visibility is checked.');
    expect(out).toContain('// TODO: part of the recorded value was redacted. Add a check for a synthetic value.');
    expect(out).not.toContain('toHaveValue');
  });

  it('narrows by full clean text, but by position for field values', () => {
    const out = flowToE2ETest(
      makeFlow([
        { type: 'assert', ts: 0, selector: '[data-testid="row"]', text: 'Seen at noon', nth: 1 },
        { type: 'assert', ts: 1, selector: '[data-testid="note"]', role: 'textbox', text: 'Water the plants', nth: 3 },
      ]),
    );
    expect(out).toContain('await expect(screen.getByTestId("row").filter({ hasText: "Seen at noon" })).toContainText("Seen at noon");');
    expect(out).toContain('await expect(screen.getByTestId("note").nth(3)).toHaveValue("Water the plants");');
  });
});
