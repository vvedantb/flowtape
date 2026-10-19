// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flowToPrompt } from '../src/prompt';
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
