// tests/fixtures/images.ts — test photos made at runtime (no binary fixtures besides the HEIC).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const HEIC = () => readFileSync(path.join(__dirname, 'photos/iphone-like.heic'));

/** A JPEG carrying GPS + camera EXIF and orientation 6 (stored landscape, shown portrait). */
export async function jpegWithGps(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#c05030' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({
      IFD0: { Make: 'Apple', Model: 'iPhone 15' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '49/1 17/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '123/1 7/1 0/1',
      },
    })
    .toBuffer();
}

export async function png(width = 300, height = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: '#2060a0' } })
    .png()
    .toBuffer();
}

/** Random noise barely compresses, so a 4000×3000 q100 JPEG lands at roughly the requested size. */
export async function noisyJpeg(targetBytes: number): Promise<Buffer> {
  const width = 4000;
  const height = Math.ceil(targetBytes / (width * 3 * 0.33));
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

/** True when any metadata survived: an EXIF (GPS lives in it), XMP, ICC or IPTC segment, or an EXIF header. */
export async function hasMetadata(jpeg: Buffer): Promise<boolean> {
  const m = await sharp(jpeg).metadata();
  return Boolean(m.exif || m.xmp || m.icc || m.iptc) || jpeg.includes('Exif\0\0');
}

/** The GPS IFD pointer (tag 0x8825) inside an EXIF block, in either byte order. */
export function exifHasGps(exif: Buffer | undefined): boolean {
  return Boolean(
    exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88]))),
  );
}
