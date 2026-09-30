// src/features/jobs/media.ts — T3.6.04 (TSD M5): the heavy outbox kinds, off the 8-second tick. Called by
// POST /api/jobs/media every 5 minutes; takes one item at a time until its budget (90 s) is spent.
import 'server-only';
import { q } from '@/lib/db';
import { r2KeyOf, type ObjectStore, type PhotoBackup } from '@/lib/adapters/photos';
import { errorName, report } from '@/lib/report';
import { finalisePhotoUpload } from '@/features/photos/finalise';
import { MEDIA_BUDGET_MS, MEDIA_HEAVY_RESERVE_MS, MEDIA_MAX_ATTEMPTS } from './media-limits';

export { MEDIA_BUDGET_MS, MEDIA_HEAVY_RESERVE_MS, MEDIA_MAX_ATTEMPTS } from './media-limits';
type MediaKind = 'r2_copy' | 'attachment_finalise';

export class MediaRetryError extends Error {
  override name = 'MediaRetryError';
}

interface Ports {
  store: ObjectStore;
  backup: PhotoBackup;
}
const HANDLERS: Record<MediaKind, (payload: Record<string, unknown>, ports: Ports) => Promise<void>> = {
  /** T3.6.05: copy `final/<id>.jpg` to R2 as `photos/final/<id>.jpg`. A photo deleted since is simply done. */
  async r2_copy(payload, { store, backup }) {
    const photo = (
      await q<{ storage_path: string }>(`select storage_path from photo where id = $1`, [
        String(payload.photoId),
      ])
    )[0];
    if (!photo) return;
    const bytes = await store.download(photo.storage_path);
    if (!bytes) throw new MediaRetryError('final object missing');
    await backup.put(r2KeyOf(photo.storage_path), bytes, 'image/jpeg');
  },
  /** T3.7.03: Jon's photos for an emailed story (HEIC can take seconds, so it runs here, not in his request). */
  async attachment_finalise(payload, { store }) {
    const out = await finalisePhotoUpload(String(payload.photoUploadId), null, store);
    if (!out.ok && out.code === 'not_uploaded') throw new MediaRetryError('upload not there yet');
    if (!out.ok && out.code !== 'too_many')
      report(new MediaRetryError(out.code), { area: 'media', step: out.code });
  },
};

export async function runMediaJob(
  ports: Ports,
  budgetMs = MEDIA_BUDGET_MS,
  heavyReserveMs = MEDIA_HEAVY_RESERVE_MS,
): Promise<{ done: number; failed: number }> {
  const until = Date.now() + budgetMs;
  let done = 0;
  let failed = 0;
  while (Date.now() < until) {
    // Claiming pushes next_attempt_at out first, so an item whose run dies mid-way is retried, never lost.
    const kinds: MediaKind[] =
      until - Date.now() > heavyReserveMs ? ['r2_copy', 'attachment_finalise'] : ['r2_copy'];
    const item = (
      await q<{ id: string; kind: MediaKind; payload: Record<string, unknown> }>(
        `update outbox set attempts = attempts + 1,
                next_attempt_at = now() + make_interval(mins => least(60, 5 * power(2, attempts)::int))
          where id = (select id from outbox
                       where kind = any($2::outbox_kind[]) and done_at is null
                         and next_attempt_at <= now() and attempts < $1
                       order by next_attempt_at, created_at limit 1 for update skip locked)
          returning id, kind, payload`,
        [MEDIA_MAX_ATTEMPTS, kinds],
      )
    )[0];
    if (!item) break;
    try {
      await HANDLERS[item.kind](item.payload, ports);
      await q(`update outbox set done_at = now(), last_error = null where id = $1`, [item.id]);
      done++;
    } catch (e) {
      failed++;
      await q(`update outbox set last_error = $2 where id = $1`, [item.id, errorName(e)]);
      report(e, { area: 'media', kind: item.kind });
    }
  }
  await q(
    `insert into system_status (key, value, updated_at) values ('last_media_run_at', now()::text, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
  );
  return { done, failed };
}
