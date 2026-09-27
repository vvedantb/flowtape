#!/usr/bin/env node
import path from 'node:path';
import { findHistoryDir, listHistory } from './server';

const USAGE = `Usage: flowtape history [path]

List recent session history files in the nearest .flowtape/history/ at or above [path] (default: cwd).`;

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

const [command, arg] = process.argv.slice(2);
if (command === 'history') history(arg ?? process.cwd());
else {
  console.log(USAGE);
  process.exitCode = command === undefined || command === '--help' || command === '-h' ? 0 : 1;
}
