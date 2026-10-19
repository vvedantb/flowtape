// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCapture, createRecorder } from '../src/recorder';
import { REDACTED, SECRET_ATTR, isMaskedElement, scrubText, watchSecretFields } from '../src/redact';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const byId = (id: string) => document.getElementById(id) as HTMLInputElement;

describe('a password field revealed as text stays masked', () => {
  let stop = () => {};
  beforeEach(() => {
    document.body.innerHTML = '<input id="pw" type="password" placeholder="Enter your password"><input id="plain">';
    stop = watchSecretFields(document);
  });
  afterEach(() => stop());

  it('keeps the mark after a "show password" toggle, and marks fields added later', async () => {
    expect(byId('pw').hasAttribute(SECRET_ATTR)).toBe(true);
    byId('pw').type = 'text';
    await tick();
    expect(isMaskedElement(byId('pw'))).toBe(true);
    expect(isMaskedElement(byId('plain'))).toBe(false);

    const late = document.createElement('input');
    late.id = 'late';
    document.body.append(late);
    late.type = 'password';
    await tick();
    late.type = 'text';
    await tick();
    expect(isMaskedElement(late)).toBe(true);
  });

  it('masks a value typed after the reveal through the overlay recorder', async () => {
    stop();
    const recorder = createRecorder({ capture: createCapture({ debounceMs: 0 }), persist: false });
    recorder.start();
    byId('pw').type = 'text';
    await tick();
    byId('pw').value = 'Hunter2-Secret!';
    byId('pw').dispatchEvent(new Event('change', { bubbles: true }));
    recorder.stop();
    expect(JSON.stringify(recorder.getSnapshot())).not.toContain('Hunter2');
    expect(recorder.getSnapshot().events.find((e) => e.type === 'input')).toMatchObject({ redacted: true, value: null, length: 15 });
  });
});

describe('2FA fields that do not say what they are', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <label for="a">Verification code</label><input id="a">
      <label for="b">Enter the code we sent you</label><input id="b" inputmode="numeric" maxlength="6">
      <input id="c" placeholder="6-digit code" maxlength="6">
      <label for="d">Security code</label><input id="d">
      <label for="e">Care tier</label><input id="e" inputmode="numeric" maxlength="2">
      <label for="f">Weekly hours</label><input id="f" inputmode="numeric" maxlength="3">
      <label for="g">Discount code</label><input id="g">`;
  });

  it('masks by label words and by shape, and leaves ordinary numeric fields alone', () => {
    expect(['a', 'b', 'c', 'd'].map((id) => [id, isMaskedElement(byId(id))])).toEqual([['a', true], ['b', true], ['c', true], ['d', true]]);
    expect(['e', 'f', 'g'].map((id) => [id, isMaskedElement(byId(id))])).toEqual([['e', false], ['f', false], ['g', false]]);
  });
});

describe('2FA setup keys in text', () => {
  it('redacts base32 secrets, grouped or not, and keeps look-alikes', () => {
    expect(scrubText('Setup key: JBSWY3DPEHPK3PXP')).toBe(`Setup key: ${REDACTED}`);
    expect(scrubText('JBSW Y3DP EHPK 3PXP')).toBe(REDACTED);
    for (const keep of ['ABCDEFGHIJKLMNOPQR', 'CARE TIER 2 WEEKLY', 'REF AB12CD34EF56GH78', 'ORDER2024ABCDEFGH']) expect(scrubText(keep)).toBe(keep);
  });
});
