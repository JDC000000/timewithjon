// src/ui/photo-sizes.ts: every photo kind has measured <img sizes>, and the big full-width kinds tell dense phones to
// fetch for about 2x (so a 3x phone never takes the 1600 w file for a phone-width photo).
import { describe, expect, it } from 'vitest';
import { PHOTO_SIZES } from '@/ui/photo-sizes';

describe('photo sizes', () => {
  it('covers every kind', () => {
    expect(Object.keys(PHOTO_SIZES).sort()).toEqual(
      ['band', 'close', 'dish', 'hero', 'sent', 'sheet', 'thumb', 'wine'].sort(),
    );
  });

  it('dense phones fetch for ~2x on every kind that shows a photo; each list ends in a plain fallback', () => {
    for (const [kind, s] of Object.entries(PHOTO_SIZES)) {
      if (kind !== 'wine') expect(s, kind).toContain('(max-width: 639px) and (min-resolution: 2.5dppx)');
      const last = s.split(',').at(-1)!.trim();
      expect(last, kind).not.toMatch(/^\(/); // the last entry has no media condition
    }
  });

  it('the hero and the /book thumb never claim more than their column on wide screens', () => {
    expect(PHOTO_SIZES.hero).toContain('(min-width: 1024px) min(50vw, 600px)');
    expect(PHOTO_SIZES.thumb).toContain('(min-width: 1024px) min(53vw, 704px)');
  });
});
