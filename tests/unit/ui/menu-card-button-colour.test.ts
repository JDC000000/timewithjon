// Design round 6, M1 colour pick A (Jon, 2026-10-09): the menu card's "Book {dish}" label is a gilt button with ink
// words and a 1 px ink edge; a deeper gold on hover and press. Ink text stays AA (4.5:1) on both fills, and the ink
// edge (not the gold, 1.81:1) is what sets the button off the page (3:1 for a control's edge).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const tokens = readFileSync(path.join(ROOT, 'src/ui/tokens.css'), 'utf8');
const css = readFileSync(path.join(ROOT, 'src/ui/site.css'), 'utf8');
const token = (name: string) =>
  /#([0-9a-f]{6})/i.exec(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(tokens)![1]!)![1]!;
const rgb = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]: number[]) => {
  const c = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r!) + 0.7152 * c(g!) + 0.0722 * c(b!);
};
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe('the menu card button colour (M1, pick A)', () => {
  const ink = rgb(token('--c-ink'));
  const gilt = rgb(token('--c-gilt'));
  const canvas = rgb(token('--c-canvas'));
  const hover = rgb(
    /a\.dish-row:is\(:hover, :active\) \.dish-book \{\s*background: #([0-9a-f]{6});/i.exec(css)![1]!,
  );

  it('ink words on the gilt fill and on the hover/press gold are AA', () => {
    expect(contrast(ink, gilt)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ink, hover)).toBeGreaterThanOrEqual(4.5);
  });
  it('the ink edge sets the button off the page; the gold alone would not', () => {
    expect(contrast(ink, canvas)).toBeGreaterThanOrEqual(3);
    expect(contrast(gilt, canvas)).toBeLessThan(3); // why the edge stays ink
  });
  it('site.css: gilt fill, ink edge and words; the deeper gold on hover and press (no wash)', () => {
    expect(css).toMatch(
      /\.dish-row \.dish-book \{\s*background: var\(--c-gilt\);\s*border-color: var\(--c-ink\);\s*color: var\(--c-ink\);/,
    );
    expect(css).not.toMatch(/a\.dish-row:hover \.dish-book \{\s*background: var\(--c-wash\)/);
  });
});
