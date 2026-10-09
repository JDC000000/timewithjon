// r5 N-L1: a course anchor (#big-days, #starters…) lives on /menu only; a link to "/#<course>" lands at the top of the
// landing page. No app link may point a course anchor at the landing.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECTIONS } from '@/content';

const ROOT = path.resolve(__dirname, '../../..');

describe('course anchors point at /menu', () => {
  it('no "/#<course>" link in src/app', () => {
    const ids = SECTIONS.map((s) => s.id).join('|');
    const bad = new RegExp(`["'\`]/#(\\$\\{|${ids})`);
    const hits = globSync('src/app/**/*.tsx', { cwd: ROOT })
      .filter((f) => !f.includes('__tests__'))
      .flatMap((f) =>
        readFileSync(path.join(ROOT, f), 'utf8')
          .split('\n')
          .flatMap((l, i) => (bad.test(l) ? [`${f}:${i + 1}: ${l.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
