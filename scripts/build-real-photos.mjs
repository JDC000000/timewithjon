#!/usr/bin/env node
// Jon's decision 48 (2026-09-28): his real photos replace the Unsplash stand-ins in public/img. The ONLY generator of
// public/img/<slot>-<w>.webp for the slots below. Input is the PRIVATE slot -> photo map (manifest.json, not in this
// repo; its JPEGs are already metadata-stripped). Output keeps each stand-in's widths and aspect ratio, cropped
// around the manifest focal point (CSS object-position semantics), with NO metadata at all (no EXIF, XMP, IPTC, ICC).
//   node scripts/build-real-photos.mjs [path/to/manifest.json]   (default: $TWJ_PHOTO_MANIFEST)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

/** slot -> [widths (ascending, as in src/ui/photo-slots.ts), aspect w, aspect h] */
const SLOTS = {
  hero: [[480, 800, 1200, 1600], 4, 5],
  why: [[480, 800, 1200, 1600], 16, 9],
  close: [[480, 800, 1200, 1600], 16, 9],
  'long-lunch': [[480, 800, 1200], 4, 3],
  'shore-ride': [[480, 800, 1200], 4, 3],
  encore: [[480, 800, 1200], 4, 3],
  'day-trip': [[480, 800, 1200], 4, 3],
  'double-date': [[480, 800, 1200], 4, 3],
  grind: [[480, 800, 1200], 4, 3],
  'first-round': [[480, 800, 1200], 4, 3],
  'family-hang': [[480, 800, 1200], 4, 3],
  // decisions 52 + 53: the menu stand-ins
  'flat-white': [[480, 800, 1200], 4, 3],
  'long-distance': [[480, 800, 1200], 4, 3],
  'old-haunt': [[480, 800, 1200], 4, 3],
  'catch-release': [[480, 800, 1200], 4, 3],
  bluebird: [[480, 800, 1200], 4, 3],
  'surprise-me': [[480, 800, 1200], 4, 3],
  'pitch-me': [[480, 800, 1200], 4, 3],
  'something-new': [[480, 800, 1200], 4, 3],
};
const MAX_BYTES = 190 * 1024; // photo-slots.test.ts IMGSLOT budget is 200 KB
/** the WebP quality each slot starts at (default 80, stepping down by 5 only to fit MAX_BYTES). T4.6.04 (Jon,
 *  2026-10-03): why and close sit below the fold on /, but within Chrome's lazy-load distance on a phone, so they
 *  download while the hero paints; at q60 they stop slowing the hero. Never lower the hero or a page's first photo. */
const QUALITY = { why: 60, close: 60 };

const manifestPath = process.argv[2] ?? process.env.TWJ_PHOTO_MANIFEST;
if (!manifestPath) throw new Error('usage: build-real-photos.mjs <manifest.json>');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const out = join(dirname(new URL(import.meta.url).pathname), '..', 'public', 'img');

/** one axis of a CSS object-position in percent ('50% 45%'), as 0..1; keywords are refused, not guessed */
const pct = (slot, s, i) => {
  const v = String(s ?? '50% 50%').split(/\s+/)[i] ?? '50%';
  if (!/^\d+(\.\d+)?%$/.test(v))
    throw new Error(`${slot}: pos "${s}" must be two percentages, e.g. "50% 45%"`);
  return Math.min(1, Math.max(0, Number(v.slice(0, -1)) / 100));
};

for (const [slot, [widths, aw, ah]] of Object.entries(SLOTS)) {
  const entry = manifest.slots[slot];
  if (!entry) continue; // no Jon photo: the stand-in stays
  const src = join(dirname(manifestPath), entry.file);
  // .rotate() applies the EXIF Orientation first (a phone portrait stays upright); the output carries no metadata
  // (decoded to raw sRGB pixels once: no second lossy encode)
  const { data, info } = await sharp(src).rotate().raw().toBuffer({ resolveWithObject: true });
  const { width: w0, height: h0, channels } = info;
  const upright = () => sharp(data, { raw: { width: w0, height: h0, channels } });
  const r = aw / ah;
  let cw = w0,
    ch = h0;
  if (w0 / h0 > r) cw = Math.round(h0 * r);
  else ch = Math.round(w0 / r);
  const left = Math.round(pct(slot, entry.pos, 0) * (w0 - cw));
  const top = Math.round(pct(slot, entry.pos, 1) * (h0 - ch));
  for (const w of widths) {
    const h = Math.round((w * ah) / aw);
    let q = (QUALITY[slot] ?? 80) + 5,
      buf;
    do {
      q -= 5;
      buf = await upright()
        .extract({ left, top, width: cw, height: ch })
        .resize(w, h, { kernel: 'lanczos3' })
        .toColourspace('srgb')
        .webp({ quality: q, effort: 6 })
        .toBuffer(); // sharp writes no metadata unless asked (no keepMetadata/withMetadata/keepIccProfile)
    } while (buf.length > MAX_BYTES && q > 50);
    if (buf.length > MAX_BYTES)
      throw new Error(`${slot}-${w}.webp is ${buf.length} B, over ${MAX_BYTES} B even at q50`);
    writeFileSync(join(out, `${slot}-${w}.webp`), buf);
    console.log(
      `${slot}-${w}.webp ${w}x${h} q${q} ${(buf.length / 1024).toFixed(0)}KB crop ${cw}x${ch}@${left},${top}${w > cw ? ' UPSCALED' : ''}`,
    );
  }
}
