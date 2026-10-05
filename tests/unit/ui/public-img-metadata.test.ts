// Jon decision 48 (2026-09-28): public/img ships with every build (and this repo is public), so no image in it may
// carry EXIF (camera, dates, GPS), XMP or IPTC. Jon's own photos (the slots with no stand-in `credit`) carry no ICC
// profile either: scripts/build-real-photos.mjs writes pixels only.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { PHOTO_DIR, PHOTO_SLOTS, photoSlides } from '@/ui/photo-slots';

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
    // a slideshow's photos 2..n (a private build only) are Jon's own too
    const slideFiles = Object.keys(PHOTO_SLOTS).flatMap((slot) =>
      photoSlides(slot).flatMap((s) => s.srcSet.split(', ').map((e) => e.split(' ')[0]!.split('/').pop()!)),
    );
    const names = [...own.flatMap((p) => p.w.map((w) => `${p.file}-${w}.webp`)), ...slideFiles];
    for (const f of names) {
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
