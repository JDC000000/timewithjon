// src/features/export/build.ts — T3.10.01: the rows and the zip for Jon's book or cards.
// stories.csv (id, source, name, dish, date, body, consent, consent_source, photos [, email]) + photos/<story-id>-<n>.jpg.
// Explicit columns only: the request's sealed plan is never selected (C4). Spam suspects (story or request) are
// never exported (pr29 F3). Consented-only is the default (AC2); the email column only when opted in (AC4).
import 'server-only';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ZipArchive } from 'archiver';
import { dishBySlug } from '@/content/menu-helpers';
import { q } from '@/lib/db';
import type { ObjectStore } from '@/lib/adapters/photos';
import { report } from '@/lib/report';
import { toCsv } from './csv';

export interface ExportOptions {
  consentedOnly: boolean;
  includeEmail: boolean;
}

export interface ExportStory {
  id: string;
  source: string;
  name: string | null;
  dish: string | null;
  /** The day of the time together (the locked date), else the day the story came in (Vancouver). */
  date: string;
  body: string | null;
  consent: boolean;
  consentSource: string | null;
  email: string | null;
  photoPaths: string[];
}

export async function exportStories(opts: ExportOptions): Promise<ExportStory[]> {
  const rows = await q<{
    id: string;
    source: string;
    name: string | null;
    dish: string | null;
    date: string;
    body: string | null;
    consent: boolean;
    consent_source: string | null;
    email: string | null;
    photo_paths: string[];
  }>(
    `select s.id, s.source::text as source, coalesce(r.contact_name, s.from_name) as name, r.dish,
            to_char(coalesce(sl.date, (s.created_at at time zone 'America/Vancouver')::date), 'YYYY-MM-DD') as date,
            s.body, s.consent, s.consent_source::text as consent_source,
            case when $2 then coalesce(s.from_email::text, r.contact_email::text) end as email,
            coalesce((select array_agg(p.storage_path order by p.created_at, p.id) from photo p where p.story_id = s.id),
                     '{}') as photo_paths
       from story s
       left join request r on r.id = s.request_id
       left join slot sl on sl.id = r.locked_slot_id
       left join invite i on i.id = s.invite_id
      where not s.spam_suspect and not coalesce(r.spam_suspect, false)
        and not coalesce(r.is_test, false) -- pr50 F1: dry-run and test-invite requests never reach the book
        and not coalesce(i.is_test, false) -- pr50 F2 / pr43 N1: nor a story page saved through a test invite
        and (s.consent or not $1)
      order by s.created_at, s.id`,
    [opts.consentedOnly, opts.includeEmail],
  );
  return rows
    .filter((r) => (r.body ?? '').trim() !== '' || r.photo_paths.length > 0) // an opened-but-empty After-Send story
    .map((r) => ({
      id: r.id,
      source: r.source,
      name: r.name,
      dish: r.dish ? (dishBySlug(r.dish)?.name ?? r.dish) : null,
      date: r.date,
      body: r.body,
      consent: r.consent,
      consentSource: r.consent_source,
      email: r.email,
      photoPaths: r.photo_paths,
    }));
}

const HEADER = ['id', 'source', 'name', 'dish', 'date', 'body', 'consent', 'consent_source', 'photos'];

/**
 * Writes the zip to `file` on local disk. Photos are already JPEG, so they're stored, not re-compressed, and
 * added one at a time (each waits for the archive to take the previous one), so memory holds one photo, not 400 MB.
 * A photo whose object is missing is left out of both the zip and the CSV (and reported).
 */
export async function writeExportZip(
  stories: ExportStory[],
  opts: ExportOptions,
  photos: ObjectStore,
  file: string,
): Promise<{ bytes: number; photos: number }> {
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = createWriteStream(file);
  const finished = new Promise<void>((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
  });
  // pr50 F3: handled at once (awaited below), so an archive error mid-loop is never an unhandled rejection.
  finished.catch(() => {});
  archive.pipe(out);
  try {
    return await fillArchive(archive, stories, opts, photos, file, finished);
  } catch (e) {
    // A failed download or archive error: close both streams so no fd or half-written zip stays open.
    archive.abort();
    out.destroy();
    throw e;
  }
}

async function fillArchive(
  archive: ZipArchive,
  stories: ExportStory[],
  opts: ExportOptions,
  photos: ObjectStore,
  file: string,
  finished: Promise<void>,
): Promise<{ bytes: number; photos: number }> {
  let photoCount = 0;
  const rows = [];
  for (const s of stories) {
    const names: string[] = [];
    for (const path of s.photoPaths) {
      const bytes = await photos.download(path);
      if (!bytes) {
        report(new Error('export: photo object missing'), { area: 'export', storyId: s.id });
        continue;
      }
      const name = `${s.id}-${names.length + 1}.jpg`;
      archive.append(bytes, { name: `photos/${name}`, store: true });
      // pr50 F3: an archive error rejects `finished`; racing it means the loop can't wait forever for an entry.
      await Promise.race([once(archive, 'entry'), finished]);
      names.push(name);
      photoCount++;
    }
    rows.push([
      s.id,
      s.source,
      s.name,
      s.dish,
      s.date,
      s.body,
      s.consent,
      s.consentSource,
      names.join(' '),
      ...(opts.includeEmail ? [s.email] : []),
    ]);
  }
  const csv = toCsv(opts.includeEmail ? [...HEADER, 'email'] : HEADER, rows);
  archive.append(Buffer.from(csv, 'utf8'), { name: 'stories.csv' });
  await archive.finalize();
  await finished;
  return { bytes: (await stat(file)).size, photos: photoCount };
}
