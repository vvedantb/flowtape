#!/usr/bin/env node
// Bans reading source files as text inside *.test.ts / *.test.tsx.
// Flags string literals that name a .ts/.tsx/.css/.html path when they are
// arguments to readFileSync, readFile, readSource or sourceOf.
// Reads of generated outputs via variables (e.g. saved.testFile) are allowed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git']);
const READERS = /\b(readFileSync|readFile|readSource|sourceOf)\s*\(/g;
const SOURCE_LITERAL = /(['"`])((?:(?!\1)[^\\\n])*?\.(?:tsx?|css|html))\1/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.test\.tsx?$/.test(entry.name)) yield full;
  }
}

// Returns the text of the call arguments starting after the opening paren.
function callArgs(text, start) {
  let depth = 1;
  let i = start;
  for (; i < text.length && depth > 0; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
  }
  return text.slice(start, i);
}

const violations = [];
let scanned = 0;

for (const file of walk(root)) {
  scanned++;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const lineStarts = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  for (const call of text.matchAll(READERS)) {
    const argsStart = call.index + call[0].length;
    const lineIdx = lineOf(call.index);
    if (/^\s*(import|export)\b/.test(lines[lineIdx]) && /\bfrom\b/.test(lines[lineIdx])) continue;
    const args = callArgs(text, argsStart);
    for (const lit of args.matchAll(SOURCE_LITERAL)) {
      const pos = argsStart + lit.index;
      violations.push(`${path.relative(root, file)}:${lineOf(pos) + 1}: ${call[1]}() reads source file "${lit[2]}" as text`);
    }
  }
}

if (violations.length > 0) {
  console.error('Source-text tests are not allowed. Import and exercise the real code instead.\n');
  for (const v of violations) console.error(`  ${v}`);
  console.error(`\n${violations.length} violation(s) in ${scanned} test file(s).`);
  process.exit(1);
}
console.log(`No source-text tests found (${scanned} test files scanned).`);
