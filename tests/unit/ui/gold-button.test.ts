// H2 (Jon, 2026-10-09): the gold primary button keeps AA contrast. Its fill and hover come from the tokens only
// (--c-gilt, and a mix with --c-ink on hover); ink text on both must be at least 4.5:1.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const tokens = readFileSync(path.join(ROOT, 'src/ui/tokens.css'), 'utf8');
const css = readFileSync(path.join(ROOT, 'src/ui/site.css'), 'utf8');
const hex = (name: string) =>
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

describe('the gold primary button (H2)', () => {
  const ink = rgb(hex('--c-ink'));
  const gilt = rgb(hex('--c-gilt'));
  it('ink on gilt is AA (7.29:1, as tokens.css says)', () => {
    expect(contrast(ink, gilt)).toBeGreaterThanOrEqual(7);
  });
  it('hover (85% gilt, 15% ink) keeps ink AA', () => {
    const hover = gilt.map((v, i) => 0.85 * v + 0.15 * ink[i]!);
    expect(contrast(ink, hover)).toBeGreaterThanOrEqual(4.5);
  });
  it('site.css: the fill and hover from the tokens, ink text', () => {
    expect(css).toMatch(/\.btn--gold \{\s*background: var\(--c-gilt\);\s*color: var\(--c-ink\);/);
    expect(css).toMatch(
      /\.btn--gold:hover \{\s*background: color-mix\(in srgb, var\(--c-gilt\) 85%, var\(--c-ink\)\);/,
    );
  });
});
