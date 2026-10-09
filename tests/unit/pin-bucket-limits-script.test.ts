// ops/pin-bucket-limits.ts against a stand-in Storage API: a dry run reads and changes nothing, --apply sets every
// differing bucket to ops/bucket-limits.ts and reads it back, and a bucket that still differs exits 1.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUCKET_LIMITS } from '../../ops/bucket-limits';

type Row = { public: boolean; file_size_limit?: number | null; allowed_mime_types?: string[] | null };
const api = vi.hoisted(() => ({
  buckets: {} as Record<string, Row>,
  ignoreUpdates: false,
  update: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      getBucket: async (name: string) =>
        api.buckets[name]
          ? { data: { ...api.buckets[name] }, error: null }
          : { data: null, error: { name: 'StorageApiError' } },
      updateBucket: async (
        name: string,
        o: { public: boolean; fileSizeLimit: number; allowedMimeTypes: string[] },
      ) => {
        api.update(name, o);
        if (!api.ignoreUpdates)
          api.buckets[name] = {
            public: o.public,
            file_size_limit: o.fileSizeLimit,
            allowed_mime_types: o.allowedMimeTypes,
          };
        return { data: { message: 'ok' }, error: null };
      },
    },
  }),
}));

const pinned = (name: keyof typeof BUCKET_LIMITS): Row => ({
  public: false,
  file_size_limit: BUCKET_LIMITS[name].fileSizeLimit,
  allowed_mime_types: [...BUCKET_LIMITS[name].allowedMimeTypes].reverse(), // order doesn't matter
});
const argv = process.argv;
const saved = { ...process.env };
beforeEach(() => {
  api.update.mockClear();
  api.ignoreUpdates = false;
  process.exitCode = undefined;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  process.argv = argv;
  process.env = { ...saved };
  process.exitCode = undefined;
  vi.restoreAllMocks();
});
async function run(args: string[] = []) {
  vi.resetModules();
  process.argv = ['node', 'ops/pin-bucket-limits.ts', ...args];
  Object.assign(process.env, {
    SUPABASE_URL: 'https://projectref.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
  });
  await import('../../ops/pin-bucket-limits');
  return process.exitCode;
}

describe('ops/pin-bucket-limits.ts', () => {
  it('already pinned: nothing to change, exit 0', async () => {
    api.buckets = { photos: pinned('photos'), exports: pinned('exports') };
    expect(await run(['--apply'])).toBe(0);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('a dry run lists the differences, changes nothing and exits 1', async () => {
    api.buckets = {
      photos: { public: false, file_size_limit: null, allowed_mime_types: null },
      exports: pinned('exports'),
    };
    expect(await run()).toBe(1);
    expect(api.update).not.toHaveBeenCalled();
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toMatch(
      /DIFF {2}photos: file_size_limit null -> 20971520/,
    );
  });

  it('--apply sets each differing bucket and reads it back: exit 0', async () => {
    api.buckets = {
      photos: { public: true, file_size_limit: 50 * 1024 * 1024, allowed_mime_types: ['image/*'] },
      exports: { public: false },
    };
    expect(await run(['--apply'])).toBe(0);
    expect(api.update).toHaveBeenCalledTimes(2);
    expect(api.update).toHaveBeenCalledWith('photos', {
      public: false,
      fileSizeLimit: 20 * 1024 * 1024,
      allowedMimeTypes: [...BUCKET_LIMITS.photos.allowedMimeTypes],
    });
    expect(api.buckets.exports).toEqual({
      public: false,
      file_size_limit: 50 * 1024 * 1024,
      allowed_mime_types: ['application/zip'],
    });
  });

  it('a bucket that still differs after --apply exits 1', async () => {
    api.buckets = { photos: { public: false }, exports: pinned('exports') };
    api.ignoreUpdates = true;
    expect(await run(['--apply'])).toBe(1);
  });

  it('a missing bucket, or missing settings, fails loudly', async () => {
    api.buckets = { photos: pinned('photos') };
    await expect(run()).rejects.toThrow(/could not read bucket exports/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    vi.resetModules();
    process.argv = ['node', 'ops/pin-bucket-limits.ts'];
    await expect(import('../../ops/pin-bucket-limits')).rejects.toThrow(/are required/);
  });
});
