// T3.16.05: the photos bucket's listing follows every page (the sweep must see all of final/, not the first 1000).
import { describe, expect, it, vi } from 'vitest';

const list = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() =>
  vi.fn<(paths: string[]) => Promise<{ error: null }>>(async () => ({ error: null })),
);
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { from: () => ({ list, remove }) } }),
}));
vi.mock('@/config/env', () => ({
  getEnv: () => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }),
}));
const { createSupabasePhotoStore } = await import('@/lib/adapters/supabase-storage');
const { supabaseExportStore } = await import('@/lib/adapters/supabase-exports');

const obj = (name: string, created: string) => ({ id: name, name, created_at: created });

describe('createSupabasePhotoStore().listCreatedBefore', () => {
  it('pages by 1000 until a short page, keeping objects created before the cutoff', async () => {
    const old = '2026-01-01T00:00:00Z';
    const page1 = Array.from({ length: 1000 }, (_, i) => obj(`${i}.jpg`, old));
    const page2 = [obj('late.jpg', '2027-06-01T00:00:00Z'), obj('last.jpg', old), { id: null, name: 'dir' }];
    list
      .mockResolvedValueOnce({ data: page1, error: null })
      .mockResolvedValueOnce({ data: page2, error: null });
    const out = await createSupabasePhotoStore('https://x.supabase.co', 'k').listCreatedBefore(
      'final',
      new Date('2027-01-01T00:00:00Z'),
    );
    expect(out).toHaveLength(1001);
    expect(out.at(-1)).toBe('final/last.jpg');
    expect(list.mock.calls.map(([, o]) => (o as { offset: number }).offset)).toEqual([0, 1000]);
  });
});

describe('createSupabasePhotoStore().remove (pr55 F6)', () => {
  it('deletes in calls of at most 1000 paths', async () => {
    const paths = Array.from({ length: 2001 }, (_, i) => `final/${i}.jpg`);
    await createSupabasePhotoStore('https://x.supabase.co', 'k').remove(paths);
    expect(remove.mock.calls.map(([p]) => p.length)).toEqual([1000, 1000, 1]);
  });
});

describe('removeAll edges (pr60-verify N-F)', () => {
  it('exactly 1000 is one call; 1001 is two', async () => {
    const store = createSupabasePhotoStore('https://x.supabase.co', 'k');
    remove.mockClear();
    await store.remove(Array.from({ length: 1000 }, (_, i) => `final/${i}.jpg`));
    expect(remove.mock.calls.map(([p]) => p.length)).toEqual([1000]);
    remove.mockClear();
    await store.remove(Array.from({ length: 1001 }, (_, i) => `final/${i}.jpg`));
    expect(remove.mock.calls.map(([p]) => p.length)).toEqual([1000, 1]);
  });
  it('a failed batch rejects and stops (no later batch)', async () => {
    remove.mockClear();
    remove
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { statusCode: '500' } } as unknown as { error: null });
    await expect(
      supabaseExportStore().remove(Array.from({ length: 2001 }, (_, i) => `zips/${i}.zip`)),
    ).rejects.toMatchObject({ name: 'StorageError', op: 'remove', status: 500 });
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('supabaseExportStore().remove (pr55-verify N-B)', () => {
  it('deletes stale zips in calls of at most 1000 paths', async () => {
    remove.mockClear();
    await supabaseExportStore().remove(Array.from({ length: 2001 }, (_, i) => `zips/${i}.zip`));
    expect(remove.mock.calls.map(([p]) => p.length)).toEqual([1000, 1000, 1]);
  });
  it('nothing to delete → no call', async () => {
    remove.mockClear();
    await supabaseExportStore().remove([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
