// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RECORDING_KEY, createCapture, createRecorder, type Recorder } from '../src/recorder';

function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('recording across a full page load', () => {
  // In a real page load the old page's recorder is gone. Here it shares the document, so detach it after each test.
  let recorders: Recorder[] = [];
  const make = (...args: Parameters<typeof createRecorder>) => {
    const recorder = createRecorder(...args);
    recorders.push(recorder);
    return recorder;
  };
  afterEach(() => {
    recorders.forEach((recorder) => recorder.stop());
    recorders = [];
  });

  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/form');
    document.body.innerHTML = '<label for="tier">Care tier</label><input id="tier"><button id="save">Save</button>';
  });

  it('flushes debounced typing on pagehide and resumes on the next page', () => {
    const before = make({ capture: createCapture({ debounceMs: 10_000 }) });
    before.start();
    type('tier', '2');
    // A server-rendered form posts and the page unloads before the debounce fires.
    window.dispatchEvent(new Event('pagehide'));
    expect(sessionStorage.getItem(RECORDING_KEY)).toContain('"value":"2"');

    // The next page: a fresh module scope, so a fresh recorder and capture.
    history.replaceState(null, '', '/form/saved');
    const after = make({ capture: createCapture({ debounceMs: 0 }) });
    expect(after.getSnapshot().recording).toBe(true);
    (document.getElementById('save') as HTMLElement).click();
    after.stop();

    const events = after.getSnapshot().events;
    expect(events.map((e) => (e.type === 'navigate' ? `navigate ${new URL(e.url).pathname}` : e.type))).toEqual(['navigate /form', 'input', 'navigate /form/saved', 'click']);
    // `ts` keeps counting from the first page.
    expect(events.map((e) => e.ts)).toEqual([...events.map((e) => e.ts)].sort((a, b) => a - b));
  });

  it('does not add a navigate event for a reload of the same URL, and clear() forgets the recording', () => {
    make({ capture: createCapture() }).start();
    const reloaded = make({ capture: createCapture() });
    expect(reloaded.getSnapshot().events.filter((e) => e.type === 'navigate')).toHaveLength(1);
    reloaded.stop();
    reloaded.clear();
    expect(sessionStorage.getItem(RECORDING_KEY)).toBeNull();
    expect(make({ capture: createCapture() }).getSnapshot()).toEqual({ recording: false, events: [], asserting: false, check: 'text', waitingGone: false });
  });

  it('can be turned off', () => {
    make({ capture: createCapture(), persist: false }).start();
    expect(sessionStorage.getItem(RECORDING_KEY)).toBeNull();
  });
});
