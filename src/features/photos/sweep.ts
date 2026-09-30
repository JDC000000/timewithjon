// src/features/photos/sweep.ts — T3.16.05: the operator's storage sweep (ops/purge-storage.ts). After
// ops/purge-test-data.sql deletes test stories (and so their photo rows), their `final/` objects and R2 twins are
// orphans: no photo row names them. The sweep lists both stores and removes only those. Anything younger than an
// hour is left alone: a finalise uploads `final/` a moment before its row commits. Raw `incoming/` uploads are the
// tick's job (purge-incoming, within 1 h 15 min). The app never runs this.
import { r2KeyOf, type ObjectStore, type PhotoBackup } from '@/lib/adapters/photos';
import { checkDeleteCap } from './sweep-guard';

export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

export class SweepRefusedError extends Error {
  override name = 'SweepRefusedError';
}
const FINAL = 'final';

export interface SweepResult {
  /** Rows in `photo` (every one should have one `final/` object and one R2 twin). */
  photoRows: number;
  finalObjects: number;
  r2Objects: number;
  orphanFinal: string[];
  orphanR2: string[];
  applied: boolean;
}

export async function sweepOrphanPhotos(opts: {
  store: ObjectStore;
  backup: PhotoBackup;
  /** The photo rows' paths, read from the same database the stores belong to. */
  photoPaths: () => Promise<string[]>;
  now: Date;
  apply: boolean;
  /** The operator's explicit --max-delete (pr55 F1); see checkDeleteCap. */
  maxDelete?: number;
}): Promise<SweepResult> {
  const cutoff = new Date(opts.now.getTime() - SWEEP_MIN_AGE_MS);
  // Listed first, then the rows: a photo committed in between is younger than the cutoff anyway.
  const finalObjects = await opts.store.listCreatedBefore(FINAL, cutoff);
  const r2Objects = await opts.backup.listCreatedBefore(r2KeyOf(FINAL), cutoff);
  const paths = await opts.photoPaths();
  const referenced = new Set(paths);
  const twins = new Set(paths.map(r2KeyOf));
  const orphanFinal = finalObjects.filter((p) => !referenced.has(p));
  const orphanR2 = r2Objects.filter((k) => !twins.has(k));
  if (opts.apply) {
    for (const [orphans, listed] of [
      [orphanFinal.length, finalObjects.length],
      [orphanR2.length, r2Objects.length],
    ] as const) {
      const refused = checkDeleteCap({ orphans, listed, maxDelete: opts.maxDelete });
      if (refused) throw new SweepRefusedError(refused);
    }
    await opts.store.remove(orphanFinal);
    await opts.backup.remove(orphanR2);
  }
  return {
    photoRows: paths.length,
    finalObjects: finalObjects.length,
    r2Objects: r2Objects.length,
    orphanFinal,
    orphanR2,
    applied: opts.apply,
  };
}
