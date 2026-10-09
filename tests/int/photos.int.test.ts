// T3.6.02–.08 against the real schema with the in-memory bucket: sign (2 per story, AC4), finalise (AC2, AC6,
// idempotent), the media job's R2 copy + attachment_finalise, the incoming purge (AC7), admin thumbnails.
// Regression register: evals/bugs/photo-decodes-uncapped.json
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, q, withTx } from '@/lib/db';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { saveAfterSendStory } from '@/features/photos/after-send';
import { afterSendStoryId, ensureAfterSendStory } from '@/features/photos/story';
import { signPhotoUpload } from '@/features/photos/sign';
import { finalisePhotoUpload } from '@/features/photos/finalise';
import { decodeGate } from '@/features/photos/decode-gate';
import { storyPhotosForAdmin } from '@/features/photos/thumbnails';
import { MEDIA_MAX_ATTEMPTS, runMediaJob } from '@/features/jobs/media';
import { FINALISE_STALE_MS } from '@/features/jobs/media-limits';
import { createMemoryBackup, createMemoryStore, type MemoryStore } from '@/lib/adapters/mock/object-store';
import { prototypePhotoStore } from '@/lib/adapters/mock/object-store';
import { hasMetadata, HEIC, jpegWithGps, noisyJpeg, png } from '../fixtures/images';
import { removeRequests } from '../fixtures/requests-db';
import { NextRequest } from 'next/server';
import type { PoolClient } from 'pg';
import { POST as finaliseRoute } from '@/app/api/photos/finalise/route';
import { POST as signRoute } from '@/app/api/photos/sign/route';
import { FAILED_UPLOADS_PER_PHOTO, MAX_PHOTOS } from '@/features/photos/limits';

const mem = vi.hoisted(() => ({ store: null as unknown as MemoryStore }));
vi.mock('@/lib/adapters/photos', async (orig) => ({
  ...(await orig<typeof import('@/lib/adapters/photos')>()),
  photoStore: () => mem.store,
}));
// A short decode-slot wait, so the "every slot taken" cases answer in a moment (the real wait is 15 s).
vi.mock('@/features/photos/limits', async (orig) => ({
  ...(await orig<typeof import('@/features/photos/limits')>()),
  DECODE_WAIT_MS: 200,
}));
// Counts every sharp() call (the real sharp still runs), so a test can prove some bytes never reached it.
const sharpCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('sharp', async (orig) => {
  const real = (await orig<typeof import('sharp')>()).default;
  const counted = (...args: Parameters<typeof real>) => {
    sharpCalls.n++;
    return real(...args);
  };
  return { default: Object.assign(counted, real) };
});
const dbFault = vi.hoisted(() => ({ failNextTx: false, staleUploadRead: false }));
vi.mock('@/lib/db', async (orig) => {
  const real = await orig<typeof import('@/lib/db')>();
  return {
    ...real,
    // staleUploadRead: finalise's first read of its upload sees it as it was before a racing finalise committed
    q: async (sql: string, params?: unknown[]) => {
      const rows = await real.q(sql, params as never);
      if (dbFault.staleUploadRead && /as refused\s+from photo_upload where id = \$1/.test(sql)) {
        dbFault.staleUploadRead = false;
        return (rows as Record<string, unknown>[]).map((r) => ({ ...r, photo_id: null, refused: false }));
      }
      return rows;
    },
    withTx: <T>(fn: Parameters<typeof real.withTx<T>>[0]) => {
      if (!dbFault.failNextTx) return real.withTx(fn);
      dbFault.failNextTx = false;
      return Promise.reject(new Error('tx failed'));
    },
  };
});
const cap = vi.hoisted(() => ({ requestId: null as string | null }));
vi.mock('@/features/invites/capability', async (orig) => ({
  ...(await orig<typeof import('@/features/invites/capability')>()),
  readStoryCapability: async () => cap.requestId,
}));
const report = vi.hoisted(() => vi.fn());
const reportMessage = vi.hoisted(() => vi.fn<(m: string, t: Record<string, string>) => void>());
vi.mock('@/lib/report', async (orig) => ({
  ...(await orig<typeof import('@/lib/report')>()),
  report,
  reportMessage,
}));

let inviteId = '';
let slotId = '';
beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general'`))[0]!.id;
  slotId = (await q<{ id: string }>(`select id from slot where date = '2027-05-13' limit 1`))[0]!.id;
});
beforeEach(async () => {
  mem.store = createMemoryStore();
  report.mockClear();
  await q(`delete from outbox where kind in ('r2_copy', 'attachment_finalise')`);
});
afterAll(async () => {
  await removeRequests(mine); // HYG: gone for good, so re-runs on one DB don't fill admin's capped Needs a reply tab
  await pool().end();
});

const mine: string[] = [];
async function newRequest(): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Pia',
    email: `pia+${randomUUID().slice(0, 6)}@example.com`,
    crew: 1,
    slotIds: [slotId],
  });
  const a = {
    body,
    inviteId,
    isTest: true,
    spam: false,
    mode: 'slots' as const,
    status: 'requested' as const,
    countsToward: 'weekly_cap' as const,
    dishName: 'The Long Lunch',
  };
  const { requestId } = await withTx((c) => createRequestTx(c, a));
  mine.push(requestId);
  return requestId;
}
const newStory = async () => (await ensureAfterSendStory(await newRequest()))!;
/** Takes every decode slot of this instance until the returned release() is called. */
function holdEveryDecodeSlot(): () => Promise<void> {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const holders = [decodeGate.run(() => held), decodeGate.run(() => held)];
  return async () => {
    release();
    await Promise.all(holders);
  };
}
async function upload(storyId: string, bytes: Buffer, store = mem.store) {
  const s = await signPhotoUpload(storyId, store);
  if (!s.ok) throw new Error(s.code);
  store.put(s.path, bytes, 'image/jpeg');
  return s.uploadId;
}
/** T3.11: every photo_added count so far (all days). */
const photoAdded = async () =>
  Number(
    (
      await q<{ n: number | null }>(`select sum(count)::int as n from event_count where name = 'photo_added'`)
    )[0]!.n ?? 0,
  );
/**
 * A barrier, not a sleep: resolves once `n` finalise transactions wait on photo_upload's row lock. It polls on the
 * lock holder's own connection (the pool's 3 are all taken then) and clears the per-transaction stats snapshot.
 */
async function lockWaiters(holder: PoolClient, n: number) {
  for (let i = 0; i < 200; i++) {
    // pr84 F1: ~2-3 s, well under the test's timeout, so a miss fails with this error, not a timeout
    await holder.query('select pg_stat_clear_snapshot()');
    const w = await holder.query<{ n: number }>(
      `select count(*)::int n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query like '%for update of pu, s%'`,
    );
    if (w.rows[0]!.n === n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`barrier: holder never blocked ${n} finalises on the row lock`);
}
const outbox = () =>
  q<{
    id: string;
    kind: string;
    payload: { photoId?: string };
    attempts: number;
    done_at: Date | null;
    last_error: string | null;
  }>(
    `select id, kind, payload, attempts, done_at, last_error from outbox where kind in ('r2_copy','attachment_finalise') order by created_at`,
  );

describe('the After-Send story (L7)', () => {
  it('is created once and never overwrites the guest text or consent', async () => {
    const requestId = await newRequest();
    expect(await afterSendStoryId(requestId)).toBeNull();
    const saved = await saveAfterSendStory(requestId, { body: 'The halibut', consent: true });
    expect(await ensureAfterSendStory(requestId)).toBe(saved);
    expect(await ensureAfterSendStory(requestId)).toBe(saved);
    const [s] = await q<{ body: string; consent: boolean }>(`select body, consent from story where id = $1`, [
      saved,
    ]);
    expect(s).toEqual({ body: 'The halibut', consent: true });
  });
  it('an unknown request has no story', async () => {
    expect(await ensureAfterSendStory(randomUUID())).toBeNull();
  });
});

describe('sign (T3.6.02)', () => {
  it('binds incoming/<photo_upload.id> to the story and signs exactly that path', async () => {
    const storyId = await newStory();
    const s = await signPhotoUpload(storyId, mem.store);
    expect(s).toMatchObject({ ok: true, path: expect.stringMatching(/^incoming\/[0-9a-f-]{36}$/) });
    if (!s.ok) return;
    expect(s.path).toBe(`incoming/${s.uploadId}`);
    expect(s.signedUrl).toContain(s.path);
    const [row] = await q<{ story_id: string; incoming_path: string }>(
      `select story_id, incoming_path from photo_upload where id = $1`,
      [s.uploadId],
    );
    expect(row).toEqual({ story_id: storyId, incoming_path: s.path });
  });
  it('a 3rd photo on one story is refused, counting uploads still in flight (AC4)', async () => {
    const storyId = await newStory();
    expect((await signPhotoUpload(storyId, mem.store)).ok).toBe(true);
    expect((await signPhotoUpload(storyId, mem.store)).ok).toBe(true);
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many' });
  });
  it('an expired, never-finalised upload frees its place', async () => {
    const storyId = await newStory();
    await signPhotoUpload(storyId, mem.store);
    await signPhotoUpload(storyId, mem.store);
    await q(`update photo_upload set expires_at = now() - interval '1 second' where story_id = $1`, [
      storyId,
    ]);
    expect((await signPhotoUpload(storyId, mem.store)).ok).toBe(true);
  });
  it('an emailed story takes 5 (T3.7.03)', async () => {
    const id = (await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`))[0]!
      .id;
    for (let i = 0; i < 5; i++) expect((await signPhotoUpload(id, mem.store)).ok).toBe(true);
    expect(await signPhotoUpload(id, mem.store)).toEqual({ ok: false, code: 'too_many' });
  });
  it('the prototype stores nothing: not_stored and no row left behind (§5.5)', async () => {
    const storyId = await newStory();
    expect(await signPhotoUpload(storyId, prototypePhotoStore)).toEqual({ ok: false, code: 'not_stored' });
    expect(await q(`select 1 from photo_upload where story_id = $1`, [storyId])).toHaveLength(0);
  });
  it('a Storage error leaves no row behind', async () => {
    const storyId = await newStory();
    const broken = { ...mem.store, createSignedUploadUrl: async () => Promise.reject(new Error('503')) };
    await expect(signPhotoUpload(storyId, broken)).rejects.toThrow('503');
    expect(await q(`select 1 from photo_upload where story_id = $1`, [storyId])).toHaveLength(0);
  });
  it('an unknown story → no_story', async () => {
    expect(await signPhotoUpload(randomUUID(), mem.store)).toEqual({ ok: false, code: 'no_story' });
  });
});

describe('finalise (T3.6.03)', () => {
  it('stores a clean final/<photo.id>.jpg, drops the raw file and queues the R2 copy (AC2)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await jpegWithGps());
    const out = await finalisePhotoUpload(uploadId, storyId, mem.store);
    expect(out).toMatchObject({ ok: true, replay: false });
    if (!out.ok) return;
    const [p] = await q<{
      story_id: string;
      storage_path: string;
      width: number;
      height: number;
      bytes: number;
    }>(`select story_id, storage_path, width, height, bytes from photo where id = $1`, [out.photoId]);
    expect(p).toMatchObject({
      story_id: storyId,
      storage_path: `final/${out.photoId}.jpg`,
      width: 300,
      height: 400,
    });
    const stored = mem.store.objects.get(p!.storage_path)!;
    expect(stored.contentType).toBe('image/jpeg');
    expect(stored.bytes.length).toBe(p!.bytes);
    expect(await hasMetadata(stored.bytes)).toBe(false);
    expect([...mem.store.objects.keys()]).toEqual([p!.storage_path]); // incoming/ is gone
    const [u] = await q<{ finalised_at: Date | null; photo_id: string }>(
      `select finalised_at, photo_id from photo_upload where id = $1`,
      [uploadId],
    );
    expect(u!.finalised_at).not.toBeNull();
    expect(u!.photo_id).toBe(out.photoId);
    expect(await outbox()).toMatchObject([
      { kind: 'r2_copy', payload: { photoId: out.photoId }, done_at: null },
    ]);
  });
  it('HEIC, a 12 MB JPEG and a PNG all finalise (AC1, server side)', async () => {
    const storyId = (
      await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`)
    )[0]!.id;
    for (const bytes of [HEIC(), await noisyJpeg(12 * 1024 * 1024), await png()]) {
      const out = await finalisePhotoUpload(await upload(storyId, bytes), storyId, mem.store);
      expect(out.ok).toBe(true);
    }
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(3);
  }, 60_000);
  it('a WebP and an AVIF finalise too (every format accepted before the leading-bytes check)', async () => {
    const storyId = (
      await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`)
    )[0]!.id;
    const { default: sharp } = await import('sharp');
    const make = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#468' } });
    for (const bytes of [await make().webp().toBuffer(), await make().avif().toBuffer()]) {
      const out = await finalisePhotoUpload(await upload(storyId, bytes), storyId, mem.store);
      expect(out.ok).toBe(true);
    }
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(2);
  });
  it.each([
    ['an SVG', '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle r="9"/></svg>'],
    ['an HTML page', '<!doctype html><html><body><p>Not a photo</p></body></html>'],
  ])('%s stored as image/jpeg is refused and deleted without reaching sharp', async (_name, body) => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, Buffer.from(body)); // upload() stores it as image/jpeg
    sharpCalls.n = 0;
    expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({
      ok: false,
      code: 'unreadable',
    });
    expect(sharpCalls.n).toBe(0);
    expect(mem.store.objects.size).toBe(0);
  });
  it("another story's upload id is refused and left alone (AC6)", async () => {
    const mine = await newStory();
    const theirs = await newStory();
    const uploadId = await upload(theirs, await png());
    expect(await finalisePhotoUpload(uploadId, mine, mem.store)).toEqual({ ok: false, code: 'not_found' });
    expect(await q(`select 1 from photo where story_id = $1`, [theirs])).toHaveLength(0);
    expect(mem.store.objects.has(`incoming/${uploadId}`)).toBe(true);
  });
  it('an unknown id → not_found; nothing uploaded yet → not_uploaded', async () => {
    const storyId = await newStory();
    expect(await finalisePhotoUpload(randomUUID(), storyId, mem.store)).toEqual({
      ok: false,
      code: 'not_found',
    });
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error('sign');
    expect(await finalisePhotoUpload(s.uploadId, storyId, mem.store)).toEqual({
      ok: false,
      code: 'not_uploaded',
    });
  });
  it('a replay answers the same photo and writes nothing new', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const first = await finalisePhotoUpload(uploadId, storyId, mem.store);
    const download = vi.spyOn(mem.store, 'download');
    const again = await finalisePhotoUpload(uploadId, storyId, mem.store);
    expect(again).toEqual({ ok: true, photoId: first.ok && first.photoId, replay: true });
    expect(download).not.toHaveBeenCalled(); // answered from the row: no download, no re-encode
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });
  // The racing interleavings are forced with store hooks and the row lock, never left to timing (U10: the old
  // Promise.all version failed CI on #70/#74 when one finalise read the upload before the other committed and
  // downloaded after the other had dropped the raw object).
  it('two finalises queued on the row lock make one photo, count it once and leave no stray object', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const c0 = await photoAdded();
    const holder = await pool().connect();
    let both: Promise<Awaited<ReturnType<typeof finalisePhotoUpload>>[]> | undefined;
    try {
      await holder.query('begin');
      await holder.query(`select 1 from photo_upload where id = $1 for update`, [uploadId]);
      both = Promise.all([
        finalisePhotoUpload(uploadId, storyId, mem.store),
        finalisePhotoUpload(uploadId, storyId, mem.store),
      ]);
      await lockWaiters(holder, 2); // both have read, downloaded and uploaded; both now wait on the row lock
    } finally {
      await holder.query('commit');
      holder.release();
    }
    const [a, b] = await both;
    expect(a!.ok && b!.ok && a!.photoId === b!.photoId).toBe(true);
    expect([a!, b!].map((r) => r.ok && r.replay).sort()).toEqual([false, true]); // the loser took the in-tx replay
    expect([...mem.store.objects.keys()].filter((k) => k.startsWith('final/'))).toHaveLength(1);
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
    expect(await photoAdded()).toBe(c0 + 1); // pr67 F1: the loser (in-tx replay branch) counts nothing
  }, 15_000);
  it('drops incoming/ only after the commit, so a racer that finds it gone can read the photo (pr84 F2)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const finalisedAtDrop: (string | null)[] = [];
    const watched = {
      ...mem.store,
      remove: async (paths: string[]) => {
        if (paths.includes(`incoming/${uploadId}`)) {
          const [r] = await q<{ photo_id: string | null }>(
            `select photo_id from photo_upload where id = $1`,
            [uploadId],
          );
          finalisedAtDrop.push(r!.photo_id);
        }
        return mem.store.remove(paths);
      },
    };
    const out = await finalisePhotoUpload(uploadId, storyId, watched);
    expect(out).toMatchObject({ ok: true, replay: false });
    expect(finalisedAtDrop).toEqual([out.ok && out.photoId]);
    expect(mem.store.objects.has(`incoming/${uploadId}`)).toBe(false);
  });
  it('a finalise that read the upload before the winner committed but downloads after it answers the winner', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const c0 = await photoAdded();
    let winner: Awaited<ReturnType<typeof finalisePhotoUpload>> | undefined;
    const late = {
      ...mem.store,
      download: async (path: string) => {
        winner ??= await finalisePhotoUpload(uploadId, storyId, mem.store); // commits and drops incoming/ first
        return mem.store.download(path);
      },
    };
    const loser = await finalisePhotoUpload(uploadId, storyId, late);
    expect(winner).toMatchObject({ ok: true, replay: false });
    expect(loser).toEqual({ ok: true, photoId: winner!.ok && winner!.photoId, replay: true });
    expect([...mem.store.objects.keys()]).toEqual([`final/${winner!.ok && winner!.photoId}.jpg`]);
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
    expect(await photoAdded()).toBe(c0 + 1);
  });
  it('a finalise that loses the race answers the winner and removes its own final object', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const c0 = await photoAdded();
    let winner: Awaited<ReturnType<typeof finalisePhotoUpload>> | undefined;
    const racing = {
      ...mem.store,
      upload: async (path: string, bytes: Buffer, type: string) => {
        winner ??= await finalisePhotoUpload(uploadId, storyId, mem.store); // lands between our encode and tx
        return mem.store.upload(path, bytes, type);
      },
    };
    const loser = await finalisePhotoUpload(uploadId, storyId, racing);
    expect(winner).toMatchObject({ ok: true, replay: false });
    expect(loser).toEqual({ ok: true, photoId: winner!.ok && winner!.photoId, replay: true });
    expect([...mem.store.objects.keys()]).toEqual([`final/${winner!.ok && winner!.photoId}.jpg`]);
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
    expect(await photoAdded()).toBe(c0 + 1); // pr67 F1
  });
  it('a 3rd photo is refused at finalise too (uploads signed before others expired)', async () => {
    const storyId = await newStory();
    const ids = [await upload(storyId, await png()), await upload(storyId, await png())];
    await q(`update photo_upload set expires_at = now() - interval '1 second' where story_id = $1`, [
      storyId,
    ]);
    const third = await upload(storyId, await png());
    for (const id of ids) expect((await finalisePhotoUpload(id, storyId, mem.store)).ok).toBe(true);
    const [{ p: rawPath }] = (await q<{ p: string }>(
      `select incoming_path p from photo_upload where id = $1`,
      [third],
    )) as [{ p: string }];
    expect(mem.store.objects.has(rawPath)).toBe(true);
    // The story is already full: refused before the raw file is read or decoded, and the raw file is deleted.
    let downloads = 0;
    const watched = {
      ...mem.store,
      download: (path: string) => {
        downloads++;
        return mem.store.download(path);
      },
    };
    expect(await finalisePhotoUpload(third, storyId, watched)).toEqual({ ok: false, code: 'too_many' });
    expect(downloads).toBe(0);
    expect(mem.store.objects.has(rawPath)).toBe(false);
    expect([...mem.store.objects.keys()].filter((k) => k.startsWith('final/'))).toHaveLength(2);
    // refused for good: its place is freed and a later finalise of it reads nothing
    expect(await finalisePhotoUpload(third, storyId, mem.store)).toEqual({ ok: false, code: 'not_found' });
  });
  it('every decode slot taken: busy, nothing refused or deleted, and the same upload finalises once one frees', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    const release = holdEveryDecodeSlot();
    try {
      expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({ ok: false, code: 'busy' });
      expect(mem.store.objects.has(`incoming/${uploadId}`)).toBe(true);
      const [row] = await q<{ finalised_at: Date | null }>(
        `select finalised_at from photo_upload where id = $1`,
        [uploadId],
      );
      expect(row!.finalised_at).toBeNull();
    } finally {
      await release();
    }
    const out = await finalisePhotoUpload(uploadId, storyId, mem.store);
    expect(out.ok).toBe(true);
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
  });
  it('a refused file never takes a decode slot (it is refused even while every slot is taken)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, Buffer.from('definitely not a photo'));
    const release = holdEveryDecodeSlot();
    try {
      expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({
        ok: false,
        code: 'unreadable',
      });
    } finally {
      await release();
    }
  });
  it('an unreadable file is refused and its raw bytes deleted at once', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, Buffer.from('definitely not a photo'));
    expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({
      ok: false,
      code: 'unreadable',
    });
    expect(mem.store.objects.size).toBe(0);
  });
  it('a refused upload stays refused: bytes on its path again are never read or decoded (B005)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, Buffer.from('definitely not a photo'));
    expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({
      ok: false,
      code: 'unreadable',
    });
    mem.store.put(`incoming/${uploadId}`, Buffer.from('another file, same path'), 'image/jpeg');
    const download = vi.spyOn(mem.store, 'download');
    expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({ ok: false, code: 'not_found' });
    expect(download).not.toHaveBeenCalled();
  });
  it('a refused upload frees its place at once, not after 15 min (pr38 F5)', async () => {
    const storyId = await newStory();
    const bad = await upload(storyId, Buffer.from('not an image'));
    await upload(storyId, await png()); // in flight: 2 of 2 places used
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many' });
    expect(await finalisePhotoUpload(bad, storyId, mem.store)).toEqual({ ok: false, code: 'unreadable' });
    expect((await signPhotoUpload(storyId, mem.store)).ok).toBe(true);
  });

  it('a file over 20 MB is refused (defence in depth behind the bucket limit)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(await finalisePhotoUpload(uploadId, storyId, mem.store)).toEqual({ ok: false, code: 'too_big' });
    expect(mem.store.objects.size).toBe(0);
  });
  it('a database failure removes the final object it just wrote and keeps the raw file for a retry', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    dbFault.failNextTx = true;
    await expect(finalisePhotoUpload(uploadId, storyId, mem.store)).rejects.toThrow('tx failed');
    expect([...mem.store.objects.keys()]).toEqual([`incoming/${uploadId}`]);
    expect((await finalisePhotoUpload(uploadId, storyId, mem.store)).ok).toBe(true); // the retry works
  });
});

describe("T3.11: finalise counts 'photo_added' in its own transaction", () => {
  const added = photoAdded;
  it('once per new photo; never for a replay, a refused 3rd photo or a spam-suspect story', async () => {
    const storyId = await newStory();
    const before = await added();
    const first = await upload(storyId, await png());
    expect((await finalisePhotoUpload(first, storyId, mem.store)).ok).toBe(true);
    expect(await added()).toBe(before + 1);
    expect(await finalisePhotoUpload(first, storyId, mem.store)).toMatchObject({ ok: true, replay: true });
    expect(await added()).toBe(before + 1);
    await finalisePhotoUpload(await upload(storyId, await png()), storyId, mem.store);
    expect(await added()).toBe(before + 2);
    // a 3rd upload row made directly (sign refuses it): finalise refuses too_many and counts nothing
    const [extra] = await q<{ id: string }>(
      `insert into photo_upload (story_id, incoming_path) values ($1, 'incoming/' || gen_random_uuid()) returning id`,
      [storyId],
    );
    const extraPath = (
      await q<{ p: string }>(`select incoming_path as p from photo_upload where id = $1`, [extra!.id])
    )[0]!.p;
    mem.store.put(extraPath, await png(), 'image/png');
    expect(await finalisePhotoUpload(extra!.id, storyId, mem.store)).toEqual({ ok: false, code: 'too_many' });
    expect(await added()).toBe(before + 2);

    const spam = await newStory();
    await q(`update story set spam_suspect = true where id = $1`, [spam]);
    expect((await finalisePhotoUpload(await upload(spam, await png()), spam, mem.store)).ok).toBe(true);
    expect(await added()).toBe(before + 2);
  });
  it('a transaction that fails at COMMIT takes its count with it (the count is inside the tx)', async () => {
    const storyId = await newStory();
    const uploadId = await upload(storyId, await png());
    // fails at commit, i.e. after every statement in finalise's transaction, the count included
    await q(`create function twj_fail_commit() returns trigger language plpgsql as $f$
      begin if new.story_id = '${storyId}' then raise exception 'fail at commit'; end if; return new; end $f$`);
    await q(`create constraint trigger twj_fail_commit after insert on photo deferrable initially deferred
             for each row execute function twj_fail_commit()`);
    const before = await added();
    const finals = () => [...mem.store.objects.keys()].filter((k) => k.startsWith('final/')).sort();
    const finalsBefore = finals();
    try {
      await finalisePhotoUpload(uploadId, storyId, mem.store).catch(() => null);
    } finally {
      await q(`drop trigger twj_fail_commit on photo; drop function twj_fail_commit()`);
    }
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toEqual([]);
    expect(await added()).toBe(before);
    expect(finals()).toEqual(finalsBefore); // pr67 F3: the rolled-back photo's final/ object is gone too
  });
});

describe('POST /api/photos/finalise: 20/h counts successes only (AD-9, pr38 F3)', () => {
  const SITE = 'http://localhost:3000';
  const finalise = (photoUploadId: string) =>
    finaliseRoute(
      new NextRequest(`${SITE}/api/photos/finalise`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify({ photoUploadId }),
      }),
    );
  const used = async () =>
    Number(
      (
        await q<{ n: number }>(
          `select coalesce(sum(count), 0) as n from rate_limit where scope = 'photoFinalise'`,
        )
      )[0]!.n,
    );
  beforeEach(async () => {
    await q(`delete from rate_limit`);
  });

  it('a success counts 1; a replay, an unreadable file and a missing file count nothing', async () => {
    const storyId = await newStory();
    cap.requestId = (
      await q<{ request_id: string }>(`select request_id from story where id = $1`, [storyId])
    )[0]!.request_id;
    const bad = await upload(storyId, Buffer.from('not an image'));
    expect((await finalise(bad)).status).toBe(422);
    expect(await used()).toBe(0);
    const missing = (await signPhotoUpload(storyId, mem.store)) as { uploadId: string };
    expect((await finalise(missing.uploadId)).status).toBe(409);
    expect(await used()).toBe(0);
    const good = await upload(storyId, await png(40, 30));
    const ok = await finalise(good);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('no-store');
    expect(await used()).toBe(1);
    expect((await finalise(good)).status).toBe(200); // the replay
    expect(await used()).toBe(1);
  });

  it('every decode slot taken: 503 with Retry-After, not counted, and a retry finalises', async () => {
    const storyId = await newStory();
    cap.requestId = (
      await q<{ request_id: string }>(`select request_id from story where id = $1`, [storyId])
    )[0]!.request_id;
    const id = await upload(storyId, await png(40, 30));
    const release = holdEveryDecodeSlot();
    let res: Response;
    try {
      res = await finalise(id);
    } finally {
      await release();
    }
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.json()).toMatchObject({ ok: false, code: 'busy' });
    expect(await used()).toBe(0);
    expect((await finalise(id)).status).toBe(200);
    expect(await used()).toBe(1);
  });
  it('at 20 the route answers 429 before downloading anything', async () => {
    const storyId = await newStory();
    cap.requestId = (
      await q<{ request_id: string }>(`select request_id from story where id = $1`, [storyId])
    )[0]!.request_id;
    const id = await upload(storyId, await png(40, 30));
    await q(
      `insert into rate_limit (scope, key, window_start, count)
       values ('photoFinalise', 'local', date_bin(interval '3600 seconds', now(), timestamptz 'epoch'), 20)`,
    );
    const download = vi.spyOn(mem.store, 'download');
    expect((await finalise(id)).status).toBe(429);
    expect(download).not.toHaveBeenCalled();
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(0);
  });
});

describe('the media job (T3.6.04/.05)', () => {
  it('copies each finalised photo to R2 as photos/final/<id>.jpg and marks the row done', async () => {
    const storyId = await newStory();
    const out = await finalisePhotoUpload(await upload(storyId, await png()), storyId, mem.store);
    if (!out.ok) throw new Error(out.code);
    const backup = createMemoryBackup();
    expect(await runMediaJob({ store: mem.store, backup }, 5_000)).toEqual({ done: 1, failed: 0 });
    const key = `photos/final/${out.photoId}.jpg`;
    expect(backup.objects.get(key)).toEqual(mem.store.objects.get(`final/${out.photoId}.jpg`)!.bytes);
    expect(await outbox()).toMatchObject([{ attempts: 1, last_error: null, done_at: expect.any(Date) }]);
    const [s] = await q<{ updated_at: Date }>(
      `select updated_at from system_status where key = 'last_media_run_at'`,
    );
    expect(Date.now() - s!.updated_at.getTime()).toBeLessThan(10_000);
    expect(await runMediaJob({ store: mem.store, backup }, 5_000)).toEqual({ done: 0, failed: 0 }); // nothing twice
  });
  it('a failed copy is recorded, reported and retried later (never lost)', async () => {
    const storyId = await newStory();
    await finalisePhotoUpload(await upload(storyId, await png()), storyId, mem.store);
    const failing = {
      ...createMemoryBackup(),
      put: vi.fn(async () => Promise.reject(new TypeError('R2 down'))),
    };
    expect(await runMediaJob({ store: mem.store, backup: failing }, 5_000)).toEqual({ done: 0, failed: 1 });
    const [row] = await q<{ attempts: number; last_error: string; done_at: Date | null; later: boolean }>(
      `select attempts, last_error, done_at, next_attempt_at > now() + interval '4 minutes' as later
         from outbox where kind = 'r2_copy'`,
    );
    expect(row).toEqual({ attempts: 1, last_error: 'TypeError', done_at: null, later: true });
    expect(report).toHaveBeenCalledWith(expect.any(TypeError), { area: 'media', kind: 'r2_copy' });
    await q(`update outbox set next_attempt_at = now() where kind = 'r2_copy'`);
    const backup = createMemoryBackup();
    expect(await runMediaJob({ store: mem.store, backup }, 5_000)).toEqual({ done: 1, failed: 0 });
  });
  it(`stops retrying after ${MEDIA_MAX_ATTEMPTS} attempts`, async () => {
    await q(`insert into outbox (kind, payload, attempts) values ('r2_copy', $1, $2)`, [
      { photoId: randomUUID() },
      MEDIA_MAX_ATTEMPTS,
    ]);
    expect(await runMediaJob({ store: mem.store, backup: createMemoryBackup() }, 5_000)).toEqual({
      done: 0,
      failed: 0,
    });
  });
  it('a photo deleted since is simply done', async () => {
    await q(`insert into outbox (kind, payload) values ('r2_copy', $1)`, [{ photoId: randomUUID() }]);
    expect(await runMediaJob({ store: mem.store, backup: createMemoryBackup() }, 5_000)).toEqual({
      done: 1,
      failed: 0,
    });
  });
  it('attachment_finalise runs Jon’s upload through the same pipeline, and waits for the file', async () => {
    const storyId = (
      await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`)
    )[0]!.id;
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error(s.code);
    await q(`insert into outbox (kind, payload) values ('attachment_finalise', $1)`, [
      { photoUploadId: s.uploadId },
    ]);
    const backup = createMemoryBackup();
    expect(await runMediaJob({ store: mem.store, backup }, 5_000, 0)).toEqual({ done: 0, failed: 1 }); // not there yet
    mem.store.put(s.path, HEIC());
    await q(`update outbox set next_attempt_at = now()`);
    // the finalise, then the r2_copy it queued, in one run
    expect(await runMediaJob({ store: mem.store, backup }, 20_000, 0)).toEqual({ done: 2, failed: 0 });
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
    expect(backup.objects.size).toBe(1);
  }, 30_000);
  it('attachment_finalise with every decode slot taken is retried on a later run, not lost', async () => {
    const storyId = (
      await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`)
    )[0]!.id;
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error(s.code);
    mem.store.put(s.path, await png());
    await q(`insert into outbox (kind, payload) values ('attachment_finalise', $1)`, [
      { photoUploadId: s.uploadId },
    ]);
    const backup = createMemoryBackup();
    const release = holdEveryDecodeSlot();
    try {
      // busy is not a failure: no attempt spent, nothing reported (see the 8-run case below)
      expect(await runMediaJob({ store: mem.store, backup }, 5_000, 0)).toEqual({ done: 0, failed: 0 });
    } finally {
      await release();
    }
    expect((await outbox()).find((o) => o.kind === 'attachment_finalise')).toMatchObject({
      done_at: null,
      last_error: 'busy',
      attempts: 0,
    });
    expect(
      await q(`select 1 from photo_upload where id = $1 and finalised_at is null`, [s.uploadId]),
    ).toHaveLength(1);
    await q(`update outbox set next_attempt_at = now()`);
    expect(await runMediaJob({ store: mem.store, backup }, 20_000, 0)).toEqual({ done: 2, failed: 0 });
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(1);
  }, 30_000);
  it('stops taking items once its budget is spent', async () => {
    await q(`insert into outbox (kind, payload) values ('r2_copy', $1), ('r2_copy', $2)`, [
      { photoId: randomUUID() },
      { photoId: randomUUID() },
    ]);
    expect(await runMediaJob({ store: mem.store, backup: createMemoryBackup() }, 0)).toEqual({
      done: 0,
      failed: 0,
    });
  });
});

describe('the media job keeps HEIC work out of its last 30 s (pr38 F7)', () => {
  it('inside the reserve it copies to R2 but leaves attachment_finalise for the next run', async () => {
    const storyId = await newStory();
    await finalisePhotoUpload(await upload(storyId, await png()), storyId, mem.store); // queues one r2_copy
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error(s.code);
    mem.store.put(s.path, await png(), 'image/png');
    await q(`insert into outbox (kind, payload) values ('attachment_finalise', $1)`, [
      { photoUploadId: s.uploadId },
    ]);
    const backup = createMemoryBackup();
    expect(await runMediaJob({ store: mem.store, backup }, 5_000, 5_000)).toEqual({ done: 1, failed: 0 });
    const rows = await outbox();
    expect(rows.find((r) => r.kind === 'r2_copy')!.done_at).not.toBeNull();
    expect(rows.find((r) => r.kind === 'attachment_finalise')).toMatchObject({ attempts: 0, done_at: null });
  });
});

describe('the incoming purge (T3.6.06, AC7)', () => {
  it('keeps an old attachment still waiting for the media job, drops it once the job gave up (pr38 F8)', async () => {
    const { runTick } = await import('@/features/jobs');
    const storyId = await newStory();
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error(s.code);
    const now = new Date();
    mem.store.put(s.path, Buffer.from('x'), 'image/jpeg', new Date(now.getTime() - 3 * 3600_000));
    const [row] = await q<{ id: string }>(
      `insert into outbox (kind, payload) values ('attachment_finalise', $1) returning id`,
      [{ photoUploadId: s.uploadId }],
    );
    await runTick(now);
    expect(mem.store.objects.has(s.path)).toBe(true);
    await q(`update outbox set attempts = $2 where id = $1`, [row!.id, MEDIA_MAX_ATTEMPTS]);
    await runTick(now);
    expect(mem.store.objects.has(s.path)).toBe(false);
  });

  it('pr43 F2: a finalise still waiting past the threshold raises ONE report, then never again', async () => {
    const { runTick } = await import('@/features/jobs');
    const now = new Date();
    const payload = (id: string) => ({ photoUploadId: id });
    const [old] = await q<{ id: string }>(
      `insert into outbox (kind, payload, created_at) values ('attachment_finalise', $1, $2) returning id`,
      [payload(randomUUID()), new Date(now.getTime() - FINALISE_STALE_MS - 60_000)],
    );
    await q(`insert into outbox (kind, payload, created_at) values ('attachment_finalise', $1, $2)`, [
      payload(randomUUID()),
      new Date(now.getTime() - FINALISE_STALE_MS + 60_000),
    ]);
    await q(
      `insert into outbox (kind, payload, created_at, done_at) values ('attachment_finalise', $1, $2, now())`,
      [payload(randomUUID()), new Date(now.getTime() - 3 * FINALISE_STALE_MS)],
    );
    reportMessage.mockClear();
    await runTick(now);
    const stale = reportMessage.mock.calls.filter(([, t]) => t.step === 'finalise_stale');
    expect(stale).toEqual([[expect.any(String), { area: 'media', step: 'finalise_stale', count: '1' }]]);
    expect(
      (await q<{ payload: object }>(`select payload from outbox where id = $1`, [old!.id]))[0]!.payload,
    ).toMatchObject({ staleReported: true });
    reportMessage.mockClear();
    await runTick(now);
    expect(reportMessage.mock.calls.filter(([, t]) => t.step === 'finalise_stale')).toEqual([]);
  });

  it('deletes raw uploads older than 1 hour and keeps newer ones and final/', async () => {
    const { runTick } = await import('@/features/jobs');
    const now = new Date();
    const at = (min: number) => new Date(now.getTime() - min * 60_000);
    mem.store.put('incoming/old', Buffer.from('x'), 'image/jpeg', at(61));
    mem.store.put('incoming/fresh', Buffer.from('x'), 'image/jpeg', at(59));
    mem.store.put('final/old.jpg', Buffer.from('x'), 'image/jpeg', at(600));
    const out = await runTick(now);
    expect(out.ran).toContain('purge-incoming');
    expect([...mem.store.objects.keys()].sort()).toEqual(['final/old.jpg', 'incoming/fresh']);
  });
});

describe('admin thumbnails (T3.6.07)', () => {
  it('signs each photo for 10 minutes, in order', async () => {
    const storyId = await newStory();
    for (let i = 0; i < 2; i++)
      await finalisePhotoUpload(await upload(storyId, await png()), storyId, mem.store);
    const photos = await storyPhotosForAdmin(storyId, mem.store);
    expect(photos).toHaveLength(2);
    for (const p of photos) expect(p.url).toMatch(/^memory:\/\/read\/final\/[0-9a-f-]{36}\.jpg\?ttl=600$/);
    expect(await storyPhotosForAdmin(randomUUID(), mem.store)).toEqual([]);
  });
});

describe('sign: a lifetime cap on upload attempts that end without a photo', () => {
  const SITE = 'http://localhost:3000';
  const LIMIT = MAX_PHOTOS.after_send * FAILED_UPLOADS_PER_PHOTO; // 10
  const signViaRoute = () =>
    signRoute(
      new NextRequest(`${SITE}/api/photos/sign`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: '{}',
      }),
    );
  /** sign -> upload bytes no decoder accepts -> finalise refuses them (unreadable) */
  const refusedRound = async (storyId: string) => {
    const id = await upload(storyId, Buffer.from('these bytes are not an image'));
    expect(await finalisePhotoUpload(id, storyId, mem.store)).toMatchObject({
      ok: false,
      code: 'unreadable',
    });
  };
  beforeEach(async () => {
    await q(`delete from rate_limit`);
  });

  it('after MAX_PHOTOS x 5 refused uploads the next sign is refused (409): sign -> upload -> refused cannot loop', async () => {
    const requestId = await newRequest();
    cap.requestId = requestId;
    const storyId = (await ensureAfterSendStory(requestId))!;
    for (let i = 0; i < LIMIT; i++) await refusedRound(storyId);
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many_attempts' });
    const res = await signViaRoute();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('too_many_attempts');
    // nothing new was signed
    expect(await q(`select 1 from photo_upload where story_id = $1`, [storyId])).toHaveLength(LIMIT);
  });

  it('a guest with refusals just under the cap still adds both photos; finished photos never count', async () => {
    const storyId = await newStory();
    for (let i = 0; i < LIMIT - 1; i++) await refusedRound(storyId);
    for (let n = 0; n < MAX_PHOTOS.after_send; n++) {
      const id = await upload(storyId, await jpegWithGps());
      expect((await finalisePhotoUpload(id, storyId, mem.store)).ok).toBe(true);
    }
    // the story is full: the photo cap answers, not the attempt cap
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many' });
  });

  it('abandoned uploads (signed, never finished, expired) count; uploads still in flight do not', async () => {
    const storyId = await newStory();
    for (let i = 0; i < LIMIT - 2; i++) await refusedRound(storyId);
    await signPhotoUpload(storyId, mem.store);
    await signPhotoUpload(storyId, mem.store);
    // two in flight: the photo cap holds the 3rd, the attempt count is still LIMIT - 2
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many' });
    await q(
      `update photo_upload set expires_at = now() - interval '1 second' where story_id = $1 and finalised_at is null`,
      [storyId],
    );
    expect(await signPhotoUpload(storyId, mem.store)).toEqual({ ok: false, code: 'too_many_attempts' });
  });
});

describe('finalise and the media job under load', () => {
  it('a racing finalise that already made THIS upload’s photo (filling the story) is answered as that photo, not too_many', async () => {
    const storyId = await newStory();
    const first = await upload(storyId, await jpegWithGps());
    expect((await finalisePhotoUpload(first, storyId, mem.store)).ok).toBe(true);
    const second = await upload(storyId, await jpegWithGps());
    const made = await finalisePhotoUpload(second, storyId, mem.store); // fills the story (2 of 2)
    expect(made).toMatchObject({ ok: true, replay: false });
    // a retry of the same upload whose first read predates that commit: the story now looks full
    dbFault.staleUploadRead = true;
    const retry = await finalisePhotoUpload(second, storyId, mem.store);
    expect(retry).toEqual({ ok: true, photoId: (made as { photoId: string }).photoId, replay: true });
    expect(dbFault.staleUploadRead).toBe(false); // the stale read really happened
    // nothing was refused or removed
    expect(await q(`select 1 from photo where story_id = $1`, [storyId])).toHaveLength(2);
  });

  it('eight busy runs of the media job spend no attempt and report nothing', async () => {
    const storyId = (
      await q<{ id: string }>(`insert into story (source) values ('email_in') returning id`)
    )[0]!.id;
    const s = await signPhotoUpload(storyId, mem.store);
    if (!s.ok) throw new Error(s.code);
    mem.store.put(s.path, await png());
    await q(`insert into outbox (kind, payload) values ('attachment_finalise', $1)`, [
      { photoUploadId: s.uploadId },
    ]);
    report.mockClear();
    const backup = createMemoryBackup();
    const release = holdEveryDecodeSlot();
    try {
      for (let i = 0; i < MEDIA_MAX_ATTEMPTS; i++) {
        await q(`update outbox set next_attempt_at = now() where kind = 'attachment_finalise'`);
        expect(await runMediaJob({ store: mem.store, backup }, 5_000, 0)).toEqual({ done: 0, failed: 0 });
      }
    } finally {
      await release();
    }
    expect((await outbox()).find((o) => o.kind === 'attachment_finalise')).toMatchObject({
      attempts: 0,
      last_error: 'busy',
      done_at: null,
    });
    expect(report).not.toHaveBeenCalled();
    // and once a slot frees it simply finalises
    await q(`update outbox set next_attempt_at = now()`);
    expect(await runMediaJob({ store: mem.store, backup }, 20_000, 0)).toEqual({ done: 2, failed: 0 });
  }, 60_000);
});
