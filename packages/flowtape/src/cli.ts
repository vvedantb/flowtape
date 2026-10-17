#!/usr/bin/env node
import path from 'node:path';
import { findHistoryDir, listHistory } from './server';

const USAGE = `Usage: flowtape history [path]
       flowtape record <url> [--out file] [--headed] [--name name]
       flowtape replay <file> [--jev | --no-jev] [--threshold <0-1>] [--headed]

record   Open <url> in Chromium and save a replay script (default .flowtape/scripts/<name>.json). Ctrl+C stops.
replay   Replay a script with Playwright. Jev visual fallback runs when TYPESAFE_API_KEY is set, unless --no-jev.
history  List recent session history files in the nearest .flowtape/history/ at or above [path] (default: cwd).`;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function history(from: string): void {
  const dir = findHistoryDir(from);
  if (!dir) {
    console.log(`No .flowtape/history/ found at or above ${path.resolve(from)}.`);
    return;
  }
  const files = listHistory(dir);
  if (files.length === 0) {
    console.log(`${path.relative(process.cwd(), dir) || '.'} is empty.`);
    return;
  }
  for (const { file, size, mtime } of files.slice(0, 20)) {
    console.log(`${formatTime(mtime)}  ${formatSize(size).padStart(8)}  ${path.relative(process.cwd(), file)}`);
  }
  if (files.length > 20) console.log(`… and ${files.length - 20} older`);
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Positional args: everything that is neither a flag nor a flag's value. */
function positional(args: string[], valueFlags: string[]): string[] {
  return args.filter((a, i) => !a.startsWith('--') && !valueFlags.includes(args[i - 1]?.slice(2) ?? ''));
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === 'history') {
    history(args[0] ?? process.cwd());
    return 0;
  }
  if (command === 'record') {
    const [url] = positional(args, ['out', 'name']);
    if (!url) return fail('record needs a URL.');
    const { recordCommand } = await import('./script/record');
    const file = await recordCommand({ url, out: option(args, 'out'), name: option(args, 'name'), headed: flag(args, 'headed') });
    console.log(`Saved ${path.relative(process.cwd(), file)}`);
    return 0;
  }
  if (command === 'replay') {
    const [file] = positional(args, ['threshold']);
    if (!file) return fail('replay needs a script file.');
    const raw = option(args, 'threshold');
    const threshold = raw === undefined ? undefined : Number(raw);
    if (threshold !== undefined && !(threshold >= 0 && threshold <= 1)) return fail('--threshold must be between 0 and 1.');
    if (flag(args, 'jev') && flag(args, 'no-jev')) return fail('Use --jev or --no-jev, not both.');
    const { replayCommand } = await import('./script/replay');
    return replayCommand({ file, jev: flag(args, 'jev') ? true : flag(args, 'no-jev') ? false : undefined, threshold, headed: flag(args, 'headed') });
  }
  console.log(USAGE);
  return command === undefined || command === '--help' || command === '-h' ? 0 : 1;
}

function fail(message: string): number {
  console.error(`${message}\n\n${USAGE}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
