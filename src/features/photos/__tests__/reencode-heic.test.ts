// pr38 F1/F2: every top-level image in a HEIC is measured from the container before any pixels are decoded
// (heic-decode decodes images[0], which needn't be the primary), and the decoded RGBA goes straight to sharp.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { HEIC } from '../../../../tests/fixtures/images';

const h = vi.hoisted(() => ({
  images: [] as { width: number; height: number; decode: () => unknown }[],
  dispose: vi.fn(),
}));
vi.mock('heic-decode', () => ({
  default: { all: vi.fn(async () => Object.assign([...h.images], { dispose: h.dispose })) },
}));
const { toCleanJpeg, UnreadableImageError } = await import('../reencode');

const rgba = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(200),
});
const image = (width: number, height: number) => ({
  width,
  height,
  decode: vi.fn(async () => rgba(width, height)),
});

describe('HEIC path', () => {
  beforeEach(() => {
    h.dispose.mockClear();
  });

  it('refuses when ANY image is over 50 MP, without decoding one, and frees the decoder', async () => {
    const small = image(1000, 800);
    const huge = image(10_000, 6_000);
    h.images = [small, huge];
    await expect(toCleanJpeg(HEIC())).rejects.toBeInstanceOf(UnreadableImageError);
    expect(small.decode).not.toHaveBeenCalled();
    expect(huge.decode).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it('refuses when the first image alone is over 50 MP', async () => {
    const huge = image(8_000, 7_000);
    h.images = [huge, image(100, 100)];
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC too large or unreadable');
    expect(huge.decode).not.toHaveBeenCalled();
  });

  it('refuses a HEIC with no image', async () => {
    h.images = [];
    await expect(toCleanJpeg(HEIC())).rejects.toBeInstanceOf(UnreadableImageError);
  });

  it('encodes the decoded RGBA directly (no JPEG round trip) and frees the decoder', async () => {
    const first = image(40, 30);
    h.images = [first, image(40, 30)];
    const out = await toCleanJpeg(HEIC());
    expect(first.decode).toHaveBeenCalledOnce();
    expect([out.width, out.height]).toEqual([40, 30]);
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
    expect(h.dispose).toHaveBeenCalledOnce();
  });

  it('a decode failure is unreadable and still frees the decoder', async () => {
    h.images = [
      {
        width: 10,
        height: 10,
        decode: vi.fn(async () => Promise.reject(new Error('HEIF processing error'))),
      },
    ];
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC could not be converted');
    expect(h.dispose).toHaveBeenCalledOnce();
  });
});
