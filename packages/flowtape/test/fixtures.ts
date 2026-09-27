import type { FlowDocument, FlowEvent } from '../src/types';

export function makeFlow(events: FlowEvent[], overrides: Partial<FlowDocument> = {}): FlowDocument {
  return {
    version: 1,
    id: 'test-id',
    slug: 'login-and-add-note',
    name: 'Login and add note',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    startUrl: 'http://localhost:5173/',
    events,
    ...overrides,
  };
}

export const LOGIN_EVENTS: FlowEvent[] = [
  { type: 'navigate', ts: 0, url: 'http://localhost:5173/', title: 'Demo' },
  { type: 'input', ts: 500, selector: '[data-testid="login-email"]', value: 'ada@example.test', inputType: 'email', name: 'Email', redacted: false },
  { type: 'input', ts: 900, selector: '[data-testid="login-password"]', value: null, inputType: 'password', name: 'Password', redacted: true, length: 12 },
  { type: 'click', ts: 1200, selector: '[data-testid="login-submit"]', role: 'button', name: 'Sign in', text: 'Sign in' },
  { type: 'submit', ts: 1210, selector: '[data-testid="login-form"]', method: 'post' },
  { type: 'navigate', ts: 1300, url: 'http://localhost:5173/notes', title: 'Notes' },
  { type: 'input', ts: 2000, selector: '[data-testid="note-input"]', value: 'Buy milk', inputType: 'text', name: 'New note', redacted: false },
  { type: 'submit', ts: 2400, selector: '[data-testid="note-form"]', method: 'get' },
];

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJMRUFLTUUifQ.LEAKMEsignature789';

/** Every string here must be absent from the prompt. */
export const PLANTED = [
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
export const LEAKY_EVENTS: FlowEvent[] = [
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
