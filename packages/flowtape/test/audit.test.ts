import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { auditFlowtape, formatFindings, stagedFlowtapeFiles } from '../src/audit';
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

  it('checks flat history events like events inside a flow, without treating a field label as a name', () => {
    write(
      'history/2026-01-01-s.jsonl',
      [
        JSON.stringify({ type: 'session', version: 1, sessionId: 's', startedAt: '2026-01-01T00:00:00.000Z' }),
        JSON.stringify({ type: 'input', ts: 0, selector: '#n', name: 'Full name', inputType: 'text', redacted: false, value: 'Dr Jane Smith' }),
        JSON.stringify({ type: 'input', ts: 1, selector: '#g', name: 'Grace Hopper', inputType: 'text', redacted: false, value: 'x' }),
        JSON.stringify({ type: 'assert', ts: 2, selector: '#r', text: 'Mrs Patel has 3 visits' }),
      ].join('\n'),
    );
    expect(auditFlowtape({ cwd: root }).map((f) => [f.kind, f.file.split(':').pop(), f.where])).toEqual([
      ['name', '2', 'value'],
      ['unmasked-field', '2', 'value'],
      ['name', '4', 'text'],
    ]);
  });

  it('warns on unmasked personal fields in replay script type and select steps', () => {
    write(
      'scripts/s.json',
      JSON.stringify({
        name: 'Sign up',
        steps: [
          { type: 'type', name: 'Phone', value: 'x1', redacted: false },
          { type: 'select', name: 'Gender', value: 'x2' },
          { type: 'type', name: 'Phone', value: null, redacted: true },
          { type: 'click', name: 'Phone', value: 'x3' },
        ],
      }),
    );
    expect(auditFlowtape({ cwd: root }).map((f) => [f.kind, f.where])).toEqual([
      ['unmasked-field', 'steps[0].value'],
      ['unmasked-field', 'steps[1].value'],
    ]);
  });

  it('reports a malformed history line as an error and scans the rest', () => {
    write('history/h.jsonl', `{"type":"input",\n${JSON.stringify({ type: 'assert', ts: 0, selector: '#r', text: 'Mrs Patel' })}\n`);
    expect(auditFlowtape({ cwd: root }).map((f) => [f.severity, f.kind, f.where])).toEqual([
      ['error', 'invalid-json', 'line 1'],
      ['warning', 'name', 'text'],
    ]);
  });

  it("accepts a script's screenshots when its path is listed in audit-allow.txt", () => {
    const script = JSON.stringify({ steps: [{ type: 'click', screenshots: { page: 'AAAA' } }] });
    write('scripts/a.json', script);
    write('scripts/b.json', script);
    write('scripts/c.json', script);
    write('audit-allow.txt', 'scripts/a.json\n.flowtape/scripts/b.json\n');
    expect(auditFlowtape({ cwd: root }).map((f) => [f.kind, f.file])).toEqual([['screenshots', path.join('.flowtape', 'scripts', 'c.json')]]);
  });
});

describe('stagedFlowtapeFiles', () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

  beforeEach(() => {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
  });

  it('lists staged .flowtape files from a subfolder and reads the staged content, not the working copy', () => {
    write('prompts/p.md', '943 476 5919\n');
    write('prompts/old name.md', 'clean\n');
    fs.mkdirSync(path.join(root, 'app'));
    fs.writeFileSync(path.join(root, 'app', 'other.md'), 'not flowtape\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    git('mv', '.flowtape/prompts/old name.md', '.flowtape/prompts/new name.md');
    fs.writeFileSync(path.join(root, '.flowtape', 'prompts', 'p.md'), 'Type 943 476 5919\n');
    git('add', '-A');
    // Cleaned up in the working copy after staging.
    fs.writeFileSync(path.join(root, '.flowtape', 'prompts', 'p.md'), 'clean\n');

    const files = stagedFlowtapeFiles(path.join(root, 'app'));
    const top = git('rev-parse', '--show-toplevel').trim();
    expect(files.map((f) => path.relative(top, f.file)).sort()).toEqual([path.join('.flowtape', 'prompts', 'new name.md'), path.join('.flowtape', 'prompts', 'p.md')]);
    expect(files.find((f) => f.file.endsWith('p.md'))?.text).toBe('Type 943 476 5919\n');
    expect(auditFlowtape({ cwd: path.join(root, 'app'), files }).map((f) => f.kind)).toEqual(['pattern']);
  });

  it('throws when a staged file cannot be read', () => {
    write('prompts/p.md', 'x\n');
    git('add', '-A');
    // Corrupt the staged blob so `git show` fails.
    const blob = git('rev-parse', ':.flowtape/prompts/p.md').trim();
    const object = path.join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
    fs.chmodSync(object, 0o644);
    fs.writeFileSync(object, 'broken');
    expect(() => stagedFlowtapeFiles(root)).toThrow(/Cannot read staged file \.flowtape\/prompts\/p\.md/);
  });
});
