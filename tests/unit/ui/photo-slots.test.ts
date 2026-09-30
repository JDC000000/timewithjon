// src/ui/photo-slots.ts: every listed width exists in public/img, within the pack's IMGSLOT budget (<= 200 KB each),
// and carries no camera metadata (decision 36: Jon's photos are private; EXIF/GPS stripped before any use).
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PHOTO_DIR, PHOTO_SLOTS, photoSources } from '@/ui/photo-slots';

const onDisk = (url: string) => new URL(`../../../public${url}`, import.meta.url);

describe('PHOTO_SLOTS', () => {
  const files = Object.values(PHOTO_SLOTS).flatMap((p) => p.w.map((w) => `${PHOTO_DIR}/${p.file}-${w}.webp`));

  it('lists ascending widths and a string alt for every slot', () => {
    for (const [slot, p] of Object.entries(PHOTO_SLOTS)) {
      expect(p.w.length, slot).toBeGreaterThan(0);
      expect(
        [...p.w].sort((a, b) => a - b),
        slot,
      ).toEqual(p.w);
      expect(typeof p.alt, slot).toBe('string');
    }
  });

  it.each(files)('%s exists, is a WebP, <= 200 KB and has no EXIF/XMP chunk', (url) => {
    expect(statSync(onDisk(url)).size).toBeLessThanOrEqual(200 * 1024);
    const buf = readFileSync(onDisk(url));
    expect(buf.subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(buf.subarray(8, 12).toString('latin1')).toBe('WEBP');
    expect(buf.includes(Buffer.from('EXIF'))).toBe(false);
    expect(buf.includes(Buffer.from('XMP '))).toBe(false);
  });
});

describe('photoSources', () => {
  it('builds src (the smallest width) and a srcset over every width', () => {
    expect(photoSources('why')).toMatchObject({
      src: '/img/why-480.webp',
      srcSet:
        '/img/why-480.webp 480w, /img/why-800.webp 800w, /img/why-1200.webp 1200w, /img/why-1600.webp 1600w',
    });
  });
  it('is null for a slot with no photo yet', () => {
    expect(photoSources('mail-band')).toBeNull();
    expect(photoSources('')).toBeNull();
  });
});
