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
