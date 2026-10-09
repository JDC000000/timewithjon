// pr38 F1/F2 + the HEIC deadline: the HEIC decode runs in a worker (heic-worker.ts) with stand-in decoders
// (tests/fixtures/heic-decoders). Every top-level image is measured from the container before any pixels are decoded,
// the decoded RGBA goes straight to sharp, and a decode that never finishes is refused inside the budget.
// (The real heic-decode on a real iPhone HEIC: reencode.test.ts.)
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { HEIC } from '../../../../tests/fixtures/images';
import { heicWorkerForTests, toCleanJpeg, UnreadableImageError } from '../reencode';

const decoder = (name: string) => path.join(process.cwd(), 'tests/fixtures/heic-decoders', `${name}.cjs`);
const use = (name: string, budgetMs?: number) => {
  heicWorkerForTests.modulePath = decoder(name);
  heicWorkerForTests.budgetMs = budgetMs;
};
afterEach(() => {
  heicWorkerForTests.modulePath = undefined;
  heicWorkerForTests.budgetMs = undefined;
});

describe('HEIC path (in a worker)', () => {
  it('refuses when ANY image is over 50 MP, without decoding one', async () => {
    use('any-too-big');
    // a decode would answer "could not be converted": this message proves none ran
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC too large or unreadable');
  });

  it('refuses when the first image alone is over 50 MP', async () => {
    use('first-too-big');
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC too large or unreadable');
  });

  it('refuses a HEIC with no image', async () => {
    use('none');
    await expect(toCleanJpeg(HEIC())).rejects.toBeInstanceOf(UnreadableImageError);
  });

  it('encodes the decoded RGBA directly (no JPEG round trip)', async () => {
    use('ok');
    const out = await toCleanJpeg(HEIC());
    expect([out.width, out.height]).toEqual([40, 30]);
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
  });

  it('a decode failure is unreadable', async () => {
    use('decode-fails');
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC could not be converted');
  });
});

describe('HEIC deadline: a slow file answers within the budget', () => {
  it('a decoder that blocks its thread (sync, never returns) is stopped: unreadable, on time', async () => {
    use('hangs-sync', 1500);
    const t0 = Date.now();
    await expect(toCleanJpeg(HEIC())).rejects.toThrow('HEIC took too long');
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15_000);

  it('a pixel decode that never finishes is stopped the same way', async () => {
    use('decode-hangs', 1500);
    const t0 = Date.now();
    const err = await toCleanJpeg(HEIC()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnreadableImageError);
    expect((err as Error).message).toBe('HEIC took too long');
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 15_000);

  it('the real decoder converts a real HEIC well inside the default budget', async () => {
    const t0 = Date.now();
    const out = await toCleanJpeg(HEIC());
    expect((await sharp(out.data).metadata()).format).toBe('jpeg');
    expect(Date.now() - t0).toBeLessThan(30_000);
  }, 40_000);
});
