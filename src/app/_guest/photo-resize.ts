// src/app/_guest/photo-resize.ts — T3.6.U1: shrink a photo on the phone before it goes up (technical-scope C7):
// 3000 px on the long edge, JPEG quality 0.88 (C-5: that is also the export's "full resolution"). Never upscales.
// A file the browser can't decode (HEIC on most browsers) or can't re-encode goes up as picked: finalise converts
// HEIC and re-encodes everything server-side (AD-4), and the bucket takes up to 20 MB.

export const LONG_EDGE = 3000;
export const JPEG_QUALITY = 0.88;

/** The size to draw at: the long edge capped at `max`, the aspect kept, never larger than the source. */
export function fitLongEdge(
  width: number,
  height: number,
  max = LONG_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max || long <= 0) return { width, height };
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * The file to upload: a JPEG re-drawn at `fitLongEdge` when the photo is larger than 3000 px, else the original.
 * Decoding applies the EXIF orientation, so the pixels come out upright once the canvas drops the EXIF.
 */
export async function resizeForUpload(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // not decodable here (HEIC): the server converts it
  }
  try {
    const size = fitLongEdge(bmp.width, bmp.height);
    if (size.width === bmp.width && size.height === bmp.height) return file;
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, size.width, size.height);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    return out ?? file;
  } finally {
    bmp.close();
  }
}
