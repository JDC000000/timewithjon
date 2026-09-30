// src/features/photos/email-in.ts — T3.7.02/.03 (F15, A6 "Add emailed story"): Jon types in a story a guest
// emailed to stories@ (inbound never reaches the app, AC3), then adds up to 5 photos through the T3.6 pipeline.
// Server-only; every caller has passed requireAdmin(). Nothing here sends an email.
import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MEDIA_MAX_ATTEMPTS } from '@/features/jobs/media';
import { q, withTx } from '@/lib/db';

export const EmailedStoryBody = z.object({
  fromName: z.string().trim().min(1).max(80),
  fromEmail: z.email().max(254),
  body: z.string().trim().min(1).max(5000),
  consent: z.boolean().default(false),
});
export type EmailedStory = z.infer<typeof EmailedStoryBody>;

/**
 * pr82-review F5: the A6 form's `Idempotency-Key` header (one random key per story Jon is adding, reused on a
 * retry of the same payload). Stored per story source, so the same key under another source never matches.
 */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IdempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

/** pr83-review M1: what a key is bound to. The email is compared as stored (citext), so case never matters. */
export function emailedStoryHash(s: EmailedStory): string {
  const payload = JSON.stringify([s.fromName, s.fromEmail.toLowerCase(), s.body, s.consent]);
  return createHash('sha256').update(payload).digest('hex');
}

/** The key was already used for another payload (pr83-review M1): the route answers 409, nothing changes. */
export const KEY_REUSED = 'key_reused' as const;

/**
 * Ticked: Jon has the guest's consent (asked personally), recorded as `consent_source='jon'`. Unticked: no consent
 * yet, so the story sorts under "needs Jon" in A6 and stays out of a consented-only export.
 * With a key, a replay of the same payload (a lost 201 retried, or a double submit racing it) answers the story the
 * first call made: the no-op DO UPDATE returns the existing row, and a concurrent insert waits on the unique index.
 * The same key with another payload matches no row (the DO UPDATE's WHERE), so it answers KEY_REUSED.
 */
export async function addEmailedStory(
  s: EmailedStory,
  idempotencyKey: string | null = null,
): Promise<string | typeof KEY_REUSED> {
  const rows = await q<{ id: string }>(
    `insert into story (source, from_name, from_email, body, consent, consent_source, consent_needs_jon,
                        idempotency_key, idempotency_payload_hash)
     values ('email_in', $1, $2, $3, $4, case when $4 then 'jon'::consent_source end, not $4, $5, $6)
     on conflict (source, idempotency_key) where idempotency_key is not null
       do update set idempotency_key = excluded.idempotency_key
       where story.idempotency_payload_hash = excluded.idempotency_payload_hash
     returning id`,
    [s.fromName, s.fromEmail, s.body, s.consent, idempotencyKey, idempotencyKey ? emailedStoryHash(s) : null],
  );
  return rows[0]?.id ?? KEY_REUSED;
}

/** Photos are added only to Jon's own emailed stories, never to a guest's After-Send or story-page story. */
export async function isEmailedStory(storyId: string): Promise<boolean> {
  return (await q(`select 1 from story where id = $1 and source = 'email_in'`, [storyId])).length > 0;
}

export type QueueResult = { ok: true; photoId: string } | { ok: true; queued: true } | { ok: false };

/**
 * T3.7.03: the re-encode runs in /api/jobs/media (outbox `attachment_finalise`), not in Jon's request: a HEIC
 * can take seconds and he may add 5. Queued once while a live job exists (a spent one can be re-queued after a re-upload); an already finalised upload answers its photo.
 */
export async function queueEmailedPhotoFinalise(storyId: string, uploadId: string): Promise<QueueResult> {
  return withTx(async (c) => {
    const up = (
      await c.query<{ photo_id: string | null }>(
        `select u.photo_id from photo_upload u join story s on s.id = u.story_id
          where u.id = $1 and u.story_id = $2 and s.source = 'email_in' for update of u`,
        [uploadId, storyId],
      )
    ).rows[0];
    if (!up) return { ok: false };
    if (up.photo_id) return { ok: true, photoId: up.photo_id };
    await c.query(
      `insert into outbox (kind, payload)
       select 'attachment_finalise', $1::jsonb
        where not exists (select 1 from outbox where kind = 'attachment_finalise' and payload->>'photoUploadId' = $2
                             and done_at is null and attempts < $3)`,
      [{ photoUploadId: uploadId }, uploadId, MEDIA_MAX_ATTEMPTS],
    );
    return { ok: true, queued: true };
  });
}
