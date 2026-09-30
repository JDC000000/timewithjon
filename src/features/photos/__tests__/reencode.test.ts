// T3.6.03/.08 (AC2): every stored photo is a clean JPEG: no EXIF, no GPS; HEIC and PNG are converted;
// orientation is baked in; C-5 caps the long edge at 3000 px.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  exifHasGps,
  hasMetadata,
  HEIC,
  jpegWithGps,
  noisyJpeg,
  png,
} from '../../../../tests/fixtures/images';
import { isHeif, toCleanJpeg, UnreadableImageError } from '../reencode';

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

  it('refuses a decompression bomb (more than 50 MP)', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 7000, channels: 3, background: '#000' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(toCleanJpeg(bomb)).rejects.toBeInstanceOf(UnreadableImageError);
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
