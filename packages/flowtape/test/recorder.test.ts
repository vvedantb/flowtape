// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFlowDocument, createRecorder, selectorFor, type Recorder } from '../src/recorder';
import { FlowDocumentSchema } from '../src/schemas';

function el<T extends Element>(selector: string, type: { new (): T }): T {
  const found = document.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Missing ${selector}`);
  return found;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('selectorFor', () => {
  it('prefers stable attributes, then a short CSS path', () => {
    document.body.innerHTML = `
      <button data-testid="save">Save</button>
      <button aria-label="Close">x</button>
      <input name="email">
      <div id="panel"><span>a</span><span>b</span></div>
      <p id=":r1:"><b>x</b></p>`;
    const [save, close] = Array.from(document.querySelectorAll('button'));
    expect(selectorFor(save)).toBe('[data-testid="save"]');
    expect(selectorFor(close)).toBe('button[aria-label="Close"]');
    expect(selectorFor(el('input', HTMLInputElement))).toBe('input[name="email"]');
    expect(selectorFor(el('#panel span:nth-of-type(2)', HTMLSpanElement))).toBe('#panel > span:nth-of-type(2)');
    expect(selectorFor(el('b', HTMLElement))).toBe('body > p > b');
  });
});

describe('createRecorder', () => {
  let recorder: Recorder;

  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/');
    document.body.innerHTML = `
      <form data-testid="login-form" method="post" action="/login">
        <label for="email">Email</label><input id="email" data-testid="login-email" type="email">
        <label for="pw">Password</label><input id="pw" data-testid="login-password" type="password">
        <div data-flowtape-mask><label for="ssn">Member ID</label><input id="ssn" data-testid="member-id"></div>
        <label><input type="checkbox" data-testid="remember"> Remember me</label>
        <button data-testid="login-submit" type="submit">Sign in</button>
      </form>
      <div data-flowtape-ui><button id="ui">Record</button></div>`;
    recorder = createRecorder({ debounceMs: 300 });
  });

  afterEach(() => {
    recorder.stop();
    vi.useRealTimers();
  });

  it('records the initial page, debounced typing, clicks and submits', () => {
    recorder.start();
    const email = el('#email', HTMLInputElement);
    type(email, 'a');
    type(email, 'ada@example.test');
    vi.advanceTimersByTime(300);
    el('[data-testid="remember"]', HTMLInputElement).click();
    const form = el('form', HTMLFormElement);
    form.addEventListener('submit', (e) => e.preventDefault());
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    recorder.stop();

    const events = recorder.getSnapshot().events;
    expect(events.map((e) => e.type)).toEqual(['navigate', 'input', 'click', 'input', 'submit']);
    expect(events[1]).toMatchObject({ selector: '[data-testid="login-email"]', value: 'ada@example.test', inputType: 'email', name: 'Email', redacted: false });
    expect(events[2]).toMatchObject({ selector: '[data-testid="remember"]', role: 'checkbox' });
    expect(events[3]).toMatchObject({ inputType: 'checkbox', value: 'checked' });
    expect(events[4]).toMatchObject({ selector: '[data-testid="login-form"]', method: 'post', action: '/login' });
  });

  it('never stores password or masked values', () => {
    recorder.start();
    type(el('#pw', HTMLInputElement), 'SuperSecretPass!');
    type(el('#ssn', HTMLInputElement), '123-45-6789');
    recorder.stop();
    const [, pw, ssn] = recorder.getSnapshot().events;
    expect(pw).toMatchObject({ type: 'input', redacted: true, value: null, length: 16, name: 'Password' });
    expect(ssn).toMatchObject({ type: 'input', redacted: true, value: null, name: 'Member ID' });
    expect(JSON.stringify(recorder.getSnapshot())).not.toContain('SuperSecretPass!');
    expect(JSON.stringify(recorder.getSnapshot())).not.toContain('6789');
  });

  it('flushes pending typing when another field starts', () => {
    recorder.start();
    type(el('#email', HTMLInputElement), 'ada@example.test');
    type(el('#pw', HTMLInputElement), 'x');
    recorder.stop();
    expect(recorder.getSnapshot().events.map((e) => e.type)).toEqual(['navigate', 'input', 'input']);
  });

  it('ignores the overlay and focus clicks on text fields', () => {
    recorder.start();
    el('#ui', HTMLButtonElement).click();
    el('#email', HTMLInputElement).click();
    recorder.stop();
    expect(recorder.getSnapshot().events.map((e) => e.type)).toEqual(['navigate']);
  });

  it('records pushState and popstate navigation, then restores history', () => {
    const original = history.pushState;
    recorder.start();
    expect(history.pushState).not.toBe(original);
    history.pushState(null, '', '/notes');
    history.pushState(null, '', '/notes');
    history.replaceState(null, '', '/notes?tab=2');
    recorder.stop();
    expect(history.pushState).toBe(original);
    const urls = recorder.getSnapshot().events.flatMap((e) => (e.type === 'navigate' ? [new URL(e.url).pathname + new URL(e.url).search] : []));
    expect(urls).toEqual(['/', '/notes', '/notes?tab=2']);
  });

  it('stops listening after stop and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = recorder.subscribe(listener);
    recorder.start();
    recorder.stop();
    const count = recorder.getSnapshot().events.length;
    el('[data-testid="login-submit"]', HTMLButtonElement).click();
    expect(recorder.getSnapshot().events).toHaveLength(count);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    recorder.clear();
    expect(recorder.getSnapshot().events).toEqual([]);
  });

  it('builds a valid FlowDocument from a recording', () => {
    recorder.start();
    type(el('#pw', HTMLInputElement), 'SuperSecretPass!');
    recorder.stop();
    const { events, startUrl } = recorder.getSnapshot();
    const doc = createFlowDocument({ name: 'Log in!', events, startUrl, now: new Date('2026-09-27T10:00:00Z') });
    expect(FlowDocumentSchema.parse(doc)).toMatchObject({ slug: 'log-in', name: 'Log in!', createdAt: '2026-09-27T10:00:00.000Z' });
  });
});
