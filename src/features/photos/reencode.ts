// src/features/photos/reencode.ts — AD-4: every stored photo is a fresh JPEG. Re-encoding drops ALL metadata
// (EXIF, GPS, XMP, IPTC, ICC); rotate() first bakes the EXIF orientation into the pixels; C-5: 3000 px long edge.
import 'server-only';
import sharp from 'sharp';
import heicDecode from 'heic-decode';
import { MAX_INPUT_PIXELS, MAX_LONG_EDGE_PX } from './limits';

export class UnreadableImageError extends Error {
  override name = 'UnreadableImageError';
}
export interface CleanJpeg {
  data: Buffer;
  width: number;
  height: number;
}

/** What a phone or camera sends (the bucket's MIME list). Anything else sharp could read (SVG, TIFF, GIF…) is refused. */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);
export type AcceptedFormat = 'jpeg' | 'png' | 'webp' | 'heif';
/** A pathological image can't hold a function (finalise maxDuration 60 s, the media job's 90 s budget). */
export const ENCODE_TIMEOUT_SECONDS = 40;

type RawPixels = { width: number; height: number; channels: 4 };

async function encode(input: Buffer, raw?: RawPixels): Promise<CleanJpeg> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, ...(raw && { raw }) })
    .rotate()
    .resize({ width: MAX_LONG_EDGE_PX, height: MAX_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .timeout({ seconds: ENCODE_TIMEOUT_SECONDS })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The ISO-BMFF `ftyp` brands an iPhone HEIC/HEIF carries. */
export function isHeif(b: Buffer): boolean {
  return (
    b.length >= 12 &&
    b.toString('latin1', 4, 8) === 'ftyp' &&
    /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)$/.test(b.toString('latin1', 8, 12))
  );
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** ISO-BMFF brands of HEIC/HEIF (iPhone) and AVIF stills; sharp reads all of them as `heif`. */
const HEIF_FAMILY_BRANDS = /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis|avif|avis)$/;

/**
 * The accepted format the leading bytes announce, or null. Checked before ANY decoder sees the bytes, so a document
 * (SVG, HTML, PDF…) or another container never reaches sharp or heic-decode, whatever content-type it was
 * uploaded with. An ISO-BMFF file passes when its major brand or one of its compatible brands is a HEIF/AVIF one.
 */
export function sniffFormat(b: Buffer): AcceptedFormat | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')
    return 'webp';
  if (b.length >= 16 && b.toString('latin1', 4, 8) === 'ftyp') {
    const boxEnd = Math.min(b.readUInt32BE(0), b.length);
    const brands = [b.toString('latin1', 8, 12)];
    for (let at = 16; at + 4 <= boxEnd; at += 4) brands.push(b.toString('latin1', at, at + 4));
    if (brands.some((brand) => HEIF_FAMILY_BRANDS.test(brand))) return 'heif';
  }
  return null;
}

const tooBig = (w: number, h: number) => !w || !h || w * h > MAX_INPUT_PIXELS;

/**
 * sharp's bundled libheif reads HEIC headers but can't decode HEVC pixels, so heic-decode (libheif-js) does.
 * pr38 F1: it decodes the FIRST top-level image, which needn't be the primary sharp measured, so the size of
 * EVERY image is checked from the container before any pixels are allocated. pr38 F2: the raw RGBA goes
 * straight to sharp (no pure-JS JPEG round trip).
 */
async function heicToCleanJpeg(raw: Buffer): Promise<CleanJpeg> {
  const images = await heicDecode.all({ buffer: raw }).catch((e: unknown) => {
    throw new UnreadableImageError('HEIC unreadable', { cause: e });
  });
  try {
    if (!images.length || images.some((i) => tooBig(i.width, i.height))) {
      throw new UnreadableImageError('HEIC too large or unreadable');
    }
    const { data, width, height } = await images[0]!.decode();
    if (tooBig(width, height)) throw new UnreadableImageError('HEIC too large');
    return await encode(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      width,
      height,
      channels: 4,
    });
  } catch (e) {
    if (e instanceof UnreadableImageError) throw e;
    throw new UnreadableImageError('HEIC could not be converted', { cause: e });
  } finally {
    images.dispose();
  }
}

export async function toCleanJpeg(raw: Buffer): Promise<CleanJpeg> {
  // The leading bytes first: nothing but an accepted raster format reaches a decoder, not even its header reader.
  const sniffed = sniffFormat(raw);
  if (!sniffed) throw new UnreadableImageError('not an accepted image');
  const meta = await sharp(raw) // header only; every decode below carries the pixel ceiling
    .metadata()
    .catch(() => null);
  if (!meta?.format || !ACCEPTED_FORMATS.has(meta.format) || meta.format !== sniffed)
    throw new UnreadableImageError('not an accepted image');
  try {
    return await encode(raw);
  } catch (sharpError) {
    if (meta.format !== 'heif' || !isHeif(raw)) {
      throw new UnreadableImageError('not a readable image', { cause: sharpError });
    }
    return heicToCleanJpeg(raw);
  }
}
