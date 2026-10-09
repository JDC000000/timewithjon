// The leading-bytes check runs before any decoder: a document or another container sent as a photo (whatever its
// content-type) is refused without sharp or heic-decode ever seeing its bytes. Both are replaced here by stubs that
// fail the test if they are reached.
import { describe, expect, it, vi } from 'vitest';

const reached = vi.hoisted(() => ({ sharp: 0, heic: 0 }));
vi.mock('sharp', () => ({
  default: () => {
    reached.sharp++;
    throw new Error('sharp was reached');
  },
}));
vi.mock('heic-decode', () => ({
  default: {
    all: () => {
      reached.heic++;
      throw new Error('heic-decode was reached');
    },
  },
}));

const { sniffFormat, toCleanJpeg, UnreadableImageError } = await import('../reencode');

const ftyp = (major: string, compatible: string[] = []) => {
  const b = Buffer.alloc(16 + 4 * compatible.length + 16);
  b.writeUInt32BE(16 + 4 * compatible.length, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(major, 8, 'latin1');
  compatible.forEach((c, i) => b.write(c, 16 + 4 * i, 'latin1'));
  return b;
};

const NOT_PHOTOS: [string, Buffer][] = [
  ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>')],
  [
    'an SVG with an XML prolog',
    Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
  ],
  ['an SVG after a byte-order mark', Buffer.from('﻿<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ['an SVG after whitespace', Buffer.from('   \n<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ['a gzipped SVG', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0, 0x03])],
  ['an HTML page', Buffer.from('<!doctype html><html><body><p>Not a photo</p></body></html>')],
  ['a PDF', Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n')],
  ['a GIF', Buffer.from('GIF89a\x14\x00\x14\x00', 'latin1')],
  ['a TIFF', Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0, 0, 0])],
  ['a BMP', Buffer.from('BM\x00\x00\x00\x00', 'latin1')],
  ['a RIFF that is not WebP (WAV)', Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')],
  ['an MP4', ftyp('isom', ['iso2', 'mp41'])],
  ['a QuickTime movie', ftyp('qt  ')],
  ['a JPEG 2000', ftyp('jp2 ')],
  ['a truncated JPEG marker', Buffer.from([0xff, 0xd8])],
  ['an empty file', Buffer.alloc(0)],
  ['text', Buffer.from('definitely not a photo')],
];

describe('the leading-bytes check (before any decoder)', () => {
  it.each(NOT_PHOTOS)('%s is refused without reaching sharp or heic-decode', async (_name, body) => {
    expect(sniffFormat(body)).toBeNull();
    await expect(toCleanJpeg(body)).rejects.toBeInstanceOf(UnreadableImageError);
    await expect(toCleanJpeg(body)).rejects.toThrow('not an accepted image');
    expect(reached).toEqual({ sharp: 0, heic: 0 });
  });

  it.each([
    ['JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'jpeg'],
    ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]), 'png'],
    ['WebP', Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1'), 'webp'],
    ['an iPhone HEIC', ftyp('heic', ['mif1', 'heic']), 'heif'],
    ['a HEIF that names HEIC only as a compatible brand', ftyp('mif1', ['heic', 'hevc']), 'heif'],
    ['an AVIF', ftyp('avif', ['mif1', 'avif', 'miaf']), 'heif'],
  ])('%s passes to the decoder', (_name, head, want) => {
    expect(sniffFormat(head)).toBe(want);
  });

  it('reads compatible brands only inside the ftyp box', () => {
    const b = ftyp('isom');
    b.write('heic', 20, 'latin1'); // past the box's own length (16)
    expect(sniffFormat(b)).toBeNull();
  });
});
