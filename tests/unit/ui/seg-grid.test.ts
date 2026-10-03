// QA L8: the segmented choice (.seg: the admin Lock sheet's Start and Length, the week editor, reply promise) wraps
// into a 2-column grid of 4 or 5 tiles. Its lines came from the box outline plus a left border on every tile after
// the first, so a tile starting a row got a doubled left line and rows had no line between them. Now every tile draws
// its own right and bottom line and the box draws the top and left: one even line around every tile, any count.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../src/ui/site.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const rule = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.trim() === selector)?.[2] ?? null;

describe('.seg grid lines (QA L8)', () => {
  it('the box draws the top and left line only', () => {
    const box = rule('.seg')!;
    expect(box).toMatch(/border-top:\s*var\(--bw\) solid var\(--c-line\)/);
    expect(box).toMatch(/border-left:\s*var\(--bw\) solid var\(--c-line\)/);
    expect(box).not.toMatch(/(^|;)\s*border:/);
  });
  it('each tile draws its right and bottom line', () => {
    const tile = rule('.seg label')!;
    expect(tile).toMatch(/border-right:\s*var\(--bw\) solid var\(--c-line\)/);
    expect(tile).toMatch(/border-bottom:\s*var\(--bw\) solid var\(--c-line\)/);
  });
  it('no tile adds a line by position', () => {
    expect(rule('.seg label + label')).toBeNull();
  });
});
