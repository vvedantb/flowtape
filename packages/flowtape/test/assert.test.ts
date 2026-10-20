// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flowToPrompt } from '../src/prompt';
import { flowToE2ETest } from '../src/e2e-test';
import { createCapture, createFlowDocument, createRecorder, type Recorder } from '../src/recorder';

describe('assert mode', () => {
  let recorder: Recorder;
  const appClick = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/notes');
    document.body.innerHTML = `
      <ul><li id="note" data-testid="note-item">Water the plants</li></ul>
      <button id="delete">Delete</button>
      <div data-flowtape-mask><p id="secret">Jane Doe</p></div>
      <div data-flowtape-ui><button id="ui">Cancel</button></div>`;
    appClick.mockClear();
    document.getElementById('delete')?.addEventListener('click', appClick);
    recorder = createRecorder({ capture: createCapture({ debounceMs: 0 }), persist: false });
    recorder.start();
  });
  afterEach(() => recorder.stop());

  const click = (id: string) => (document.getElementById(id) as HTMLElement).click();
  const asserts = () => recorder.getSnapshot().events.filter((e) => e.type === 'assert');

  it('turns the next page click into an assertion and swallows it', () => {
    recorder.assertNext();
    expect(recorder.getSnapshot().asserting).toBe(true);
    click('delete');
    expect(appClick).not.toHaveBeenCalled();
    expect(recorder.getSnapshot().events.filter((e) => e.type === 'click')).toHaveLength(0);
    expect(asserts()).toEqual([
      {
        type: 'assert',
        ts: expect.any(Number),
        selector: '#delete',
        role: 'button',
        name: 'Delete',
        text: 'Delete',
        locators: [
          { strategy: 'role', role: 'button', name: 'Delete', value: 'Delete', matches: 1 },
          { strategy: 'text', value: 'Delete', matches: 1 },
          { strategy: 'css', value: '#delete', matches: 1 },
        ],
      },
    ]);
    // One-shot: the next click is a normal click again.
    expect(recorder.getSnapshot().asserting).toBe(false);
    click('delete');
    expect(appClick).toHaveBeenCalledTimes(1);
  });

  it('records text for content and a visibility-only check for masked elements', () => {
    recorder.assertNext();
    click('note');
    recorder.assertNext();
    click('secret');
    expect(asserts()).toMatchObject([
      { selector: '[data-testid="note-item"]', text: 'Water the plants' },
      { selector: '#secret', text: undefined, name: undefined },
    ]);
    expect(JSON.stringify(recorder.getSnapshot())).not.toContain('Jane Doe');
  });

  it('lets overlay clicks through and cancels on Escape', () => {
    recorder.assertNext();
    click('ui');
    expect(recorder.getSnapshot().asserting).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(recorder.getSnapshot().asserting).toBe(false);
    click('delete');
    expect(appClick).toHaveBeenCalledTimes(1);
    expect(asserts()).toHaveLength(0);
  });

  it('writes recorded checks into the prompt and drops the generic TODO', () => {
    recorder.assertNext();
    click('note');
    const prompt = flowToPrompt(createFlowDocument({ name: 'Check note', events: recorder.getSnapshot().events, startUrl: 'http://localhost:5173/notes' }));
    expect(prompt).toContain('**Check:** the element "Water the plants" (`[data-testid="note-item"]`) is visible and shows `Water the plants`.');
    expect(prompt).toContain('Step 2 is a recorded check.');
    expect(prompt).not.toContain('TODO: add product-specific checks');
  });
});

describe('assert prompt with redacted text', () => {
  it('names the clean part, or says only visibility is checked', () => {
    const prompt = flowToPrompt(
      createFlowDocument({
        name: 'Redacted checks',
        startUrl: 'http://localhost:5173/',
        events: [
          { type: 'assert', ts: 0, selector: '#a', text: 'Seen at [REDACTED]' },
          { type: 'assert', ts: 1, selector: '#b', text: 'No [REDACTED]' },
        ],
      }),
    );
    expect(prompt).toContain('is visible and shows text that includes `Seen at` (the rest was redacted).');
    expect(prompt).toContain('is visible. Its recorded text was redacted, so check only that it is visible.');
  });
});

describe('count, gone and exact checks', () => {
  let recorder: Recorder;
  beforeEach(() => {
    sessionStorage.clear();
    document.body.innerHTML = `
      <ul><li data-testid="row">Seen at clinic</li><li data-testid="row">Seen at home</li><li data-testid="row">Water the plants</li></ul>
      <p data-testid="fee">£1,250.00/week</p>
      <button id="remove" type="button">Remove last</button>`;
    document.getElementById('remove')?.addEventListener('click', () => document.querySelector('li:last-child')?.remove());
    recorder = createRecorder({ capture: createCapture({ debounceMs: 0 }), persist: false });
    recorder.start();
  });
  afterEach(() => recorder.stop());

  const click = (selector: string) => (document.querySelector(selector) as HTMLElement).click();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('Count records how many rows match like the picked one', () => {
    recorder.assertNext('count');
    click('li:first-child');
    expect(recorder.getSnapshot().events.at(-1)).toMatchObject({ type: 'assert', check: 'count', count: 3 });
  });

  it('Gone waits for the element to leave, and records the check after the action that removed it', async () => {
    recorder.assertNext();
    recorder.assertNext('gone'); // switching mode while armed
    click('li:last-child');
    expect(recorder.getSnapshot()).toMatchObject({ asserting: false, waitingGone: true });
    expect(recorder.getSnapshot().events.filter((e) => e.type === 'assert')).toHaveLength(0);
    click('#remove');
    await flush();
    const types = recorder.getSnapshot().events.map((e) => (e.type === 'assert' ? `assert:${e.check}` : e.type));
    expect(types.slice(-2)).toEqual(['click', 'assert:gone']);
    expect(recorder.getSnapshot().waitingGone).toBe(false);
  });

  it('Cancel drops a waiting Gone check', async () => {
    recorder.assertNext('gone');
    click('li:last-child');
    recorder.cancelAssert();
    click('#remove');
    await flush();
    expect(recorder.getSnapshot().events.filter((e) => e.type === 'assert')).toHaveLength(0);
  });

  it('generates toHaveCount, toBeHidden and an exact toHaveText for a price', async () => {
    recorder.assertNext('count');
    click('li:first-child');
    recorder.assertNext();
    click('[data-testid="fee"]');
    recorder.assertNext('gone');
    click('li:last-child');
    click('#remove');
    await flush();
    const out = flowToE2ETest(createFlowDocument({ name: 'Checks', startUrl: 'http://localhost:5173/', events: recorder.getSnapshot().events }));
    expect(out).toContain('await expect(screen.getByTestId("row")).toHaveCount(3);');
    expect(out).toContain('await expect(screen.getByTestId("fee")).toHaveText("£1,250.00/week");');
    expect(out).toContain('await expect(screen.getByText("Water the plants")).toBeHidden();');
    const prompt = flowToPrompt(createFlowDocument({ name: 'Checks', startUrl: 'http://localhost:5173/', events: recorder.getSnapshot().events }));
    expect(prompt).toContain('**Check:** there are exactly 3 elements like');
    expect(prompt).toContain('is no longer on the page after the previous step.');
  });
});

describe('count and gone on rows without unique selectors', () => {
  let recorder: Recorder;
  beforeEach(() => {
    sessionStorage.clear();
    const rows = ['Buy milk', 'Call plumber', 'Pay rent', 'Walk dog'].map((t) => `<li class="note"><span>${t}</span> <button class="del" type="button">Delete</button></li>`);
    document.body.innerHTML = `
      <input id="filter" placeholder="Filter">
      <ul id="notes">${rows.join('')}</ul>
      <ul><li data-testid="row"><span>Seen at clinic</span></li><li data-testid="row"><span>Seen at home</span></li></ul>`;
    document.getElementById('notes')?.addEventListener('click', (event) => {
      if (event.target instanceof HTMLButtonElement) event.target.parentElement?.remove();
    });
    const filter = document.getElementById('filter');
    filter?.addEventListener('input', () => {
      const query = filter instanceof HTMLInputElement ? filter.value : '';
      document.querySelectorAll('li.note').forEach((li) => li.textContent?.includes(query) || li.remove());
    });
    recorder = createRecorder({ capture: createCapture({ debounceMs: 1000 }), persist: false });
    recorder.start();
  });
  afterEach(() => recorder.stop());

  const element = (selector: string, nth = 0) => {
    const el = document.querySelectorAll(selector)[nth];
    if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`);
    return el;
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const exported = () => flowToE2ETest(createFlowDocument({ name: 'Notes', startUrl: 'http://localhost:5173/', events: recorder.getSnapshot().events }));

  it('Count on a row without a test id counts every row, not just the picked one', () => {
    recorder.assertNext('count');
    element('li.note', 1).click();
    expect(recorder.getSnapshot().events.at(-1)).toMatchObject({ check: 'count', count: 4, sharedSelector: '#notes > li' });
    expect(exported()).toContain('await expect(browser.locator("#notes > li")).toHaveCount(4);');
  });

  it('Count on a child inside a test-id row counts the rows', () => {
    recorder.assertNext('count');
    element('[data-testid="row"] span', 1).click();
    expect(recorder.getSnapshot().events.at(-1)).toMatchObject({ check: 'count', count: 2 });
    expect(exported()).toContain('await expect(screen.getByTestId("row")).toHaveCount(2);');
  });

  it.each([0, 2])('Gone on a non-unique Delete button, then deleting row %i, checks a count that holds after', async (nth) => {
    recorder.assertNext('gone');
    element('button.del', nth).click();
    element('button.del', nth).click();
    await flush();
    const out = exported();
    expect(out).toContain('await expect(browser.locator("button.del")).toHaveCount(3);');
    expect(document.querySelectorAll('button.del')).toHaveLength(3);
  });

  it('Count with no position-free selector gives a TODO, not a positional check', () => {
    document.body.innerHTML = '<div><p>One</p><p>Two</p></div><div><p>Three</p></div>';
    recorder.assertNext('count');
    element('p', 1).click();
    expect(exported()).toContain('// TODO: no selector matches elements like the picked one without its position.');
    expect(exported()).not.toContain('await expect(');
  });

  it('Gone after debounced typing records the typing first', async () => {
    recorder.assertNext('gone');
    element('li.note span', 2).click();
    const filter = element('#filter');
    if (!(filter instanceof HTMLInputElement)) throw new Error('no filter');
    filter.value = 'milk';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const types = recorder.getSnapshot().events.map((e) => (e.type === 'assert' ? `assert:${e.check}` : e.type));
    expect(types.slice(-2)).toEqual(['input', 'assert:gone']);
    expect(exported()).toContain('await expect(screen.getByText("Pay rent")).toBeHidden();');
  });

  it('a test id on the list around the rows is not used: it would count the list, and still be there after a Gone', async () => {
    document.getElementById('notes')?.setAttribute('data-testid', 'notes-list');
    recorder.assertNext('count');
    element('li.note', 1).click();
    recorder.assertNext('gone');
    element('button.del', 0).click();
    element('button.del', 0).click();
    await flush();
    const out = exported();
    expect(out).toContain('await expect(browser.locator("[data-testid=\\"notes-list\\"] > li")).toHaveCount(4);');
    expect(out).toContain('await expect(browser.locator("button.del")).toHaveCount(3);');
    expect(out).not.toContain('getByTestId("notes-list")');
  });

  it('Count on rows with their own ids counts every row', () => {
    document.querySelectorAll('li.note').forEach((li, i) => (li.id = `note-${i}`));
    recorder.assertNext('count');
    element('li.note', 1).click();
    expect(exported()).toContain('await expect(browser.locator("#notes > li")).toHaveCount(4);');
  });
});
