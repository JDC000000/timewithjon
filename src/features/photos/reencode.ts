// src/features/photos/reencode.ts — AD-4: every stored photo is a fresh JPEG. Re-encoding drops ALL metadata
// (EXIF, GPS, XMP, IPTC, ICC); rotate() first bakes the EXIF orientation into the pixels; C-5: 3000 px long edge.
import 'server-only';
import sharp from 'sharp';
import { decodeGate } from './decode-gate';
import { decodeHeicInWorker, HeicRefusedError } from './heic-worker';
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
/**
 * The whole HEIC conversion (decode in a worker + encode) answers within this, slow file or not: with a decode slot's
 * wait (DECODE_WAIT_MS, 15 s) it still fits finalise's 60 s maxDuration. A 12 MP iPhone photo takes a few seconds.
 */
export const HEIC_BUDGET_MS = 30_000;
/** Tests only: the decoder module the HEIC worker loads, and its budget. */
export const heicWorkerForTests: { modulePath?: string; budgetMs?: number } = {};

type RawPixels = { width: number; height: number; channels: 4 };

async function encode(
  input: Buffer,
  raw?: RawPixels,
  timeoutSeconds = ENCODE_TIMEOUT_SECONDS,
): Promise<CleanJpeg> {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, ...(raw && { raw }) })
    .rotate()
    .resize({ width: MAX_LONG_EDGE_PX, height: MAX_LONG_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .timeout({ seconds: timeoutSeconds })
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

/**
 * sharp's bundled libheif reads HEIC headers but can't decode HEVC pixels, so heic-decode (libheif-js) does, in a
 * worker with a hard deadline (heic-worker.ts). pr38 F1: the size of EVERY image in the container is checked before
 * any pixels are decoded. pr38 F2: the raw RGBA goes straight to sharp (no pure-JS JPEG round trip). The encode gets
 * what is left of the budget, so the whole conversion answers within HEIC_BUDGET_MS.
 */
async function heicToCleanJpeg(raw: Buffer): Promise<CleanJpeg> {
  const budgetMs = heicWorkerForTests.budgetMs ?? HEIC_BUDGET_MS;
  const started = Date.now();
  const { data, width, height } = await decodeHeicInWorker(raw, {
    deadlineMs: budgetMs,
    maxPixels: MAX_INPUT_PIXELS,
    modulePath: heicWorkerForTests.modulePath,
  }).catch((e: unknown) => {
    throw new UnreadableImageError(e instanceof HeicRefusedError ? e.message : 'HEIC unreadable', {
      cause: e,
    });
  });
  const leftSeconds = Math.max(1, Math.ceil((started + budgetMs - Date.now()) / 1000));
  try {
    return await encode(
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
      { width, height, channels: 4 },
      Math.min(ENCODE_TIMEOUT_SECONDS, leftSeconds),
    );
  } catch (e) {
    throw new UnreadableImageError('HEIC could not be converted', { cause: e });
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
  // The pixel work holds a decode slot (decode-gate.ts); it throws DecodeBusyError if none frees up in time.
  return decodeGate.run(async () => {
    try {
      return await encode(raw);
    } catch (sharpError) {
      if (meta.format !== 'heif' || !isHeif(raw)) {
        throw new UnreadableImageError('not a readable image', { cause: sharpError });
      }
      return heicToCleanJpeg(raw);
    }
  });
}
