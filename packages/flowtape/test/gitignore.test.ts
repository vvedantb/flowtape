import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = path.resolve(import.meta.dirname, '../../..');

function ignored(file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', file], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

describe('.gitignore', () => {
  it('lists session history', () => {
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toMatch(/^\*\*\/\.flowtape\/history\/$/m);
  });

  it.each(['.flowtape/history/2026-09-27-abc123.jsonl', 'examples/vite-demo/.flowtape/history/2026-09-27-abc123.jsonl'])('ignores %s', (file) => {
    expect(ignored(file)).toBe(true);
  });

  it.each(['examples/vite-demo/.flowtape/flows/login-and-add-note.json', 'examples/vite-demo/.flowtape/prompts/login-and-add-note.md', '.flowtape/flows/x.json'])(
    'keeps %s committable',
    (file) => {
      expect(ignored(file)).toBe(false);
    },
  );
});
