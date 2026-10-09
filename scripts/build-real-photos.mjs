#!/usr/bin/env node
// Jon's decision 48 (2026-09-28): his real photos replace the Unsplash stand-ins in public/img. The ONLY generator of
// public/img/<slot>-<w>.webp for the slots below. Input is the PRIVATE slot -> photo map (manifest.json, not in this
// repo; its JPEGs are already metadata-stripped). Output keeps each stand-in's widths and aspect ratio, cropped
// around the manifest focal point (CSS object-position semantics), with NO metadata at all (no EXIF, XMP, IPTC, ICC).
// A slot may hold up to MAX_SLIDES sources (a list, shown in turn): the first renders to <slot>-<w>.webp as before,
// source n >= 2 to <slot>-<n>-<w>.webp, with the same widths, aspect and quality. A source with `aspect: "source"`
// keeps its own aspect (it is pre-cut; the page frames it per breakpoint from its `view`, see docs/PHOTOS.md).
//   node scripts/build-real-photos.mjs [path/to/manifest.json]   (default: $TWJ_PHOTO_MANIFEST)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

/** slot -> [widths (ascending, as in src/ui/photo-slots.ts), aspect w, aspect h] */
export const SLOTS = {
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
  'surprise-me': [[480, 800, 1200], 4, 3],
  'pitch-me': [[480, 800, 1200], 4, 3],
  'something-new': [[480, 800, 1200], 4, 3],
};
const MAX_BYTES = 190 * 1024; // photo-slots.test.ts IMGSLOT budget is 200 KB
/** the WebP quality each slot starts at (default 80, stepping down by 5 only to fit MAX_BYTES). T4.6.04 (Jon,
 *  2026-10-03): why and close sit below the fold on /, but within Chrome's lazy-load distance on a phone, so they
 *  download while the hero paints; at q60 they stop slowing the hero. Never lower the hero or a page's first photo. */
const QUALITY = { why: 60, close: 60 };
/** the most photos one slot shows in turn */
export const MAX_SLIDES = 6;
/** the ratio keys a source's `view` may name (the --ph-ratio-<key> tokens: one per kind and breakpoint) */
export const VIEW_KEYS = Object.freeze([
  'hero-s',
  'hero-m',
  'hero',
  'band',
  'band-l',
  'close-s',
  'close-m',
  'close-l',
  'close-tile',
  'dish',
  'sheet',
  'sheet-l',
  'thumb',
  'thumb-l',
  'sent',
  'sent-m',
]);
/** a view position: two percentages, x then y, 0-100, at most one decimal place */
const VIEW_POS = /^(\d{1,3}(?:\.\d)?)% (\d{1,3}(?:\.\d)?)%$/;
export const FRAME_MIN = 0.2;
export const FRAME_MAX = 5;
/** a view's zoom: the photo drawn this much larger than cover, about its pos point, clipped by its box (unframed
 *  views only: a framed photo's box sits on paper, which a larger photo would cover) */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

function fail(msg) {
  throw new Error(`build-real-photos: ${msg}`);
}

/**
 * The manifest's `slots` as { slot: [{ file, pos? }, ...] } (1..MAX_SLIDES sources each). Takes the object form
 * ({ file, pos }) or a list of them. Fails on an unknown slot, an empty or too-long list, or an entry with no file.
 */
export function parseSlots(slots) {
  if (slots === undefined) return {};
  if (typeof slots !== 'object' || slots === null || Array.isArray(slots))
    fail('"slots" must be an object of slot -> source(s)');
  const out = {};
  for (const [slot, entry] of Object.entries(slots)) {
    if (!Object.hasOwn(SLOTS, slot)) fail(`unknown slot "${slot}"`);
    const list = Array.isArray(entry) ? entry : [entry];
    if (list.length < 1 || list.length > MAX_SLIDES)
      fail(`${slot}: 1 to ${MAX_SLIDES} sources, not ${list.length}`);
    out[slot] = list.map((e, i) => {
      if (typeof e !== 'object' || e === null || typeof e.file !== 'string' || e.file.length === 0)
        fail(`${slot} #${i + 1}: needs a "file"`);
      if (e.pos !== undefined) [0, 1].forEach((axis) => pct(slot, e.pos, axis));
      if (e.aspect !== undefined && e.aspect !== 'source') fail(`${slot} #${i + 1}: aspect must be "source"`);
      const out = { file: e.file };
      if (e.pos !== undefined) out.pos = e.pos;
      if (e.aspect !== undefined) out.aspect = e.aspect;
      if (e.view !== undefined) out.view = parseView(`${slot} #${i + 1}`, e.view);
      return out;
    });
  }
  return out;
}

/** A source's `view`: { <ratio key>: "x% y%" | { pos: "x% y%", frame?: <w/h>, zoom?: <1-3> } }, validated and copied. */
export function parseView(where, view) {
  if (typeof view !== 'object' || view === null || Array.isArray(view))
    fail(`${where}: view must be an object`);
  const posOk = (p) => {
    const m = VIEW_POS.exec(String(p));
    return m !== null && Number(m[1]) <= 100 && Number(m[2]) <= 100;
  };
  const out = {};
  for (const [key, v] of Object.entries(view)) {
    if (!VIEW_KEYS.includes(key)) fail(`${where}: unknown view key "${key}"`);
    if (typeof v === 'string') {
      if (!posOk(v)) fail(`${where}: view ${key} pos "${v}" must be "x% y%" (0-100, one decimal)`);
      out[key] = v;
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const extra = Object.keys(v).filter((k) => k !== 'pos' && k !== 'frame' && k !== 'zoom');
      if (extra.length) fail(`${where}: view ${key} has unknown field(s) ${extra.join(', ')}`);
      if (!posOk(v.pos)) fail(`${where}: view ${key} pos "${v.pos}" must be "x% y%" (0-100, one decimal)`);
      if (
        v.frame !== undefined &&
        !(typeof v.frame === 'number' && v.frame >= FRAME_MIN && v.frame <= FRAME_MAX)
      )
        fail(`${where}: view ${key} frame must be a number ${FRAME_MIN}-${FRAME_MAX}`);
      if (v.zoom !== undefined && !(typeof v.zoom === 'number' && v.zoom >= ZOOM_MIN && v.zoom <= ZOOM_MAX))
        fail(`${where}: view ${key} zoom must be a number ${ZOOM_MIN}-${ZOOM_MAX}`);
      if (v.zoom !== undefined && v.frame !== undefined)
        fail(`${where}: view ${key} has both frame and zoom (zoom is for an unframed view)`);
      out[key] = { pos: v.pos };
      if (v.frame !== undefined) out[key].frame = v.frame;
      if (v.zoom !== undefined) out[key].zoom = v.zoom;
    } else fail(`${where}: view ${key} must be "x% y%" or { pos, frame, zoom }`);
  }
  return out;
}

/**
 * The browser's views (src/ui/photo-views.json): { <slot>: [ <view of source 1>, <source 2>, ... ] } for the slots
 * where any source has a view ({} for a source without one). No view anywhere: {} (the page renders as today).
 */
export function viewsFor(slots) {
  const out = {};
  for (const [slot, list] of Object.entries(slots))
    if (list.some((e) => e.view)) out[slot] = list.map((e) => e.view ?? {});
  return out;
}

/** public/img name of slot source n (1-based) at width w: source 1 keeps the stand-in's name */
export const outName = (slot, n, w) => (n === 1 ? `${slot}-${w}.webp` : `${slot}-${n}-${w}.webp`);

/** one axis of a CSS object-position in percent ('50% 45%'), as 0..1; keywords are refused, not guessed */
const pct = (slot, s, i) => {
  const v = String(s ?? '50% 50%').split(/\s+/)[i] ?? '50%';
  if (!/^\d+(\.\d+)?%$/.test(v)) fail(`${slot}: pos "${s}" must be two percentages, e.g. "50% 45%"`);
  return Math.min(1, Math.max(0, Number(v.slice(0, -1)) / 100));
};

async function renderOne(slot, n, src, pos, outDir, log, aspect) {
  const [widths, aw, ah] = SLOTS[slot];
  // .rotate() applies the EXIF Orientation first (a phone portrait stays upright); the output carries no metadata
  // (decoded to raw sRGB pixels once: no second lossy encode)
  const { data, info } = await sharp(src).rotate().raw().toBuffer({ resolveWithObject: true });
  const { width: w0, height: h0, channels } = info;
  const upright = () => sharp(data, { raw: { width: w0, height: h0, channels } });
  // aspect "source": the whole source, at its own aspect (no crop to the slot's)
  const own = aspect === 'source';
  const r = own ? w0 / h0 : aw / ah;
  let cw = w0,
    ch = h0;
  if (w0 / h0 > r) cw = Math.round(h0 * r);
  else ch = Math.round(w0 / r);
  const left = own ? 0 : Math.round(pct(slot, pos, 0) * (w0 - cw));
  const top = own ? 0 : Math.round(pct(slot, pos, 1) * (h0 - ch));
  const written = [];
  for (const w of widths) {
    const h = own ? Math.round((w * h0) / w0) : Math.round((w * ah) / aw);
    const name = outName(slot, n, w);
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
    if (buf.length > MAX_BYTES) fail(`${name} is ${buf.length} B, over ${MAX_BYTES} B even at q50`);
    writeFileSync(join(outDir, name), buf);
    written.push(name);
    log(
      `${name} ${w}x${h} q${q} ${(buf.length / 1024).toFixed(0)}KB crop ${cw}x${ch}@${left},${top}${w > cw ? ' UPSCALED' : ''}`,
    );
  }
  return written;
}

/**
 * Renders every slot of `manifest` (sources relative to `baseDir`) into `outDir`. Everything is validated (slots,
 * counts, files) before the first file is written. Returns the files written, each slot's slide count and the views.
 */
export async function buildRealPhotos(manifest, baseDir, outDir, log = console.log) {
  const slots = parseSlots(manifest.slots);
  for (const [slot, list] of Object.entries(slots))
    list.forEach((e, i) => {
      if (!existsSync(join(baseDir, e.file))) fail(`${slot} #${i + 1}: source file is missing`);
    });
  const files = [];
  const slides = {};
  for (const [slot, list] of Object.entries(slots)) {
    for (const [i, e] of list.entries())
      files.push(...(await renderOne(slot, i + 1, join(baseDir, e.file), e.pos, outDir, log, e.aspect)));
    slides[slot] = list.length;
  }
  return { files, slides, views: viewsFor(slots) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifestPath = process.argv[2] ?? process.env.TWJ_PHOTO_MANIFEST;
  if (!manifestPath) fail('usage: build-real-photos.mjs <manifest.json>');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
  await buildRealPhotos(manifest, dirname(manifestPath), out);
}
