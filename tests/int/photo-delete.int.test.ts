// T3.16.05 + the cross-lane storage-delete helper (L2c #47): a deleted story's objects leave BOTH stores
// (Supabase final/ + incoming/, and each final photo's R2 twin); the operator's sweep removes only true orphans
// older than an hour, and a dry run removes nothing.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { photoObjectsOf, removePhotoObjects } from '@/features/photos/delete';
import { signPhotoUpload } from '@/features/photos/sign';
import { finalisePhotoUpload } from '@/features/photos/finalise';
import { SWEEP_MIN_AGE_MS, SweepRefusedError, sweepOrphanPhotos } from '@/features/photos/sweep';
import { r2KeyOf } from '@/lib/adapters/photos';
import {
  createMemoryBackup,
  createMemoryStore,
  type MemoryBackup,
  type MemoryStore,
} from '@/lib/adapters/mock/object-store';
import { png } from '../fixtures/images';

const report = vi.hoisted(() => vi.fn());
vi.mock('@/lib/report', async (orig) => ({ ...(await orig<typeof import('@/lib/report')>()), report }));

const tag = `int-photo-delete-${randomUUID().slice(0, 8)}`;
let store: MemoryStore;
let backup: MemoryBackup;
beforeEach(() => {
  store = createMemoryStore();
  backup = createMemoryBackup();
  report.mockClear();
});
afterAll(async () => {
  await q(`delete from story where body like $1`, [`${tag}%`]);
  await pool().end();
});

async function newStory(): Promise<string> {
  const rows = await q<{ id: string }>(
    `insert into story (source, from_name, from_email, body, consent, consent_needs_jon)
     values ('email_in', 'Ro', 'ro@example.com', $1, false, true) returning id`,
    [`${tag} story`],
  );
  return rows[0]!.id;
}
/** A finalised photo with its R2 twin; returns its final/ path. */
async function photo(storyId: string): Promise<string> {
  const s = await signPhotoUpload(storyId, store);
  if (!s.ok) throw new Error(s.code);
  store.put(s.path, await png(), 'image/png');
  const out = await finalisePhotoUpload(s.uploadId, storyId, store);
  if (!out.ok) throw new Error(out.code);
  const [p] = await q<{ storage_path: string }>(`select storage_path from photo where id = $1`, [
    out.photoId,
  ]);
  await backup.put(r2KeyOf(p!.storage_path), Buffer.from('x'), 'image/jpeg');
  return p!.storage_path;
}
async function pendingUpload(storyId: string): Promise<string> {
  const s = await signPhotoUpload(storyId, store);
  if (!s.ok) throw new Error(s.code);
  store.put(s.path, await png(), 'image/png');
  return s.path;
}

describe('the storage-delete helper (photoObjectsOf + removePhotoObjects)', () => {
  it("collects only these stories' objects, inside the delete tx, and removes them from both stores", async () => {
    const doomed = await newStory();
    const kept = await newStory();
    const doomedFinal = await photo(doomed);
    const doomedRaw = await pendingUpload(doomed);
    const keptFinal = await photo(kept);
    const objs = await withTx(async (c) => {
      const o = await photoObjectsOf([doomed], c);
      await c.query(`delete from story where id = $1`, [doomed]);
      return o;
    });
    expect(objs.final).toEqual([doomedFinal]);
    expect(objs.incoming).toHaveLength(2); // the finalised upload's path (already gone) + the pending one
    expect(objs.incoming).toContain(doomedRaw);
    expect(await removePhotoObjects(objs, { store, backup })).toBe(true);
    expect(store.objects.has(doomedFinal)).toBe(false);
    expect(store.objects.has(doomedRaw)).toBe(false);
    expect(backup.objects.has(r2KeyOf(doomedFinal))).toBe(false);
    expect(store.objects.has(keptFinal)).toBe(true);
    expect(backup.objects.has(r2KeyOf(keptFinal))).toBe(true);
    expect(report).not.toHaveBeenCalled();
  });

  it('a story with no photos gives empty lists', async () => {
    const id = await newStory();
    expect(await withTx((c) => photoObjectsOf([id], c))).toEqual({ final: [], incoming: [] });
  });

  it('a failing store is reported and the R2 twins still go (and the reverse); false = left for the sweep', async () => {
    const id = await newStory();
    const final = await photo(id);
    const objs = await withTx((c) => photoObjectsOf([id], c));
    const brokenStore = { ...store, remove: vi.fn(async () => Promise.reject(new Error('down'))) };
    expect(await removePhotoObjects(objs, { store: brokenStore, backup })).toBe(false);
    expect(backup.objects.has(r2KeyOf(final))).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.any(Error), { area: 'photos', step: 'delete_objects' });

    await backup.put(r2KeyOf(final), Buffer.from('x'), 'image/jpeg');
    report.mockClear();
    const brokenBackup = { ...backup, remove: vi.fn(async () => Promise.reject(new Error('down'))) };
    expect(await removePhotoObjects(objs, { store, backup: brokenBackup })).toBe(false);
    expect(store.objects.has(final)).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.any(Error), { area: 'photos', step: 'delete_r2' });
  });
});

describe('the operator sweep (T3.16.05)', () => {
  const now = new Date();
  const old = new Date(now.getTime() - SWEEP_MIN_AGE_MS - 60_000);
  const young = new Date(now.getTime() - SWEEP_MIN_AGE_MS + 60_000);
  const photoPaths = async () =>
    (await q<{ storage_path: string }>(`select storage_path from photo`)).map((r) => r.storage_path);
  /** Seeds an object in both stores with the given age. */
  function seed(path: string, at: Date) {
    store.put(path, Buffer.from('x'), 'image/jpeg', at);
    backup.objects.set(r2KeyOf(path), Buffer.from('x'));
    backup.writtenAt.set(r2KeyOf(path), at);
  }

  it('removes only old orphans from both stores; referenced and young objects stay; the dry run removes nothing', async () => {
    const id = await newStory();
    const live = await photo(id);
    store.objects.get(live)!.createdAt = old;
    backup.writtenAt.set(r2KeyOf(live), old);
    const orphan = `final/${randomUUID()}.jpg`;
    const fresh = `final/${randomUUID()}.jpg`;
    seed(orphan, old);
    seed(fresh, young);
    const r2Only = `final/${randomUUID()}.jpg`; // an R2 twin whose Supabase object is already gone
    backup.objects.set(r2KeyOf(r2Only), Buffer.from('x'));
    backup.writtenAt.set(r2KeyOf(r2Only), old);
    store.put('incoming/raw', Buffer.from('x'), 'image/jpeg', old); // the tick's job, not the sweep's

    const dry = await sweepOrphanPhotos({ store, backup, photoPaths, now, apply: false });
    expect(dry).toMatchObject({ orphanFinal: [orphan], applied: false, finalObjects: 2, r2Objects: 3 });
    expect(dry.orphanR2.sort()).toEqual([r2KeyOf(orphan), r2KeyOf(r2Only)].sort());
    expect(store.objects.has(orphan)).toBe(true);
    expect(backup.objects.has(r2KeyOf(r2Only))).toBe(true);

    // over 20% of what it listed: refused without an explicit cap, nothing removed (pr55 F1)
    await expect(sweepOrphanPhotos({ store, backup, photoPaths, now, apply: true })).rejects.toBeInstanceOf(
      SweepRefusedError,
    );
    expect(store.objects.has(orphan)).toBe(true);
    expect(backup.objects.has(r2KeyOf(r2Only))).toBe(true);
    await expect(
      sweepOrphanPhotos({ store, backup, photoPaths, now, apply: true, maxDelete: 1 }),
    ).rejects.toThrow(/2 objects to delete is over --max-delete=1/);

    const done = await sweepOrphanPhotos({ store, backup, photoPaths, now, apply: true, maxDelete: 2 });
    expect(done.applied).toBe(true);
    expect([...store.objects.keys()].sort()).toEqual([fresh, live, 'incoming/raw'].sort());
    expect([...backup.objects.keys()].sort()).toEqual([r2KeyOf(fresh), r2KeyOf(live)].sort());
    const again = await sweepOrphanPhotos({ store, backup, photoPaths, now, apply: true, maxDelete: 2 });
    expect(again).toMatchObject({ orphanFinal: [], orphanR2: [], finalObjects: 1, r2Objects: 1 });
  });
});
