// src/features/jobs/jobs/purge-incoming.ts — T3.6.06 (AC7): raw uploads can carry GPS; none outlives an hour.
// The 15-minute tick makes that "gone within 1 h 15 min". Finalise already deletes its own incoming file.
// pr38 F8: Jon's emailed attachments waiting for the media job (attachment_finalise, not yet given up) are kept,
// so a media-job outage can't delete them before they're processed; once the job gives up they go too.
// pr43 F2: a finalise still waiting an hour after it was queued raises ONE Sentry report (per row, no PII).
import { q } from '@/lib/db';
import { report, reportMessage } from '@/lib/report';
import { photoStore } from '@/lib/adapters/photos';
import { FINALISE_STALE_MS, MEDIA_MAX_ATTEMPTS } from '@/features/jobs/media-limits';
import { INCOMING_MAX_AGE_MS } from '@/features/photos/limits';
import { registerJob } from '../registry';

registerJob({
  name: 'purge-incoming',
  async run(now) {
    // pr43 N5: a failed stale check (DB) must not cost this tick its purge.
    await reportStaleFinalises(now).catch((e: unknown) =>
      report(e, { area: 'media', step: 'finalise_stale' }),
    );
    const store = photoStore();
    const stale = await store.listCreatedBefore('incoming', new Date(now.getTime() - INCOMING_MAX_AGE_MS));
    if (!stale.length) return;
    const waiting = new Set(
      (
        await q<{ path: string }>(
          `select pu.incoming_path as path from outbox o
             join photo_upload pu on pu.id::text = o.payload->>'photoUploadId'
            where o.kind = 'attachment_finalise' and o.done_at is null and o.attempts < $1`,
          [MEDIA_MAX_ATTEMPTS],
        )
      ).map((r) => r.path),
    );
    const purge = stale.filter((p) => !waiting.has(p));
    if (purge.length) await store.remove(purge);
  },
});

async function reportStaleFinalises(now: Date): Promise<void> {
  const flagged = await q<{ id: string }>(
    `update outbox set payload = payload || '{"staleReported": true}'::jsonb
      where kind = 'attachment_finalise' and done_at is null and created_at < $1
        and not (payload ? 'staleReported')
      returning id`,
    [new Date(now.getTime() - FINALISE_STALE_MS)],
  );
  if (flagged.length)
    reportMessage('attachment_finalise unprocessed past the threshold', {
      area: 'media',
      step: 'finalise_stale',
      count: String(flagged.length),
    });
}
