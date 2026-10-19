// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { flowToE2ETest } from '../src/e2e-test';
import { locatorsFor, selectorsFor } from '../src/recorder';
import { makeFlow } from './fixtures';

const el = (selector: string) => document.querySelector(selector) as Element;

describe('locatorsFor', () => {
  it('counts each strategy on the live page with exact, innermost matching', () => {
    document.body.innerHTML = `
      <ul><li data-testid="row">Seen at clinic</li><li data-testid="row">Seen at home</li><li data-testid="row">Water the plants</li></ul>
      <button id="a">Save</button><button id="b">Save</button><button id="c">Save changes</button>
      <label for="tier">Care tier</label><input id="tier" placeholder="1-3">`;
    expect(locatorsFor(el('li:last-child'))).toEqual([
      { strategy: 'test-id', value: 'row', matches: 3 },
      { strategy: 'text', value: 'Water the plants', matches: 1 },
      { strategy: 'css', value: '[data-testid="row"]', matches: 3 },
    ]);
    expect(locatorsFor(el('#c')).slice(0, 2)).toEqual([
      { strategy: 'role', role: 'button', name: 'Save changes', value: 'Save changes', matches: 1 },
      { strategy: 'text', value: 'Save changes', matches: 1 },
    ]);
    expect(locatorsFor(el('#a'))[0]).toMatchObject({ strategy: 'role', name: 'Save', matches: 2 });
    expect(locatorsFor(el('#tier')).map((l) => [l.strategy, l.matches])).toEqual([['role', 1], ['label', 1], ['placeholder', 1], ['css', 1]]);
  });

  it('never offers the name or text of a masked non-field, so allowlist mode keeps names out', () => {
    document.body.innerHTML = '<main data-flowtape-allowlist><a id="p" href="/people/1">Jane Doe</a><button id="s">Save placement</button></main>';
    expect(JSON.stringify(selectorsFor(el('#p')))).not.toContain('Jane');
    expect(JSON.stringify(locatorsFor(el('#p')))).not.toContain('Jane');
    expect(locatorsFor(el('#s'))[0]).toMatchObject({ strategy: 'role', name: 'Save placement' });
  });
});

describe('the e2e generator uses the first unique recorded locator', () => {
  const out = flowToE2ETest(
    makeFlow([
      {
        type: 'assert',
        ts: 0,
        selector: '[data-testid="row"]',
        text: 'Water the plants',
        nth: 2,
        locators: [
          { strategy: 'test-id', value: 'row', matches: 3 },
          { strategy: 'text', value: 'Water the plants', matches: 1 },
        ],
      },
      {
        type: 'click',
        ts: 1,
        selector: '#c',
        role: 'button',
        name: 'Save',
        locators: [
          { strategy: 'role', role: 'button', name: 'Save', value: 'Save', matches: 2 },
          { strategy: 'css', value: '#c', matches: 1 },
        ],
      },
      {
        type: 'click',
        ts: 2,
        selector: '#n',
        locators: [
          { strategy: 'text', value: 'Call [REDACTED]', matches: 1 },
          { strategy: 'css', value: '#n', matches: 1 },
        ],
      },
      // No recorded locators (an older flow): the previous rules still apply.
      { type: 'click', ts: 3, selector: '[data-testid="add"]', role: 'button', name: 'Add' },
    ]),
  );

  it('picks unique ones, skips ambiguous and redacted ones, and falls back for old flows', () => {
    expect(out).toContain('await expect(screen.getByText("Water the plants")).toContainText("Water the plants");');
    expect(out).toContain('await browser.locator("#c").tap();');
    expect(out).toContain('await browser.locator("#n").tap();');
    expect(out).not.toContain('getByText("Call');
    expect(out).toContain('await screen.getByTestId("add").tap();');
  });
});

describe('masked fields', () => {
  it('never offer their placeholder, which can hold example data shaped like the secret', () => {
    document.body.innerHTML = '<div data-flowtape-mask><label for="m">Member ID</label><input id="m" placeholder="123-45-6789"></div>';
    expect(JSON.stringify(locatorsFor(el('#m')))).not.toContain('123-45-6789');
    expect(locatorsFor(el('#m')).map((l) => l.strategy)).toEqual(['role', 'label', 'css']);
  });
});
