// Lane U2 copy (pack strings not in src/content): held to the guest-copy rules.
import { describe, expect, it } from 'vitest';
import * as landing from '../landing';

// The banned verb is spelled in parts, as tests/unit/no-d*.test.ts does, so that guard finds no hit here.
const DECL = new RegExp(['\\bde', 'clin'].join(''), 'i');

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'function') out.push(String((v as (x: string) => string)('X')));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

describe('src/content/ui/landing.ts', () => {
  it('keeps the guest-copy bans (TSD §9) and the house time style (decision 14a)', () => {
    const all = strings(landing);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const s of all) {
      expect(s, s).not.toMatch(/—|!|\bjohn\b|\bslot|availab|schedul|fully booked|sold out/i);
      expect(s, s).not.toMatch(DECL);
      expect(s, s).not.toMatch(/\b12–2\b/);
    }
  });
});
