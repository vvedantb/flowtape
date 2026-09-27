import { describe, expect, it } from 'vitest';
import { FlowDocumentSchema, FlowEventSchema, slugify } from '../src/schemas';
import { LOGIN_EVENTS, makeFlow } from './fixtures';

describe('FlowDocumentSchema', () => {
  it('accepts a valid flow', () => {
    expect(FlowDocumentSchema.parse(makeFlow(LOGIN_EVENTS)).events).toHaveLength(LOGIN_EVENTS.length);
  });

  it('rejects unknown event types and versions', () => {
    expect(FlowEventSchema.safeParse({ type: 'scroll', ts: 0 }).success).toBe(false);
    expect(FlowDocumentSchema.safeParse({ ...makeFlow([]), version: 2 }).success).toBe(false);
  });

  it('rejects slugs that could escape the flows folder', () => {
    for (const slug of ['../etc/passwd', 'a/b', 'Upper', 'dot.json', '']) {
      expect(FlowDocumentSchema.safeParse(makeFlow([], { slug })).success).toBe(false);
    }
  });

  it('rejects redacted inputs that still carry a value', () => {
    const bad = makeFlow([{ type: 'input', ts: 0, selector: '#pw', value: 'hunter2', redacted: true }]);
    expect(FlowDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('slugify', () => {
  it('makes file-safe slugs', () => {
    expect(slugify('Login & add note!')).toBe('login-add-note');
    expect(slugify('  Crème brûlée  ')).toBe('creme-brulee');
    expect(slugify('../../etc')).toBe('etc');
    expect(slugify('!!!')).toBe('flow');
    expect(slugify('a'.repeat(100))).toHaveLength(64);
  });
});
