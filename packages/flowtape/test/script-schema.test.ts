import { describe, expect, it } from 'vitest';
import { FlowDocumentSchema } from '../src/schemas';
import { ReplayScriptSchema, SCRIPT_VERSION } from '../src/script/schema';

const step = { type: 'click', ts: 10, url: 'http://localhost/', selectors: [{ strategy: 'css', value: 'button' }], expected: { kind: 'none' } };
const script = {
  version: SCRIPT_VERSION,
  kind: 'flowtape-replay-script',
  id: 'abc',
  name: 'Demo',
  createdAt: '2026-01-01T00:00:00.000Z',
  startUrl: 'http://localhost/',
  viewport: { width: 800, height: 600 },
  steps: [step],
};

describe('ReplayScriptSchema', () => {
  it('accepts a valid script', () => {
    expect(ReplayScriptSchema.safeParse(script).success).toBe(true);
  });

  it('rejects a bad version or kind', () => {
    expect(ReplayScriptSchema.safeParse({ ...script, version: 2 }).success).toBe(false);
    expect(ReplayScriptSchema.safeParse({ ...script, kind: 'flowtape-flow' }).success).toBe(false);
  });

  it('rejects a redacted type step that carries a value', () => {
    const typed = { ...step, type: 'type', redacted: true, length: 8 };
    expect(ReplayScriptSchema.safeParse({ ...script, steps: [{ ...typed, value: null }] }).success).toBe(true);
    expect(ReplayScriptSchema.safeParse({ ...script, steps: [{ ...typed, value: 'hunter2' }] }).success).toBe(false);
  });

  it('stays separate from FlowDocument', () => {
    expect(FlowDocumentSchema.safeParse(script).success).toBe(false);
  });
});
