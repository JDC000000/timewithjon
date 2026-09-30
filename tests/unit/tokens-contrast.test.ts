// tests/unit/tokens-contrast.test.ts (U1, T1.1b.U3 + T1.1b.U4; T1.1b AC1/AC2/AC4): the colour tokens in src/ui/tokens.css
// meet WCAG AA for every text/background pair the design uses, controls and selected states keep 3:1 non-text
// contrast, and the gilt accent (v2.2, Jon dec 46) is never a text colour: a fill behind ink only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const tokens = readFileSync(new URL('../../src/ui/tokens.css', import.meta.url), 'utf8');
// Prettier writes attribute values with single quotes; the selectors below use the pack's double quotes
const site = readFileSync(new URL('../../src/ui/site.css', import.meta.url), 'utf8').replace(/'/g, '"');

/** --c-* hex tokens from :root */
function colours(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--c-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]!] = m[2]!;
  return out;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const C = colours(tokens);
const SURFACES = ['canvas', 'paper', 'field', 'wash'] as const;
const TEXT = ['ink', 'ink-2', 'ink-3', 'error'] as const;

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBe(1);
    expect(contrast('#333333', '#FFFFFF')).toBeCloseTo(12.63, 2); // a mid channel: the sRGB curve, not the linear toe
  });
});

describe('tokens.css colours (T1.1b.U3)', () => {
  it('declares the design roles', () => {
    for (const k of [...SURFACES, ...TEXT, 'line', 'rule', 'gilt', 'print']) expect(C[k], k).toMatch(/^#/);
    expect(C.canvas!.toUpperCase()).toBe('#E9E6DE');
    expect(C.ink!.toUpperCase()).toBe('#1F1F1F');
    expect(C.gilt!.toUpperCase()).toBe('#D4A62A');
    // the v1 neon green is gone from every token and from site.css (its SVG swipe fill too)
    expect(Object.values(C).map((v) => v.toUpperCase())).not.toContain('#9FF690');
    expect(`${tokens}\n${site}`).not.toMatch(/9ff690|--c-acid/i);
  });

  for (const t of TEXT) {
    for (const s of SURFACES) {
      it(`text ${t} on ${s} is AA (4.5:1)`, () => {
        expect(contrast(C[t]!, C[s]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('ink on gilt (a picked time, the Sent stamp) and the inverted skip link are AA', () => {
    expect(contrast(C.ink!, C.gilt!)).toBeCloseTo(7.29, 2);
    expect(contrast(C.canvas!, C.ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.ink!, C.print!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the other pairs site.css draws (pr74-review F3) are AA', () => {
    // text on ink-2 (.btn--commit:hover, the sending state), ink on rule (.btn:active), body copy on gilt
    for (const [t, s] of [
      ['canvas', 'ink-2'],
      ['paper', 'ink-2'],
      ['ink', 'rule'],
      ['ink-2', 'gilt'],
    ] as const) {
      expect(contrast(C[t]!, C[s]!), `${t} on ${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every rule that fills with gilt sets ink text on it (ink-3 and error are not AA on gilt)', () => {
    expect(contrast(C['ink-3']!, C.gilt!)).toBeLessThan(4.5);
    expect(contrast(C.error!, C.gilt!)).toBeLessThan(4.5);
    const fills = [...site.matchAll(/([^{}]+)\{([^}]*background(?:-color)?:\s*var\(--c-gilt\)[^}]*)\}/g)];
    expect(fills.length).toBeGreaterThanOrEqual(3); // ::selection, the picked tile, the picked day
    for (const [, sel, body] of fills) expect(body, sel!.trim()).toMatch(/(^|[;\s])color:\s*var\(--c-ink\)/);
  });

  it('control borders keep 3:1 non-text contrast on every surface a control sits on (R1-03)', () => {
    for (const s of ['canvas', 'paper', 'field', 'wash'] as const) {
      expect(contrast(C.line!, C[s]!), s).toBeGreaterThanOrEqual(3);
    }
  });

  it('gilt is a fill only: never a text colour, never a border (AC2)', () => {
    const decls = [
      ...site.matchAll(
        /(^|[;{\s])(color|border(?:-[a-z]+)?-color|border(?:-[a-z]+)?|outline(?:-color)?)\s*:\s*([^;}]*)/g,
      ),
    ];
    const bad = decls.filter((m) => m[3]!.includes('--c-gilt')).map((m) => m[0].trim());
    expect(bad).toEqual([]);
    // and gilt on cream as text would be unreadable anyway (1.81:1)
    expect(contrast(C.gilt!, C.canvas!)).toBeLessThan(3);
  });
});

describe('selected states never rely on colour alone (T1.1b.U4, AC4)', () => {
  // each picked/selected state: the pack's fill + an ink edge (a border or inset stroke) + the tick where it picks
  const PICKS = [
    '.tile[aria-pressed="true"]',
    '.cal .day[aria-pressed="true"]',
    '.choice:has(input:checked)',
    '.seg label:has(input:checked)',
  ];
  const rule = (sel: string) => {
    const i = site.indexOf(`${sel} {`);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return site.slice(i, site.indexOf('}', i));
  };

  for (const sel of PICKS) {
    it(`${sel}: an ink edge and a tick`, () => {
      expect(rule(sel)).toMatch(/var\(--c-ink\)/);
      expect(rule(sel)).toMatch(/box-shadow:[^;]*inset|border(-color)?:[^;]*--c-ink/);
      expect(site).toMatch(
        new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\.ck \\{[^}]*(opacity: 1|display: block)`),
      );
    });
  }

  it('the ink edge holds 3:1 against the fills and the page (so the edge, not the colour, carries the state)', () => {
    for (const s of ['gilt', 'wash', 'paper', 'canvas'] as const) {
      expect(contrast(C.ink!, C[s]!), s).toBeGreaterThanOrEqual(3);
    }
  });

  it('current tabs and nav items carry an ink bar or stroke, not only colour', () => {
    for (const sel of [
      '.tabs [role="tab"][aria-selected="true"]::after',
      '.filters [role="tab"][aria-selected="true"]',
      '.req[aria-current="page"]',
      '.tabbar a[aria-current="page"]::before',
    ]) {
      // any rule for it (a later @media block may only re-place the bar) draws the ink bar or stroke
      const bodies: string[] = [];
      for (let i = site.indexOf(`${sel} {`); i >= 0; i = site.indexOf(`${sel} {`, i + 1)) {
        bodies.push(site.slice(i, site.indexOf('}', i)));
      }
      expect(bodies.length, sel).toBeGreaterThan(0);
      const ink = /background: var\(--c-ink\)|box-shadow: inset[^;]*--c-ink|border-color: var\(--c-ink\)/;
      expect(
        bodies.some((b) => ink.test(b)),
        sel,
      ).toBe(true);
    }
  });
});
