// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionHistory, HISTORY_PREF_KEY, HISTORY_SESSION_KEY, type SessionHistory } from '../src/history';
import { createCapture, createRecorder, type Capture, type Recorder } from '../src/recorder';
import { HistoryBatchSchema } from '../src/schemas';
import type { HistoryBatch } from '../src/types';

function el<T extends Element>(selector: string, type: { new (): T }): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing ${selector}`);
  return found;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('createSessionHistory', () => {
  let capture: Capture;
  let recorder: Recorder;
  let sessionHistory: SessionHistory;
  let batches: HistoryBatch[];
  let unmount: () => void;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const batch = HistoryBatchSchema.parse(JSON.parse(String(init?.body)));
    batches.push(batch);
    return new Response(JSON.stringify({ file: `.flowtape/history/2026-09-27-${batch.sessionId}.jsonl`, appended: batch.events.length }), { status: 201 });
  });

  const sent = () => batches.flatMap((b) => b.events);
  const mount = () => {
    unmount = sessionHistory.subscribe(() => {});
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = `
      <form data-testid="login-form"><input id="pw" data-testid="login-password" type="password"><button data-testid="go" type="button">Go</button></form>
      <div data-flowtape-ui><button id="ui">Toggle</button></div>`;
    batches = [];
    fetchMock.mockClear();
    capture = createCapture({ debounceMs: 100 });
    recorder = createRecorder({ capture });
    sessionHistory = createSessionHistory({ capture, flushMs: 50 });
    unmount = () => {};
  });

  afterEach(async () => {
    recorder.stop();
    unmount();
    await Promise.resolve();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is on by default and appends batched events to one session', async () => {
    mount();
    const { sessionId, active, enabled } = sessionHistory.getSnapshot();
    expect({ active, enabled }).toEqual({ active: true, enabled: true });
    expect(sessionId).toMatch(/^[a-f0-9]{10}$/);
    el('[data-testid="go"]', HTMLButtonElement).click();
    history.pushState(null, '', '/notes');
    await vi.advanceTimersByTimeAsync(50);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/__flowtape/history');
    expect(batches[0].sessionId).toBe(sessionId);
    expect(sent().map((e) => e.type)).toEqual(['navigate', 'click', 'navigate']);
    expect(sessionHistory.getSnapshot()).toMatchObject({ events: 3, file: `.flowtape/history/2026-09-27-${sessionId}.jsonl` });
  });

  it('shares one capture with named recording without duplicate events', async () => {
    mount();
    recorder.start();
    el('[data-testid="go"]', HTMLButtonElement).click();
    recorder.stop();
    el('[data-testid="go"]', HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(50);

    expect(recorder.getSnapshot().events.map((e) => e.type)).toEqual(['navigate', 'click']);
    // History keeps capturing after the named recording stops, and logs each click once.
    expect(sent().map((e) => e.type)).toEqual(['navigate', 'click', 'click']);
  });

  it('stores passwords type-only and scrubs page errors', async () => {
    mount();
    type(el('#pw', HTMLInputElement), 'SuperSecretPass!');
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom Bearer sk-test-LEAKME123', filename: 'http://localhost/app.js?token=url-token-LEAKME', lineno: 4, colno: 2 }));
    await vi.advanceTimersByTimeAsync(150);

    const json = JSON.stringify(batches);
    for (const secret of ['SuperSecretPass!', 'sk-test-LEAKME123', 'url-token-LEAKME']) expect(json).not.toContain(secret);
    expect(sent().find((e) => e.type === 'input')).toMatchObject({ redacted: true, value: null, length: 16 });
    expect(sent().find((e) => e.type === 'error')).toMatchObject({ kind: 'error', message: 'boom Bearer [REDACTED]', line: 4, column: 2 });
  });

  it('ignores overlay clicks and never adds errors to named flows', async () => {
    mount();
    recorder.start();
    el('#ui', HTMLButtonElement).click();
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));
    await vi.advanceTimersByTimeAsync(50);
    expect(recorder.getSnapshot().events.map((e) => e.type)).toEqual(['navigate']);
    expect(sent().map((e) => e.type)).toEqual(['navigate', 'error']);
  });

  it('toggles off, remembers the choice and detaches listeners', async () => {
    mount();
    sessionHistory.setEnabled(false);
    expect(localStorage.getItem(HISTORY_PREF_KEY)).toBe('0');
    expect(sessionHistory.getSnapshot().active).toBe(false);
    await vi.advanceTimersByTimeAsync(50);
    const count = sent().length;
    el('[data-testid="go"]', HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(50);
    expect(sent()).toHaveLength(count);

    const reloaded = createSessionHistory({ capture, flushMs: 50 });
    expect(reloaded.getSnapshot().enabled).toBe(false);
    sessionHistory.setEnabled(true);
    expect(localStorage.getItem(HISTORY_PREF_KEY)).toBe('1');
    expect(sessionHistory.getSnapshot().active).toBe(true);
  });

  it('stays off until mounted and reuses the tab session across reloads', async () => {
    expect(sessionHistory.getSnapshot().active).toBe(false);
    mount();
    const { sessionId } = sessionHistory.getSnapshot();
    expect(JSON.parse(sessionStorage.getItem(HISTORY_SESSION_KEY) ?? '{}').id).toBe(sessionId);
    unmount();
    await Promise.resolve();
    expect(sessionHistory.getSnapshot().active).toBe(false);

    sessionHistory = createSessionHistory({ capture, flushMs: 50 });
    mount();
    expect(sessionHistory.getSnapshot().sessionId).toBe(sessionId);
  });

  it('survives a StrictMode unmount and remount without restarting', async () => {
    mount();
    unmount();
    mount();
    await Promise.resolve();
    expect(sessionHistory.getSnapshot().active).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(sent().map((e) => e.type)).toEqual(['navigate']);
  });
});
