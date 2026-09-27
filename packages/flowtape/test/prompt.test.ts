import { describe, expect, it } from 'vitest';
import { envVarFor, flowToPrompt } from '../src/prompt';
import { LOGIN_EVENTS, makeFlow } from './fixtures';

describe('flowToPrompt', () => {
  const prompt = flowToPrompt(makeFlow(LOGIN_EVENTS));

  it('has every Claude Code section in order', () => {
    const headings = ['# Flow: Login and add note', '## Goal', '## Preconditions', '## Steps', '## Assertions', '## Fuzz hints', '## Out of bounds', '## Report back'];
    const positions = headings.map((h) => prompt.indexOf(h));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('numbers one step per event and uses paths relative to the app', () => {
    expect(prompt).toContain('1. Open `/`.');
    expect(prompt).toContain('2. Type `ada@example.test` into the field "Email" (`[data-testid="login-email"]`).');
    expect(prompt).toContain('4. Click the button "Sign in" (`[data-testid="login-submit"]`).');
    expect(prompt).toContain('5. The click in step 4 submits the form `[data-testid="login-form"]` (POST). Do not submit it again.');
    expect(prompt).toContain('6. Wait for the app to move to `/notes`.');
    expect(prompt).toContain('8. Submit the form `[data-testid="note-form"]` (GET), for example by pressing Enter');
    expect(prompt).not.toContain('9. ');
  });

  it('points redacted fields at env vars', () => {
    expect(prompt).toContain('3. Fill the password field "Password" (`[data-testid="login-password"]`) with the value from `$FLOWTAPE_PASSWORD` (12 characters when recorded). **Redacted:**');
    expect(prompt).toContain('App running at `http://localhost:5173`');
    expect(prompt).toContain('- Redacted fields read their values from environment variables: `FLOWTAPE_PASSWORD`.');
  });

  it('derives heuristic assertions and fuzz hints', () => {
    expect(prompt).toContain('After step 5, the URL path is `/notes`');
    expect(prompt).toContain('After step 8, the text typed in step 7 appears on the page');
    expect(prompt).not.toContain('the text typed in step 2');
    expect(prompt).toContain('"Email" (`[data-testid="login-email"]`): try empty, `a@`');
    expect(prompt).toContain('Secrets / credentials must never be logged');
    expect(prompt).toContain('Recorded with flowtape on 27 September 2026.');
  });

  it('escapes backticks in typed values', () => {
    const out = flowToPrompt(makeFlow([{ type: 'input', ts: 0, selector: '#x', value: 'a `b` c', redacted: false }]));
    expect(out).toContain('Type `` a `b` c `` into');
  });

  it('honours baseUrl and handles empty flows', () => {
    const out = flowToPrompt(makeFlow([], { startUrl: undefined }), { baseUrl: 'http://127.0.0.1:3000/' });
    expect(out).toContain('App running at `http://127.0.0.1:3000`');
    expect(out).toContain('1. TODO: the recording has no events.');
  });

  it('builds env var names from field names', () => {
    expect(envVarFor({ type: 'input', ts: 0, selector: '#a', value: null, redacted: true, name: 'Member ID (SSN)' })).toBe('FLOWTAPE_MEMBER_ID_SSN');
    expect(envVarFor({ type: 'input', ts: 0, selector: '#a', value: null, redacted: true })).toBe('FLOWTAPE_SECRET');
  });
});
