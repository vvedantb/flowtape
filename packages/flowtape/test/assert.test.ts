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
