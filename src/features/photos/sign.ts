// src/features/photos/sign.ts — T3.6.02: bind a one-time signed upload URL to a new photo_upload row.
// The row and the URL live or die together: signing happens inside the transaction, so a Storage error leaves
// no row behind to eat one of the story's photo places.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { withTx } from '@/lib/db';
import type { ObjectStore } from '@/lib/adapters/photos';
import { MAX_PHOTOS } from './limits';

export type SignResult =
  | { ok: true; uploadId: string; path: string; signedUrl: string; token: string }
  | { ok: false; code: 'no_story' | 'too_many' }
  | { ok: false; code: 'not_stored' }; // prototype (§5.5)

class NotStored extends Error {}

export async function signPhotoUpload(storyId: string, store: ObjectStore): Promise<SignResult> {
  try {
    return await withTx(async (c) => {
      const story = (
        await c.query<{ source: keyof typeof MAX_PHOTOS }>(
          `select source from story where id = $1 for update`,
          [storyId],
        )
      ).rows[0];
      if (!story) return { ok: false, code: 'no_story' } as const;
      // Finalised photos plus uploads still in flight: a guest can't open a 3rd place while two are pending.
      const used = (
        await c.query<{ n: number }>(
          `select (select count(*) from photo where story_id = $1)
                + (select count(*) from photo_upload
                    where story_id = $1 and finalised_at is null and expires_at > now()) as n`,
          [storyId],
        )
      ).rows[0]!.n;
      if (Number(used) >= MAX_PHOTOS[story.source]) return { ok: false, code: 'too_many' } as const;
      const uploadId = randomUUID();
      const path = `incoming/${uploadId}`;
      await c.query(`insert into photo_upload (id, story_id, incoming_path) values ($1, $2, $3)`, [
        uploadId,
        storyId,
        path,
      ]);
      // Supabase's upload token lives 2 h (not configurable) while the in-flight place frees after 15 min
      // (photo_upload.expires_at). A late or repeated upload to this path is harmless: nothing reads it without a
      // finalise (which re-checks the cap under FOR UPDATE), and the purge removes it within the hour (AC7).
      const signed = await store.createSignedUploadUrl(path);
      if (!signed) throw new NotStored();
      return { ok: true, uploadId, path, ...signed } as const;
    });
  } catch (e) {
    if (e instanceof NotStored) return { ok: false, code: 'not_stored' };
    throw e;
  }
}
