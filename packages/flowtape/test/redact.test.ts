// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { isMaskedElement, redactEvent, redactFlow, REDACTED, scrubText } from '../src/redact';
import { makeFlow } from './fixtures';

describe('scrubText', () => {
  it.each([
    ['sk-test-LEAKME123', 'key sk-test-LEAKME123 here'],
    ['ghp_LEAKME456', 'token ghp_LEAKME456'],
    ['AKIAABCDEFGHIJKLMNOP', 'aws AKIAABCDEFGHIJKLMNOP'],
    ['SuperSecretPass!', 'password=SuperSecretPass!&x=1'],
    ['abc.def.ghi', 'Authorization: Bearer abc.def.ghi'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'],
    ['xoxb-1234567890-abcdef', 'slack xoxb-1234567890-abcdef'],
    ['QmFzZTY0VG9rZW5UaGF0SXNMb25nRW5vdWdoMTIz', 'blob QmFzZTY0VG9rZW5UaGF0SXNMb25nRW5vdWdoMTIz'],
    ['0123456789abcdef0123456789abcdef', 'hex 0123456789abcdef0123456789abcdef'],
    ['alice:pa55', 'https://alice:pa55@example.test/'],
  ])('removes %s', (secret, text) => {
    const out = scrubText(text);
    expect(out).not.toContain(secret);
    expect(out).toContain(REDACTED);
  });

  it('leaves ordinary text, slugs and paths alone', () => {
    for (const text of ['Buy milk', '/notes/login-and-add-note-2026-09-27', '.flowtape/flows/a-very-long-flow-name-with-numbers-123.json', 'task-manager']) {
      expect(scrubText(text)).toBe(text);
    }
  });

  it('is idempotent', () => {
    const once = scrubText('token=abc sk-LEAKLEAKLEAK');
    expect(scrubText(once)).toBe(once);
  });
});

describe('isMaskedElement', () => {
  it('masks password inputs, data-flowtape-mask subtrees and secret-looking names', () => {
    document.body.innerHTML = `
      <input id="pw" type="password">
      <div data-flowtape-mask><input id="ssn"></div>
      <input id="shown" name="new-password" type="text">
      <input id="otp" autocomplete="one-time-code">
      <input id="email" type="email" name="email">`;
    const byId = (id: string) => document.getElementById(id) ?? document.body;
    expect(isMaskedElement(byId('pw'))).toBe(true);
    expect(isMaskedElement(byId('ssn'))).toBe(true);
    expect(isMaskedElement(byId('shown'))).toBe(true);
    expect(isMaskedElement(byId('otp'))).toBe(true);
    expect(isMaskedElement(byId('email'))).toBe(false);
  });
});

describe('redactEvent', () => {
  it('drops values of password inputs even when the redacted flag is missing', () => {
    const out = redactEvent({ type: 'input', ts: 0, selector: '#x', value: 'hunter2', inputType: 'password', redacted: false });
    expect(out).toMatchObject({ redacted: true, value: null, length: 7 });
  });

  it('drops values of fields whose name looks secret', () => {
    const out = redactEvent({ type: 'input', ts: 0, selector: 'input[name="api_key"]', value: 'plain', redacted: false });
    expect(out).toMatchObject({ redacted: true, value: null });
  });

  it('scrubs secrets inside ordinary values but keeps the rest', () => {
    const out = redactEvent({ type: 'input', ts: 0, selector: '#note', value: 'remember sk-LEAKLEAKLEAK', redacted: false });
    expect(out).toMatchObject({ redacted: false, value: `remember ${REDACTED}` });
  });

  it('scrubs urls in navigation', () => {
    const out = redactFlow(makeFlow([{ type: 'navigate', ts: 0, url: 'http://localhost/?token=abc123&page=2' }]));
    expect(out.events[0]).toMatchObject({ url: `http://localhost/?token=${REDACTED}&page=2` });
  });
});
