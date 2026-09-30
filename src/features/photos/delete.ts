// src/features/photos/delete.ts — removing deleted stories' photos from storage: the Supabase `photos` objects
// (final/ and any raw incoming/ upload) and each final photo's R2 twin. Used by L2's spam-story delete (#47) and
// shaped for any later story deletion. Rows and objects live in two systems, so:
//   1. inside the caller's delete transaction, BEFORE the rows go: `const objs = await photoObjectsOf([id], c)`;
//   2. after it commits: `await removePhotoObjects(objs)` (awaited, AD-1).
// A failed removal never undoes the delete: it's reported and leaves orphans that ONLY the operator's manual sweep
// (ops/purge-storage.ts) removes, so a spam story's photos can linger until then (pr55 F8).
// The caller must refuse the delete while an upload is still in flight (a photo_upload with no photo yet and not
// expired): answer 409 `upload_in_progress`, or a finalise could land a new final/ object after the collection.
import 'server-only';
import type { PoolClient } from 'pg';
import { photoBackup, photoStore, r2KeyOf, type ObjectStore, type PhotoBackup } from '@/lib/adapters/photos';
import { report } from '@/lib/report';

export interface PhotoObjects {
  /** `final/<photo.id>.jpg` paths; each has an R2 twin. */
  final: string[];
  /** Raw uploads (`incoming/<photo_upload.id>`); a finalised one is usually gone already. */
  incoming: string[];
}

export async function photoObjectsOf(
  storyIds: string[],
  c: Pick<PoolClient, 'query'>,
): Promise<PhotoObjects> {
  const { rows } = await c.query<PhotoObjects>(
    `select array(select storage_path from photo where story_id = any($1::uuid[]) order by storage_path) as final,
            array(select incoming_path from photo_upload where story_id = any($1::uuid[]) order by incoming_path)
              as incoming`,
    [storyIds],
  );
  return rows[0]!;
}

/** True when every object is gone from both stores; false = reported, left for the sweep. */
export async function removePhotoObjects(
  objs: PhotoObjects,
  ports: { store: ObjectStore; backup: PhotoBackup } = { store: photoStore(), backup: photoBackup() },
): Promise<boolean> {
  let ok = true;
  try {
    await ports.store.remove([...objs.final, ...objs.incoming]);
  } catch (e) {
    ok = false;
    report(e, { area: 'photos', step: 'delete_objects' });
  }
  try {
    await ports.backup.remove(objs.final.map(r2KeyOf));
  } catch (e) {
    ok = false;
    report(e, { area: 'photos', step: 'delete_r2' });
  }
  return ok;
}
