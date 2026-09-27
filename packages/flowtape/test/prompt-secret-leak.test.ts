import { describe, expect, it } from 'vitest';
import { flowToPrompt } from '../src/prompt';
import { redactFlow, REDACTED } from '../src/redact';
import type { FlowEvent } from '../src/types';
import { makeFlow } from './fixtures';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJMRUFLTUUifQ.LEAKMEsignature789';

/** Every string here must be absent from the prompt. */
const PLANTED = [
  'sk-test-LEAKME123',
  'ghp_LEAKME456',
  'SuperSecretPass!',
  'password=SuperSecretPass',
  JWT,
  'LEAKMEsignature789',
  'AKIALEAKME0000000000',
  'hunter2-LEAKME',
  '123-45-LEAKME',
  'url-token-LEAKME',
];

/**
 * Raw events as a buggy or hostile client might send them: the redacted flags are wrong
 * or missing and secrets sit in values, selectors, names, urls and hrefs.
 */
const events: FlowEvent[] = [
  { type: 'navigate', ts: 0, url: 'http://localhost:5173/login?token=url-token-LEAKME&next=/notes', title: 'Login' },
  { type: 'input', ts: 10, selector: '[data-testid="api-key"]', value: 'sk-test-LEAKME123', inputType: 'text', name: 'API key', redacted: false },
  { type: 'input', ts: 20, selector: '[data-testid="gh"]', value: 'my token is ghp_LEAKME456 ok', inputType: 'text', name: 'Notes', redacted: false },
  { type: 'input', ts: 30, selector: '#free-text', value: 'password=SuperSecretPass!', inputType: 'text', name: 'Free text', redacted: false },
  { type: 'input', ts: 40, selector: '#auth-header', value: `Bearer ${JWT}`, inputType: 'text', name: 'Header', redacted: false },
  // Password field whose flag was not set by the client.
  { type: 'input', ts: 50, selector: '[data-testid="login-password"]', value: 'hunter2-LEAKME', inputType: 'password', name: 'Password', redacted: false },
  // data-flowtape-mask field: recorded correctly as type-only.
  { type: 'input', ts: 60, selector: '[data-testid="member-id"]', value: null, inputType: 'text', name: 'Member ID', redacted: true, length: 11 },
  // Masked field where a client still leaked the value alongside the flag.
  { type: 'input', ts: 65, selector: '[data-testid="ssn"]', value: '123-45-LEAKME', inputType: 'text', name: 'SSN', redacted: false },
  { type: 'click', ts: 70, selector: '[data-testid="AKIALEAKME0000000000"]', role: 'button', name: 'Use key AKIALEAKME0000000000', text: 'Go' },
  { type: 'click', ts: 80, selector: 'a.help', role: 'link', name: 'Help', href: '/help?api_key=sk-test-LEAKME123' },
  { type: 'submit', ts: 90, selector: 'form#login', action: '/login?password=SuperSecretPass!', method: 'post' },
];

const flow = makeFlow(events, { startUrl: 'http://localhost:5173/login?token=url-token-LEAKME' });

describe('prompt secret leak', () => {
  const prompt = flowToPrompt(flow);
  const serialized = JSON.stringify(redactFlow(flow));

  it.each(PLANTED)('prompt does not contain %s', (secret) => {
    expect(prompt).not.toContain(secret);
  });

  it.each(PLANTED)('redacted flow JSON does not contain %s', (secret) => {
    expect(serialized).not.toContain(secret);
  });

  it('shows redaction placeholders where secrets were', () => {
    expect(prompt).toContain(REDACTED);
    expect(prompt).toContain('**Redacted:**');
    expect(prompt).toContain('$FLOWTAPE_PASSWORD');
    expect(prompt).toContain('$FLOWTAPE_MEMBER_ID');
    expect(prompt).toContain('$FLOWTAPE_SSN');
  });

  it('honours and enforces the redacted flag', () => {
    const inputs = redactFlow(flow).events.filter((e) => e.type === 'input');
    const bySelector = new Map(inputs.map((e) => [e.selector, e]));
    for (const selector of ['[data-testid="login-password"]', '[data-testid="member-id"]', '[data-testid="ssn"]']) {
      expect(bySelector.get(selector)).toMatchObject({ redacted: true, value: null });
    }
    expect(bySelector.get('[data-testid="login-password"]')).toMatchObject({ length: 'hunter2-LEAKME'.length });
  });
});
