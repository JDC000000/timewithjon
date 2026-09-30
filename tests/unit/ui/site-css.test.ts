// tests/unit/ui/site-css.test.ts (U1, pr72-review F5): the reduced-motion safety net (T1.1a.U2, R1-21) is present,
// last in src/ui/site.css (so no later rule can undo it), and zeroes animation, transition and smooth scroll.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../src/ui/site.css', import.meta.url), 'utf8');

describe('src/ui/site.css reduced-motion net', () => {
  const at = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
  const block = css.slice(at);

  it('is the last block in the file', () => {
    expect(at).toBeGreaterThan(0);
    // nothing but the block itself (one rule inside one media query) follows it
    expect(block.trim().endsWith('}')).toBe(true);
    expect(block.match(/@media/g)).toHaveLength(1);
  });

  it('zeroes every animation, transition and smooth scroll, whatever a rule set before', () => {
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
    for (const decl of [
      'animation-duration: 0s !important',
      'animation-iteration-count: 1 !important',
      'transition-duration: 0s !important',
      'scroll-behavior: auto !important',
    ]) {
      expect(block).toContain(decl);
    }
  });

  it('smooth scrolling is only ever set under no-preference', () => {
    const smooth = [...css.matchAll(/scroll-behavior:\s*smooth/g)].map((m) => m.index!);
    for (const i of smooth) {
      const media = css.lastIndexOf('@media', i);
      expect(css.slice(media, i)).toContain('prefers-reduced-motion: no-preference');
    }
  });
});
