// src/features/jobs/jobs/purge-exports.ts — T3.10.02 (L8, AC6): export zips are deleted 24 h after creation.
// Also closes an export whose function died mid-way (maxDuration 300 s), so it can't block the next one.
import { q } from '@/lib/db';
import { exportStore } from '@/lib/adapters/exports';
import { EXPORT_STALE_MINUTES, EXPORTS_PREFIX } from '@/features/export/run';
import { registerJob } from '../registry';

export const EXPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

registerJob({
  name: 'purge-exports',
  async run(now) {
    await q(
      `update export_job set status = 'failed', finished_at = now()
        where status in ('queued', 'running') and created_at < $1::timestamptz - make_interval(mins => $2)`,
      [now.toISOString(), EXPORT_STALE_MINUTES],
    );
    const store = exportStore();
    const old = await store.listCreatedBefore(EXPORTS_PREFIX, new Date(now.getTime() - EXPORT_MAX_AGE_MS));
    if (old.length) await store.remove(old);
  },
});
