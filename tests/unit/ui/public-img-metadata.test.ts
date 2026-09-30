// Jon decision 48 (2026-09-28): public/img ships with every build (and this repo is public), so no image in it may
// carry EXIF (camera, dates, GPS), XMP or IPTC. Jon's own photos (the slots with no stand-in `credit`) carry no ICC
// profile either: scripts/build-real-photos.mjs writes pixels only.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PHOTO_DIR, PHOTO_SLOTS } from '@/ui/photo-slots';

const IMG = join(process.cwd(), 'public', PHOTO_DIR.slice(1));
const webps = readdirSync(IMG).filter((f) => f.endsWith('.webp'));

describe('public/img metadata (dec 48)', () => {
  it('finds the images', () => expect(webps.length).toBeGreaterThan(0));

  it.each(webps)('%s has no EXIF, XMP or IPTC', async (f) => {
    const m = await sharp(join(IMG, f)).metadata();
    expect({ f, exif: m.exif, xmp: m.xmp, iptc: m.iptc }).toEqual({
      f,
      exif: undefined,
      xmp: undefined,
      iptc: undefined,
    });
  });

  it('Jon’s own photos carry no metadata at all (no ICC either)', async () => {
    const own = Object.values(PHOTO_SLOTS).filter((p) => !p.credit);
    expect(own.length).toBeGreaterThan(0);
    for (const p of own)
      for (const w of p.w) {
        const f = `${p.file}-${w}.webp`;
        const m = await sharp(join(IMG, f)).metadata();
        expect({ f, exif: m.exif, xmp: m.xmp, iptc: m.iptc, icc: m.icc }).toEqual({
          f,
          exif: undefined,
          xmp: undefined,
          iptc: undefined,
          icc: undefined,
        });
      }
  });
});
