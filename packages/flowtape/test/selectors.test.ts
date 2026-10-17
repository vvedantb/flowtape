// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { selectorsFor } from '../src/recorder';

function find(selector: string): Element {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
}

describe('selectorsFor', () => {
  it('lists strategies in priority order and skips missing ones', () => {
    document.body.innerHTML = `
      <button id="save" data-testid="save-btn">Save note</button>
      <label for="email">Email address</label><input id="email" type="email" placeholder="you@example.com">
      <div><a href="/x">Docs</a></div>`;
    expect(selectorsFor(find('button')).map((s) => s.strategy)).toEqual(['test-id', 'role', 'text', 'css']);
    expect(selectorsFor(find('button'))).toEqual([
      { strategy: 'test-id', value: 'save-btn' },
      { strategy: 'role', role: 'button', name: 'Save note', value: 'Save note' },
      { strategy: 'text', value: 'Save note' },
      { strategy: 'css', value: '[data-testid="save-btn"]' },
    ]);
    // A field gets no text strategy. Its label wins over the placeholder as the accessible name.
    expect(selectorsFor(find('#email'))).toEqual([
      { strategy: 'role', role: 'textbox', name: 'Email address', value: 'Email address' },
      { strategy: 'label', value: 'Email address' },
      { strategy: 'placeholder', value: 'you@example.com' },
      { strategy: 'css', value: '#email' },
    ]);
    expect(selectorsFor(find('a')).map((s) => s.strategy)).toEqual(['role', 'text', 'css']);
  });

  it('skips long text and never offers text for masked elements', () => {
    document.body.innerHTML = `
      <div id="long">${'word '.repeat(30)}</div>
      <div data-flowtape-mask><span id="secret">4111 1111</span></div>`;
    expect(selectorsFor(find('#long')).map((s) => s.strategy)).toEqual(['css']);
    expect(selectorsFor(find('#secret')).map((s) => s.strategy)).toEqual(['css']);
  });

  it('scrubs secret-looking strings', () => {
    document.body.innerHTML = `<button>Use sk-abcdefghijklmnop</button>`;
    expect(selectorsFor(find('button')).find((s) => s.strategy === 'text')?.value).toBe('Use [REDACTED]');
  });
});
