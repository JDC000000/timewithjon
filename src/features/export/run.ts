// src/features/export/run.ts — T3.10.01: one export = one export_job row, one zip built on local disk (/tmp),
// sent to the private `exports` bucket, and a 10-minute signed link for Jon. One export at a time.
// /tmp on Vercel holds 512 MB, which bounds the zip (the season's photos are ~300-400 MB at 3000 px).
import 'server-only';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { q, withTx } from '@/lib/db';
import type { ExportStore } from '@/lib/adapters/exports';
import type { ObjectStore } from '@/lib/adapters/photos';
import { vancouverDate } from '@/lib/time';
import { exportStories, writeExportZip, type ExportOptions } from './build';

export const EXPORT_LINK_TTL_SECONDS = 600;
/** A running export older than this died with its function (maxDuration 300 s); it no longer blocks a new one. */
export const EXPORT_STALE_MINUTES = 10;
export const EXPORTS_PREFIX = 'zips';

export type ExportResult =
  | { ok: true; jobId: string; url: string; stories: number; photos: number; bytes: number }
  | { ok: false; code: 'busy' };

export async function runExport(
  opts: ExportOptions,
  ports: { photos: ObjectStore; exports: ExportStore },
  now = new Date(),
): Promise<ExportResult> {
  const jobId = await withTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(hashtext('twj_export'))`);
    const busy = await c.query(
      `select 1 from export_job
        where status in ('queued', 'running') and created_at > now() - make_interval(mins => $1)`,
      [EXPORT_STALE_MINUTES],
    );
    if (busy.rowCount) return null;
    return (
      await c.query<{ id: string }>(
        `insert into export_job (consented_only, include_email, status) values ($1, $2, 'running') returning id`,
        [opts.consentedOnly, opts.includeEmail],
      )
    ).rows[0]!.id;
  });
  if (!jobId) return { ok: false, code: 'busy' };

  const file = path.join(tmpdir(), `twj-export-${jobId}.zip`);
  const objectPath = `${EXPORTS_PREFIX}/${jobId}.zip`;
  try {
    await removeStaleZips(); // pr50-verify N2: inside the try, so an rm error fails this job, never leaves it 'running'
    const stories = await exportStories(opts);
    const zip = await writeExportZip(stories, opts, ports.photos, file);
    await ports.exports.uploadFile(objectPath, file, zip.bytes);
    await q(`update export_job set status = 'done', storage_path = $2, finished_at = now() where id = $1`, [
      jobId,
      objectPath,
    ]);
    const url = await ports.exports.signedDownloadUrl(
      objectPath,
      EXPORT_LINK_TTL_SECONDS,
      `time-with-jon-stories-${vancouverDate(now)}.zip`,
    );
    return { ok: true, jobId, url, stories: stories.length, photos: zip.photos, bytes: zip.bytes };
  } catch (e) {
    await q(
      `update export_job set status = 'failed', finished_at = now() where id = $1 and status = 'running'`,
      [jobId],
    );
    throw e;
  } finally {
    await rm(file, { force: true });
  }
}

/**
 * pr50 F4: `finally` never runs when Vercel kills the function at maxDuration, so a warm instance can keep a
 * ~400 MB zip in /tmp (512 MB) and the next export dies with ENOSPC. Safe to clear every one: this job holds the
 * slot (the lock + the 10-minute stale window > 300 s), so no other export on this instance is still live.
 */
async function removeStaleZips(): Promise<void> {
  const dir = tmpdir();
  for (const f of await readdir(dir))
    if (/^twj-export-.+\.zip$/.test(f)) await rm(path.join(dir, f), { force: true });
}
