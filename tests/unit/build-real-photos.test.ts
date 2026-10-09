// docs/PHOTOS.md: scripts/build-real-photos.mjs renders the private manifest's `slots` into public/img names. Driven
// with generated solid-colour sources in a temp folder: no real photo ever enters the repo or this test.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRealPhotos,
  MAX_SLIDES,
  outName,
  parseSlots,
  parseView,
  SLOTS,
  VIEW_KEYS,
  viewsFor,
} from '../../scripts/build-real-photos.mjs';
import { MAX_SLIDES as UI_MAX_SLIDES, PHOTO_SLOTS } from '../../src/ui/photo-slots';

let dir: string;
let src: string;
let out: string;
const quiet = () => {};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'twj-build-photos-test-'));
  src = join(dir, 'sources');
  out = join(dir, 'out');
  for (const d of [src, out]) mkdirSync(d);
  // a tall source (3:5) for the aspect "source" render
  await sharp({ create: { width: 300, height: 500, channels: 3, background: '#468' } })
    .jpeg()
    .toFile(join(dir, 'sources', 'tall.jpg'));
  const colours = ['#c33', '#3c3', '#33c', '#cc3', '#3cc', '#c3c', '#999'];
  await Promise.all(
    colours.map((c, i) =>
      sharp({ create: { width: 320, height: 240, channels: 3, background: c } })
        .jpeg()
        .toFile(join(src, `s${i + 1}.jpg`)),
    ),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const files = (n: number) => Array.from({ length: n }, (_, i) => ({ file: `sources/s${i + 1}.jpg` }));
const clean = () => {
  for (const f of readdirSync(out)) rmSync(join(out, f));
};

describe('parseSlots', () => {
  it('takes the object form unchanged, as a list of one', () => {
    expect(parseSlots({ grind: { file: 'a.jpg', pos: '50% 40%' } })).toEqual({
      grind: [{ file: 'a.jpg', pos: '50% 40%' }],
    });
    expect(parseSlots(undefined)).toEqual({});
  });

  it('takes a list of 1 to 6 sources', () => {
    expect(parseSlots({ hero: files(6) }).hero).toHaveLength(6);
    expect(MAX_SLIDES).toBe(6);
    expect(UI_MAX_SLIDES).toBe(MAX_SLIDES);
  });

  it('fails on more than 6, an empty list, an unknown slot, a source with no file, a bad focal point', () => {
    expect(() => parseSlots({ hero: files(7) })).toThrow(/1 to 6 sources, not 7/);
    expect(() => parseSlots({ hero: [] })).toThrow(/1 to 6 sources, not 0/);
    expect(() => parseSlots({ 'no-such-slot': { file: 'a.jpg' } })).toThrow(/unknown slot "no-such-slot"/);
    expect(() => parseSlots({ hero: [{ file: 'a.jpg' }, { pos: '50% 50%' }] })).toThrow(
      /hero #2: needs a "file"/,
    );
    expect(() => parseSlots({ hero: [{ file: 'a.jpg', pos: 'center' }] })).toThrow(/two percentages/);
    expect(() => parseSlots([{ file: 'a.jpg' }])).toThrow(/must be an object/);
  });

  it('knows every slot of photo-slots.ts', () => {
    for (const slot of Object.keys(PHOTO_SLOTS)) expect(Object.hasOwn(SLOTS, slot), slot).toBe(true);
  });
});

describe('buildRealPhotos', () => {
  it('names photo 1 as the stand-in, photo n as <slot>-<n>-<w>.webp', () => {
    expect(outName('hero', 1, 480)).toBe('hero-480.webp');
    expect(outName('hero', 2, 480)).toBe('hero-2-480.webp');
  });

  it('a list renders n files per width at the slot’s size, with no metadata, and returns the count', async () => {
    clean();
    const r = await buildRealPhotos({ slots: { grind: files(3) } }, dir, out, quiet);
    const widths = SLOTS.grind![0];
    const want = [1, 2, 3].flatMap((n) => widths.map((w) => outName('grind', n, w)));
    expect(r.files.sort()).toEqual([...want].sort());
    expect(readdirSync(out).sort()).toEqual([...want].sort());
    expect(r.slides).toEqual({ grind: 3 });
    for (const f of want) {
      const m = await sharp(join(out, f)).metadata();
      const w = Number(/-(\d+)\.webp$/.exec(f)![1]);
      expect({ f, format: m.format, width: m.width, height: m.height }).toEqual({
        f,
        format: 'webp',
        width: w,
        height: (w * 3) / 4,
      });
      expect({ f, exif: m.exif, xmp: m.xmp, iptc: m.iptc, icc: m.icc }).toEqual({ f });
    }
    // photo n is its own source: a different colour from photo 1
    const px = async (f: string) => (await sharp(join(out, f)).raw().toBuffer()).subarray(0, 3);
    expect(await px('grind-2-480.webp')).not.toEqual(await px('grind-480.webp'));
  }, 30_000);

  it('the object form renders exactly as before: the stand-in names only, a count of 1', async () => {
    clean();
    const r = await buildRealPhotos({ slots: { 'pitch-me': { file: 'sources/s1.jpg' } } }, dir, out, quiet);
    expect(readdirSync(out).sort()).toEqual(['pitch-me-1200.webp', 'pitch-me-480.webp', 'pitch-me-800.webp']);
    expect(r.slides).toEqual({ 'pitch-me': 1 });
  }, 30_000);

  it('fails before writing anything: too many, unknown slot, missing source', async () => {
    clean();
    await expect(buildRealPhotos({ slots: { hero: files(7) } }, dir, out, quiet)).rejects.toThrow(/not 7/);
    await expect(buildRealPhotos({ slots: { nope: files(1) } }, dir, out, quiet)).rejects.toThrow(
      /unknown slot/,
    );
    await expect(
      buildRealPhotos(
        { slots: { grind: files(1), hero: [{ file: 'sources/s1.jpg' }, { file: 'sources/gone.jpg' }] } },
        dir,
        out,
        quiet,
      ),
    ).rejects.toThrow(/hero #2: source file is missing/);
    expect(readdirSync(out)).toEqual([]);
    expect(existsSync(join(out, 'grind-480.webp'))).toBe(false);
  });
});

describe('framing: aspect "source" and view (docs/PHOTOS.md)', () => {
  const VIEW = { 'hero-s': { pos: '50% 13.9%', frame: 1.141 }, hero: '50% 18%' };

  it('passes aspect and a validated view through; entries without them are unchanged', () => {
    expect(
      parseSlots({ hero: [{ file: 'a.jpg', aspect: 'source', view: VIEW }, { file: 'b.jpg' }] }),
    ).toEqual({
      hero: [{ file: 'a.jpg', aspect: 'source', view: VIEW }, { file: 'b.jpg' }],
    });
    expect(parseSlots({ grind: { file: 'a.jpg', pos: '50% 40%' } })).toEqual({
      grind: [{ file: 'a.jpg', pos: '50% 40%' }],
    });
  });

  it('knows the ratio keys of every photo kind and breakpoint', () => {
    expect([...VIEW_KEYS].sort()).toEqual(
      [
        'band',
        'band-l',
        'close-l',
        'close-m',
        'close-s',
        'dish',
        'hero',
        'hero-m',
        'hero-s',
        'sent',
        'sent-m',
      ]
        .concat(['sheet', 'sheet-l', 'thumb', 'thumb-l'])
        .sort(),
    );
  });

  it('fails the build on a bad aspect, key, pos or frame', () => {
    const bad = (e: object) => () => parseSlots({ hero: [{ file: 'a.jpg', ...e }] });
    expect(bad({ aspect: 'slot' })).toThrow(/aspect must be "source"/);
    expect(bad({ view: [] })).toThrow(/view must be an object/);
    expect(bad({ view: { wide: '50% 50%' } })).toThrow(/unknown view key "wide"/);
    expect(bad({ view: { hero: '50% 50' } })).toThrow(/must be "x% y%"/);
    expect(bad({ view: { hero: '50% 101%' } })).toThrow(/must be "x% y%"/);
    expect(bad({ view: { hero: '50% 13.95%' } })).toThrow(/must be "x% y%"/);
    expect(bad({ view: { hero: { pos: '50% 50%', frame: 0.1 } } })).toThrow(/frame must be a number 0.2-5/);
    expect(bad({ view: { hero: { pos: '50% 50%', frame: 6 } } })).toThrow(/frame must be a number 0.2-5/);
    expect(bad({ view: { hero: { pos: '50% 50%', frame: '1.2' } } })).toThrow(/frame must be a number/);
    expect(bad({ view: { hero: { pos: '50% 50%', fit: 'contain' } } })).toThrow(/unknown field/);
    expect(bad({ view: { hero: 3 } })).toThrow(/must be "x% y%" or \{ pos, frame \}/);
    expect(parseView('x', { dish: { pos: '0% 100%' } })).toEqual({ dish: { pos: '0% 100%' } });
  });

  it('views: per slot, one entry per source ({} without a view); none at all = {}', () => {
    expect(viewsFor(parseSlots({ grind: [{ file: 'a.jpg' }], hero: { file: 'b.jpg' } }))).toEqual({});
    expect(
      viewsFor(
        parseSlots({ hero: [{ file: 'a.jpg', view: VIEW }, { file: 'b.jpg' }], grind: { file: 'c.jpg' } }),
      ),
    ).toEqual({
      hero: [VIEW, {}],
    });
  });

  it('aspect "source" keeps the source\'s own aspect at the slot\'s widths; the build returns the views', async () => {
    clean();
    const r = await buildRealPhotos(
      { slots: { 'pitch-me': [{ file: 'sources/tall.jpg', aspect: 'source', view: { dish: '50% 20%' } }] } },
      dir,
      out,
      quiet,
    );
    for (const w of SLOTS['pitch-me']![0]) {
      const m = await sharp(join(out, `pitch-me-${w}.webp`)).metadata();
      expect({ w, width: m.width, height: m.height }).toEqual({
        w,
        width: w,
        height: Math.round((w * 5) / 3),
      });
    }
    expect(r.views).toEqual({ 'pitch-me': [{ dish: '50% 20%' }] });
  }, 30_000);
});
