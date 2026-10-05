// src/features/photos/finalise.ts — T3.6.03: turn one raw upload into a clean `final/<photo.id>.jpg`.
// Keyed ONLY by the photo_upload id (never a path) and, for guests, checked against the caller's story (AC6).
// Idempotent: a replay (or a race) answers the photo already made and leaves no stray object behind.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { countEvent } from '@/features/analytics/count';
import { q, withTx } from '@/lib/db';
import type { ObjectStore } from '@/lib/adapters/photos';
import { report } from '@/lib/report';
import { MAX_PHOTOS, MAX_UPLOAD_BYTES } from './limits';
import { toCleanJpeg, UnreadableImageError } from './reencode';

export type FinaliseResult =
  | { ok: true; photoId: string; replay: boolean }
  | { ok: false; code: 'not_found' | 'not_uploaded' | 'too_big' | 'unreadable' | 'too_many' };

/**
 * @param callerStoryId the guest's own story (from the capability); null only for trusted server callers
 *   (Jon's admin upload, the attachment_finalise job).
 */
export async function finalisePhotoUpload(
  uploadId: string,
  callerStoryId: string | null,
  store: ObjectStore,
): Promise<FinaliseResult> {
  const row = (
    await q<{ story_id: string; incoming_path: string; photo_id: string | null; refused: boolean }>(
      `select story_id, incoming_path, photo_id, finalised_at is not null and photo_id is null as refused
         from photo_upload where id = $1`,
      [uploadId],
    )
  )[0];
  // A refused upload stays refused: a later finalise of it (even after bytes reach its path again) reads nothing.
  if (!row || row.refused || (callerStoryId !== null && row.story_id !== callerStoryId))
    return { ok: false, code: 'not_found' };
  if (row.photo_id) return { ok: true, photoId: row.photo_id, replay: true };
  // A story that is already full: refused before the raw file is read or decoded, and the raw file (maybe with
  // GPS) goes at once. The transaction below re-checks, for a photo that lands in between.
  if (await storyFull(row.story_id)) {
    await refuse(uploadId, store, row.incoming_path);
    return { ok: false, code: 'too_many' };
  }

  const raw = await store.download(row.incoming_path);
  // U10: a racing finalise may have committed and dropped the raw object since our read above (it drops it only
  // after its commit), so a missing object is "not uploaded" only if the upload is still unfinalised.
  if (!raw) return (await madePhoto(uploadId)) ?? { ok: false, code: 'not_uploaded' };
  if (raw.length > MAX_UPLOAD_BYTES) {
    await refuse(uploadId, store, row.incoming_path);
    return { ok: false, code: 'too_big' };
  }
  let clean;
  try {
    clean = await toCleanJpeg(raw);
  } catch (e) {
    if (!(e instanceof UnreadableImageError)) throw e;
    await refuse(uploadId, store, row.incoming_path); // raw bytes (maybe GPS) never linger
    return { ok: false, code: 'unreadable' };
  }

  const photoId = randomUUID();
  const finalPath = `final/${photoId}.jpg`;
  await store.upload(finalPath, clean.data, 'image/jpeg');
  let outcome: FinaliseResult;
  try {
    outcome = await withTx(async (c) => {
      const locked = (
        await c.query<{ photo_id: string | null; source: keyof typeof MAX_PHOTOS; spam_suspect: boolean }>(
          `select pu.photo_id, s.source, s.spam_suspect from photo_upload pu join story s on s.id = pu.story_id
            where pu.id = $1 for update of pu, s`,
          [uploadId],
        )
      ).rows[0]!;
      if (locked.photo_id) return { ok: true, photoId: locked.photo_id, replay: true } as const;
      const n = (
        await c.query<{ n: string }>(`select count(*) as n from photo where story_id = $1`, [row.story_id])
      ).rows[0]!.n;
      if (Number(n) >= MAX_PHOTOS[locked.source]) return { ok: false, code: 'too_many' } as const;
      await c.query(
        `insert into photo (id, story_id, storage_path, width, height, bytes) values ($1, $2, $3, $4, $5, $6)`,
        [photoId, row.story_id, finalPath, clean.width, clean.height, clean.data.length],
      );
      await c.query(`update photo_upload set finalised_at = now(), photo_id = $2 where id = $1`, [
        uploadId,
        photoId,
      ]);
      // T3.6.05: the write-through R2 copy, run by /api/jobs/media (M5).
      await c.query(`insert into outbox (kind, payload) values ('r2_copy', $1)`, [{ photoId }]);
      // T3.11: counted in the same transaction, once per new photo (a replay returned above); a honeypot story is a
      // bot's, like story_added.
      if (!locked.spam_suspect) await countEvent('photo_added', c);
      return { ok: true, photoId, replay: false } as const;
    });
  } catch (e) {
    await store.remove([finalPath]).catch(() => undefined);
    throw e;
  }
  if (!(outcome.ok && outcome.photoId === photoId)) {
    await store
      .remove([finalPath])
      .catch((e: unknown) => report(e, { area: 'photos', step: 'drop_duplicate' }));
  }
  if (!outcome.ok) await refuse(uploadId, store, row.incoming_path); // filled up meanwhile: the raw file goes too
  if (outcome.ok) await dropIncoming(store, row.incoming_path);
  return outcome;
}

/** The story already holds as many photos as its source allows (MAX_PHOTOS). */
async function storyFull(storyId: string): Promise<boolean> {
  const [r] = await q<{ n: number; source: keyof typeof MAX_PHOTOS }>(
    `select s.source, (select count(*)::int from photo p where p.story_id = s.id) as n from story s where s.id = $1`,
    [storyId],
  );
  return !!r && r.n >= MAX_PHOTOS[r.source];
}

/** The photo a finalise of this upload already committed, answered as a replay; null while none has. */
async function madePhoto(uploadId: string): Promise<FinaliseResult | null> {
  const [r] = await q<{ photo_id: string | null }>(`select photo_id from photo_upload where id = $1`, [
    uploadId,
  ]);
  return r?.photo_id ? { ok: true, photoId: r.photo_id, replay: true } : null;
}

/**
 * pr38 F5: a refused upload frees its in-flight place at once (not after 15 min) and its raw bytes go. It is marked
 * done without a photo (finalised_at set, photo_id null), so finalising it again answers not_found.
 */
async function refuse(uploadId: string, store: ObjectStore, path: string) {
  await q(
    `update photo_upload set expires_at = least(expires_at, now()), finalised_at = coalesce(finalised_at, now())
      where id = $1 and photo_id is null`,
    [uploadId],
  );
  await dropIncoming(store, path);
}

/** Best effort: the purge job removes anything this misses within the hour (AC7). */
async function dropIncoming(store: ObjectStore, path: string) {
  await store.remove([path]).catch((e: unknown) => report(e, { area: 'photos', step: 'drop_incoming' }));
}
