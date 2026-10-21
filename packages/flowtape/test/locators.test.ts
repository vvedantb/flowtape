// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flowToE2ETest } from '../src/e2e-test';
import { createCapture, createRecorder, locatorsFor, selectorsFor, type Recorder } from '../src/recorder';
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

  it('leaves aria-hidden text, such as a required marker, out of names and labels', () => {
    document.body.innerHTML = `
      <label for="email">Email address<span aria-hidden="true"> *</span></label><input id="email" name="email">
      <span id="lb">Search<span aria-hidden="true">⌘K</span></span><input id="q" aria-labelledby="lb">
      <button id="go">Save<span aria-hidden="true"> →</span></button>`;
    expect(locatorsFor(el('#email')).slice(0, 2)).toEqual([
      { strategy: 'role', role: 'textbox', name: 'Email address', value: 'Email address', matches: 1 },
      { strategy: 'label', value: 'Email address', matches: 1 },
    ]);
    expect(locatorsFor(el('#q'))[0]).toMatchObject({ strategy: 'role', name: 'Search', matches: 1 });
    expect(locatorsFor(el('#go'))[0]).toMatchObject({ strategy: 'role', name: 'Save', matches: 1 });
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

describe('masked fields in recorded events', () => {
  let recorder: Recorder;

  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = `
      <div data-flowtape-mask>
        <input id="m" placeholder="123-45-6789">
        <input id="c" type="checkbox" title="123-45-6789">
        <label for="l">Member ID</label><input id="l" placeholder="123-45-6789">
        <span id="n">Member number</span><input id="a" aria-labelledby="n" title="123-45-6789">
      </div>`;
    recorder = createRecorder({ capture: createCapture({ debounceMs: 0 }), persist: false });
    recorder.start();
  });
  afterEach(() => recorder.stop());

  const events = () => recorder.getSnapshot().events.filter((e) => e.type !== 'navigate');
  const input = (id: string) => {
    const field = document.getElementById(id);
    if (!(field instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);
    field.value = 'typed';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const click = (id: string) => document.getElementById(id)?.click();

  it('never name an unlabelled field by its placeholder or title in input, click or assert events', () => {
    input('m');
    click('c');
    recorder.assertNext();
    click('m');
    const recorded = events();
    expect(recorded.map((e) => e.type)).toEqual(['input', 'click', 'input', 'assert']);
    expect(JSON.stringify(recorded)).not.toContain('123-45-6789');
    for (const event of recorded) {
      expect(event).toMatchObject({ name: undefined });
      expect('locators' in event && event.locators?.map((l) => l.strategy)).toEqual(['css']);
    }
  });

  it('still offer a <label> or aria-labelledby name', () => {
    input('l');
    input('a');
    recorder.assertNext();
    click('l');
    const recorded = events();
    expect(JSON.stringify(recorded)).not.toContain('123-45-6789');
    expect(recorded).toMatchObject([
      { type: 'input', name: 'Member ID', locators: [{ strategy: 'role', role: 'textbox', name: 'Member ID', matches: 1 }, { strategy: 'label', value: 'Member ID' }, { strategy: 'css' }] },
      { type: 'input', name: 'Member number', locators: [{ strategy: 'role', role: 'textbox', name: 'Member number', matches: 1 }, { strategy: 'css' }] },
      { type: 'assert', name: 'Member ID', locators: [{ strategy: 'role', name: 'Member ID' }, { strategy: 'label' }, { strategy: 'css' }] },
    ]);
  });
});
