#!/usr/bin/env node
// Optional build step (docs/PHOTOS.md): swap the committed Unsplash stand-ins in public/img for Jon's own photos, which
// live ONLY in a private store, never in git. Runs before `next build`.
//
//   PRIVATE_PHOTOS_BASE_URL  https base of the private store (a folder holding manifest.json). Unset = no-op, so CI,
//                            forks and local dev build with the stand-ins.
//   PRIVATE_PHOTOS_TOKEN     optional; sent as `Authorization: Bearer <token>` (never logged).
//
// manifest.json (at the base URL) may hold any of:
//   "prebuilt": ["hero-480.webp", ...]   finished files, copied over the stand-in of the same name
//   "sha256":   { "hero-480.webp": "<hex>" }   optional integrity pins for prebuilt files
//   "slots":    { "<slot>": { "file": "rel/path.jpg", "pos": "50% 40%" } }   sources, rendered by
//                                          scripts/build-real-photos.mjs (same format it already takes)
//   "text":     { "<exact find>": "<replacement>" }   or   [{ "file", "find", "replace" }]   private copy, applied
//                                          by exact string replace to allow-listed source files (TEXT_FILES)
//   "pos":      { "<slot>": "50% 20%" }   focal-point overrides for existing slots in src/ui/photo-slots.ts
//                                          (scripts/private-overrides.mjs; a find string must occur exactly once)
// Only files that already exist in public/img may be replaced, at the same pixel size, and a replacement must carry
// no metadata (EXIF/XMP/IPTC/ICC). When the env var is set, any failure fails the build (no silent stand-in deploy).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  applyPosOverrides,
  applyTextOverrides,
  parsePosOverrides,
  parseTextOverrides,
  PHOTO_SLOTS_FILE,
} from './private-overrides.mjs';

const BASE = process.env.PRIVATE_PHOTOS_BASE_URL?.trim();
if (!BASE) {
  console.log('fetch-real-photos: PRIVATE_PHOTOS_BASE_URL not set, building with the committed stand-ins');
  process.exit(0);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMG = join(ROOT, 'public', 'img');
const MAX_BYTES = 200 * 1024; // photo-slots.test.ts IMGSLOT budget
const TOKEN = process.env.PRIVATE_PHOTOS_TOKEN?.trim();

const base = new URL(BASE.endsWith('/') ? BASE : `${BASE}/`);
const loopback = base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if (base.protocol !== 'https:' && !loopback)
  throw new Error(
    'fetch-real-photos: PRIVATE_PHOTOS_BASE_URL must be https (http only on loopback, for testing)',
  );

async function get(rel) {
  const res = await fetch(new URL(rel, base), {
    headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  // log the path only: the base URL may itself carry a signed query
  if (!res.ok) throw new Error(`fetch-real-photos: ${rel} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** a manifest path stays inside the private folder: no absolute paths, no '..', no URL tricks */
function safeRel(rel) {
  const n = normalize(String(rel));
  if (!n || n.startsWith('..') || n.startsWith(sep) || /^[a-z]+:/i.test(n) || n.split(sep).includes('..'))
    throw new Error(`fetch-real-photos: unsafe path "${rel}"`);
  return n;
}

const manifest = JSON.parse((await get('manifest.json')).toString('utf8'));
// the source overrides are worked out (and validated) before any file is touched; written after the photos
const textOverrides = parseTextOverrides(manifest.text);
const posOverrides = parsePosOverrides(manifest.pos);
const sourceFiles = [...new Set(textOverrides.map((t) => t.file))];
const rewritten = applyTextOverrides(
  Object.fromEntries(sourceFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')])),
  textOverrides,
);
if (posOverrides.length > 0) {
  const slotsSrc = rewritten[PHOTO_SLOTS_FILE] ?? readFileSync(join(ROOT, PHOTO_SLOTS_FILE), 'utf8');
  rewritten[PHOTO_SLOTS_FILE] = applyPosOverrides(slotsSrc, posOverrides);
}

const prebuilt = manifest.prebuilt ?? [];
const pins = manifest.sha256 ?? {};
let count = 0;

for (const name of prebuilt) {
  if (!/^[a-z0-9-]+-\d+\.webp$/.test(name)) throw new Error(`fetch-real-photos: bad prebuilt name "${name}"`);
  const dest = join(IMG, name);
  if (!existsSync(dest)) throw new Error(`fetch-real-photos: ${name} has no stand-in in public/img`);
  const buf = await get(name);
  if (pins[name] && createHash('sha256').update(buf).digest('hex') !== pins[name])
    throw new Error(`fetch-real-photos: ${name} sha256 mismatch`);
  if (buf.length > MAX_BYTES) throw new Error(`fetch-real-photos: ${name} is over ${MAX_BYTES} B`);
  const [m, s] = await Promise.all([sharp(buf).metadata(), sharp(dest).metadata()]);
  if (m.format !== 'webp' || m.width !== s.width || m.height !== s.height)
    throw new Error(`fetch-real-photos: ${name} must be webp ${s.width}x${s.height}`);
  if (m.exif || m.xmp || m.iptc || m.icc) throw new Error(`fetch-real-photos: ${name} carries metadata`);
  writeFileSync(dest, buf);
  count++;
}

const slots = manifest.slots ?? {};
if (Object.keys(slots).length > 0) {
  const dir = mkdtempSync(join(tmpdir(), 'twj-photos-'));
  try {
    const local = { slots: {} };
    for (const [slot, entry] of Object.entries(slots)) {
      const rel = safeRel(entry.file);
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), await get(rel.split(sep).join('/')));
      local.slots[slot] = { file: rel, pos: entry.pos };
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(local));
    const r = spawnSync(
      process.execPath,
      [join(ROOT, 'scripts', 'build-real-photos.mjs'), join(dir, 'manifest.json')],
      {
        stdio: 'inherit',
      },
    );
    if (r.status !== 0) throw new Error('fetch-real-photos: build-real-photos.mjs failed');
    count += Object.keys(slots).length;
  } finally {
    rmSync(dir, { recursive: true, force: true }); // the sources never stay on the build machine
  }
}

// counts and file names only: the replacement text is private and never logged
for (const [file, contents] of Object.entries(rewritten)) writeFileSync(join(ROOT, file), contents);
if (textOverrides.length + posOverrides.length > 0)
  console.log(
    `fetch-real-photos: ${textOverrides.length} text and ${posOverrides.length} focal-point override(s) applied (${Object.keys(rewritten).join(', ')})`,
  );
console.log(`fetch-real-photos: ${count} private photo file(s)/slot(s) applied from ${base.host}`);
