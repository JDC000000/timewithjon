// T3.6.U1 AC1: the phone-side resize — 3000 px on the long edge, JPEG 0.88 (technical-scope C7), never upscaled.
import { describe, expect, it } from 'vitest';
import { JPEG_QUALITY, LONG_EDGE, fitLongEdge, resizeForUpload } from '../photo-resize';

describe('fitLongEdge', () => {
  it('uses the technical-scope figures', () => {
    expect(LONG_EDGE).toBe(3000);
    expect(JPEG_QUALITY).toBe(0.88);
  });
  it('caps the long edge at 3000 and keeps the aspect (landscape and portrait)', () => {
    expect(fitLongEdge(4032, 3024)).toEqual({ width: 3000, height: 2250 });
    expect(fitLongEdge(3024, 4032)).toEqual({ width: 2250, height: 3000 });
    expect(fitLongEdge(12000, 1000)).toEqual({ width: 3000, height: 250 });
  });
  it('never upscales a photo already within 3000 px', () => {
    expect(fitLongEdge(3000, 2000)).toEqual({ width: 3000, height: 2000 });
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('never rounds a thin side to 0', () => {
    expect(fitLongEdge(90000, 2)).toEqual({ width: 3000, height: 1 });
  });
});

describe('resizeForUpload', () => {
  it('sends the file as picked where the runtime cannot decode it (no canvas / HEIC)', async () => {
    const f = new File(['x'], 'a.heic', { type: 'image/heic' });
    expect(await resizeForUpload(f)).toBe(f);
  });
});
