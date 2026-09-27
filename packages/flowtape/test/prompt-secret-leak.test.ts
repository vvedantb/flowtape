import { describe, expect, it } from 'vitest';
import { flowToPrompt } from '../src/prompt';
import { redactFlow, REDACTED } from '../src/redact';
import { LEAKY_EVENTS, makeFlow, PLANTED } from './fixtures';

const flow = makeFlow(LEAKY_EVENTS, { startUrl: 'http://localhost:5173/login?token=url-token-LEAKME' });

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
