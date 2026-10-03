// QA L4: "Invite goes out in 10 s .", "Tap a time on the left .": the UI face (Schibsted Grotesk) gives "." and ","
// a figure's width under tabular-nums (measured: "." 4 px → 10 px, "," 4 px → 11 px at 16 px), so a sentence set in
// tabular figures shows a gap before its punctuation. Tabular figures are only for boxes that hold numbers, times and
// dates; a rule that sets them on a new box has to be added here on purpose.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../src/ui/site.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Boxes whose text is only counts, codes, times or dates (no sentence punctuation). */
const NUMBERS_ONLY = [
  '.tnum',
  '.tabs .tc',
  '.week-cap',
  '.tile',
  '.cal .day',
  ".filters [role='tab'] .n",
  '.req .age',
  '.tabbar .badge',
  '.choice .t',
  '.wk .c',
  '.winrow .t',
  '.code-in',
  '.bigcode',
  '.a5-count',
];

const tabular = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /font-variant-numeric:\s*tabular-nums/.test(m[2]!))
  .map((m) => m[1]!.trim());

describe('tabular figures only where the text is numbers (QA L4)', () => {
  it('finds the rules', () => {
    expect(tabular.length).toBeGreaterThan(5);
  });
  it('every tabular-nums rule is a numbers-only box', () => {
    expect(tabular.filter((s) => !NUMBERS_ONLY.includes(s))).toEqual([]);
  });
  it('the sentences QA saw are set in proportional figures', () => {
    for (const s of ['.picks li', '.receipt ul', '.toast .sub']) expect(tabular).not.toContain(s);
  });
});
