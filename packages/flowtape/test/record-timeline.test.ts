import { describe, expect, it } from 'vitest';
import { placeNavigations, type BusyNavigation } from '../src/script/record';
import type { ReplayStep } from '../src/script/schema';

const origin = 'http://localhost:5731';
const startedAt = 1_000_000;

const click = (url: string, ts: number): ReplayStep => ({ type: 'click', ts, url: `${origin}${url}`, selectors: [{ strategy: 'css', value: 'a' }], expected: { kind: 'none' } });

function place(steps: ReplayStep[], navigations: BusyNavigation[]) {
  const actionTimes = new Map(steps.map((step) => [step, startedAt + step.ts]));
  const nav = (n: BusyNavigation) => ({ ...n, url: `${origin}${n.url}`, at: startedAt + n.at });
  return placeNavigations(steps, navigations.map(nav), actionTimes, startedAt).map((step) => ({ type: step.type, ts: step.ts, expected: step.expected }));
}

describe('placeNavigations', () => {
  it('keeps a later click’s navigation out of a late navigation’s outcome', () => {
    const steps = [click('/index.html', 0), click('/page2.html', 2100)];
    expect(place(steps, [
      { url: '/page2.html', at: 2000, late: true },
      { url: '/index.html', at: 2150, late: false },
    ])).toEqual([
      { type: 'click', ts: 0, expected: { kind: 'none' } },
      { type: 'navigate', ts: 2000, expected: { kind: 'url', url: `${origin}/page2.html` } },
      { type: 'click', ts: 2100, expected: { kind: 'url', url: '/index.html' } },
    ]);
  });

  it('collapses a redirect chain into the late navigation', () => {
    const steps = [click('/index.html', 0)];
    expect(place(steps, [
      { url: '/login', at: 2000, late: true },
      { url: '/auth', at: 2050, late: false },
      { url: '/home', at: 2100, late: false },
    ])).toEqual([
      { type: 'click', ts: 0, expected: { kind: 'none' } },
      { type: 'navigate', ts: 2000, expected: { kind: 'url', url: `${origin}/home` } },
    ]);
  });

  it('gives a slow navigation to the click that started it', () => {
    const steps = [click('/index.html', 0)];
    expect(place(steps, [{ url: '/page2.html', at: 2500, late: false }])).toEqual([
      { type: 'click', ts: 0, expected: { kind: 'url', url: '/page2.html' } },
    ]);
  });
});
