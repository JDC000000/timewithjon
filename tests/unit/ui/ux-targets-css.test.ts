// UX-03 + UX-04: the stylesheet keeps the 44 px targets (sizes come from tokens only, VD1-12).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../../../src/ui/site.css'), 'utf8');

describe('44 px targets (UX-03, UX-04)', () => {
  it('UX-03: the inline "Copy the address" grows its hit area with block padding, staying inline', () => {
    const rule = /\.story-block \.textbtn \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('display: inline;');
    expect(rule).toContain('padding-block: calc((var(--tap) - 1em) / 2);');
  });
  it('UX-04: from 1024 px a month tab is at least --tap wide, its side padding taken out of the gap', () => {
    const block = css.slice(css.indexOf('UX-04: each month keeps'));
    expect(block).toMatch(/column-gap: calc\(var\(--s7\) - 2 \* var\(--s2\)\);/);
    expect(block).toMatch(/padding: 0 var\(--s2\);\s*min-width: var\(--tap\);/);
  });
});
