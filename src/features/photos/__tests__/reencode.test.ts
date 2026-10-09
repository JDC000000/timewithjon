// T3.6.03/.08 (AC2): every stored photo is a clean JPEG: no EXIF, no GPS; HEIC and PNG are converted;
// orientation is baked in; C-5 caps the long edge at 3000 px.
// Regression register: evals/bugs/photo-decodes-uncapped.json
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  exifHasGps,
  hasMetadata,
  HEIC,
  jpegWithGps,
  noisyJpeg,
  png,
} from '../../../../tests/fixtures/images';
import { decodeGate } from '../decode-gate';
import { MAX_INPUT_PIXELS } from '../limits';
import { isHeif, sniffFormat, toCleanJpeg, UnreadableImageError } from '../reencode';

/** A few-hundred-byte PNG whose header claims width x height (one deflated row of pixels follows). */
function pngClaiming(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(1 + Math.min(width, 64) * 3))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('toCleanJpeg', () => {
  it('strips EXIF and GPS and applies the orientation (AC2)', async () => {
    const input = await jpegWithGps(400, 300);
    expect(exifHasGps((await sharp(input).metadata()).exif)).toBe(true); // the fixture really carries GPS
    const out = await toCleanJpeg(input);
    expect(await hasMetadata(out.data)).toBe(false);
    expect([out.width, out.height]).toEqual([300, 400]); // orientation 6 → rotated to portrait
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
  });

  it('converts an iPhone HEIC (HEVC) through heic-decode', async () => {
    const input = HEIC();
    expect(isHeif(input)).toBe(true);
    await expect(sharp(input).jpeg().toBuffer()).rejects.toThrow(); // why the fallback exists
    const out = await toCleanJpeg(input);
    expect([out.width, out.height]).toEqual([1280, 854]);
    expect(await hasMetadata(out.data)).toBe(false);
  });

  it('converts a PNG to JPEG', async () => {
    const out = await toCleanJpeg(await png(300, 200));
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it('a 12 MB JPEG is stored at 3000 px on the long edge (C-5)', async () => {
    const input = await noisyJpeg(12 * 1024 * 1024);
    expect(input.length).toBeGreaterThan(10 * 1024 * 1024);
    const out = await toCleanJpeg(input);
    expect(Math.max(out.width, out.height)).toBe(3000);
    expect(await hasMetadata(out.data)).toBe(false);
  }, 30_000);

  it('never enlarges a small photo', async () => {
    const out = await toCleanJpeg(await png(50, 40));
    expect([out.width, out.height]).toEqual([50, 40]);
  });

  it('refuses bytes that are no image', async () => {
    await expect(toCleanJpeg(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(
      UnreadableImageError,
    );
  });

  it('refuses a broken HEIC as unreadable', async () => {
    const broken = Buffer.concat([HEIC().subarray(0, 4096)]);
    await expect(toCleanJpeg(broken)).rejects.toBeInstanceOf(UnreadableImageError);
  });

  it('refuses a HEIC whose container claims more than 50 MP, before decoding (pr38 F1)', async () => {
    const big = Buffer.from(HEIC());
    const ispe = big.indexOf('ispe', 0, 'latin1'); // the shared size box of both top-level images
    expect(big.readUInt32BE(ispe + 8)).toBe(1280);
    big.writeUInt32BE(10_000, ispe + 8);
    big.writeUInt32BE(6_000, ispe + 12); // 60 MP
    await expect(toCleanJpeg(big)).rejects.toThrow('HEIC too large or unreadable');
  });

  it.each([
    [
      'gif',
      () =>
        sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } })
          .gif()
          .toBuffer(),
    ],
    [
      'tiff',
      () =>
        sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } })
          .tiff()
          .toBuffer(),
    ],
    ['svg', async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')],
  ])('refuses a %s even though sharp could read it (pr38 F6)', async (_name, make) => {
    await expect(toCleanJpeg(await make())).rejects.toThrow('not an accepted image');
  });

  it('accepts a WebP', async () => {
    const webp = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#fff' } })
      .webp()
      .toBuffer();
    expect((await toCleanJpeg(webp)).width).toBe(30);
  });

  it('accepts an AVIF, as before the leading-bytes check', async () => {
    const avif = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#fff' } })
      .avif()
      .toBuffer();
    expect(sniffFormat(avif)).toBe('heif');
    const out = await toCleanJpeg(avif);
    expect([out.width, out.height]).toEqual([30, 20]);
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
  });

  it('the leading-bytes check passes every accepted fixture', async () => {
    expect(sniffFormat(await jpegWithGps())).toBe('jpeg');
    expect(sniffFormat(await png())).toBe('png');
    expect(sniffFormat(HEIC())).toBe('heif');
    const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
      .webp()
      .toBuffer();
    expect(sniffFormat(webp)).toBe('webp');
  });

  it('the pixel ceiling still takes a 48 MP phone photo (8064 x 6048)', () => {
    expect(MAX_INPUT_PIXELS).toBeGreaterThanOrEqual(8064 * 6048);
  });

  // The PNG reader itself refuses a 100,000 px edge from the header; the others get past it and the pixel ceiling
  // refuses them before decoding.
  it.each([
    ['100,000 x 100,000', 100_000, 100_000, /^$/],
    ['just over the ceiling (7072 x 7071)', 7072, 7071, /pixel limit/i],
    ['one very long edge (1,000,000 x 60)', 1_000_000, 60, /pixel limit/i],
  ])('refuses a tiny PNG that claims %s pixels from its header, at once', async (_name, w, h, cause) => {
    const bomb = pngClaiming(w, h);
    expect(bomb.length).toBeLessThan(1024);
    expect(w * h).toBeGreaterThan(MAX_INPUT_PIXELS);
    const started = Date.now();
    const refused = await toCleanJpeg(bomb).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(2_000); // refused from the header: no pixels were allocated
    expect(refused).toBeInstanceOf(UnreadableImageError);
    expect(String((refused as Error).cause ?? '')).toMatch(cause); // the ceiling refused it, not a broken body
  });

  it('refuses a decompression bomb (more than 50 MP)', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(toCleanJpeg(bomb)).rejects.toBeInstanceOf(UnreadableImageError);
  });
});

describe('decode slots (toCleanJpeg through the instance gate)', () => {
  it('six photos at once: never more than 2 decoding, and every one re-encoded', async () => {
    const run = decodeGate.run.bind(decodeGate);
    let live = 0;
    let peak = 0;
    const spy = vi.spyOn(decodeGate, 'run').mockImplementation((work) =>
      run(async () => {
        peak = Math.max(peak, ++live);
        try {
          return await work();
        } finally {
          live--;
        }
      }),
    );
    try {
      const inputs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => png(400 + i, 300)));
      const outs = await Promise.all(inputs.map((b) => toCleanJpeg(b)));
      expect(outs.map((o) => o.width)).toEqual([400, 401, 402, 403, 404, 405]);
      expect(spy).toHaveBeenCalledTimes(6);
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(2);
      expect([decodeGate.running, decodeGate.waiting]).toEqual([0, 0]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a file refused by its leading bytes or header never takes a slot', async () => {
    const spy = vi.spyOn(decodeGate, 'run');
    try {
      await expect(toCleanJpeg(Buffer.from('not an image'))).rejects.toBeInstanceOf(UnreadableImageError);
      const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
        .gif()
        .toBuffer();
      await expect(toCleanJpeg(gif)).rejects.toBeInstanceOf(UnreadableImageError);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isHeif', () => {
  it.each([
    ['heic', true],
    ['mif1', true],
    ['avif', false],
    ['isom', false],
  ])('brand %s → %s', (brand, want) => {
    const b = Buffer.alloc(16);
    b.write('ftyp', 4, 'latin1');
    b.write(brand, 8, 'latin1');
    expect(isHeif(b)).toBe(want);
  });
  it('needs the ftyp box', () => expect(isHeif(Buffer.from('xxxxheicxxxx'))).toBe(false));
});
