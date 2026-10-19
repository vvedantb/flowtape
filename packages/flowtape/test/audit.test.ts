import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditFlowtape, formatFindings } from '../src/audit';
import { LOGIN_EVENTS, makeFlow } from './fixtures';

let root = '';
const write = (rel: string, content: string) => {
  const file = path.join(root, '.flowtape', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowtape-audit-'));
});

describe('auditFlowtape', () => {
  it('finds nothing in a clean flow', () => {
    write('flows/clean.json', JSON.stringify(makeFlow(LOGIN_EVENTS)));
    expect(auditFlowtape({ cwd: root }).filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('errors on text a redaction rule would change, such as a hand-edited prompt', () => {
    write('prompts/edited.md', '# Flow\n\n1. Type `943 476 5919` into the field.\n');
    const findings = auditFlowtape({ cwd: root });
    expect(findings).toMatchObject([{ severity: 'error', kind: 'pattern', file: path.join('.flowtape', 'prompts', 'edited.md'), where: 'line 3' }]);
    expect(findings[0].message).not.toMatch(/\d/);
  });

  it('warns on names, addresses, old dates and unmasked personal fields, without printing them', () => {
    write(
      'flows/people.json',
      JSON.stringify(
        makeFlow([
          { type: 'input', ts: 0, selector: '#n', name: 'Full name', inputType: 'text', value: 'Margaret Thompson', redacted: false },
          { type: 'input', ts: 1, selector: '#a', name: 'Visit', inputType: 'text', value: 'Visited 12 Acacia Avenue on Monday', redacted: false },
          { type: 'input', ts: 2, selector: '#d', name: 'Seen', inputType: 'text', value: 'Born 03/04/1938, start 01/03/2024', redacted: false },
          { type: 'assert', ts: 3, selector: '#r', text: 'Mrs Patel has 3 visits' },
        ]),
      ),
    );
    const findings = auditFlowtape({ cwd: root });
    expect(findings.map((f) => [f.kind, f.where])).toEqual([
      ['name', 'events[0].value'],
      ['unmasked-field', 'events[0].value'],
      ['address', 'events[1].value'],
      ['date-of-birth', 'events[2].value'],
      ['name', 'events[3].text'],
    ]);
    const shown = formatFindings(findings);
    for (const leak of ['Margaret Thompson', 'Acacia Avenue', '1938', 'Patel']) expect(shown).not.toContain(leak);
    expect(shown).toContain('"M******* T*******"');
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('flags screenshots in replay scripts, and accepts listed false positives', () => {
    write('scripts/s.json', JSON.stringify({ steps: [{ type: 'click', screenshots: { page: 'AAAA', target: 'BBBB' } }] }));
    write('flows/ok.json', JSON.stringify(makeFlow([{ type: 'assert', ts: 0, selector: '#h', text: 'Grace Hopper Ward' }])));
    expect(auditFlowtape({ cwd: root }).map((f) => f.kind).sort()).toEqual(['name', 'screenshots']);
    write('audit-allow.txt', 'Grace Hopper\n');
    expect(auditFlowtape({ cwd: root }).map((f) => f.kind)).toEqual(['screenshots']);
  });

  it('scans nothing for an empty path list (nothing staged)', () => {
    write('prompts/edited.md', '943 476 5919\n');
    expect(auditFlowtape({ cwd: root, paths: [] })).toEqual([]);
  });
});
