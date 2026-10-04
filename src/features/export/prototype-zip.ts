// src/features/export/prototype-zip.ts — T3.10.U1: the prototype keeps its `exports` bucket in memory, so its
// signed link (memory://) can't be opened. There, and only there, the export route answers the finished zip
// itself, read back from that bucket in the same request. Staging and production keep the signed link.
import 'server-only';
import { prototypeExportStore } from '@/lib/adapters/mock/export-store';
import { exportObjectPath } from './run';

/** A zip answered inline stays small: the prototype's seeded stories are a few kB; anything past this is refused. */
export const PROTOTYPE_ZIP_MAX_BYTES = 4 * 1024 * 1024;

/** The job's finished zip from the prototype bucket: its bytes, 'missing', or 'too_large'. */
export function prototypeZip(jobId: string): Buffer | 'missing' | 'too_large' {
  const zip = prototypeExportStore.objects.get(exportObjectPath(jobId))?.bytes;
  if (!zip) return 'missing';
  return zip.length > PROTOTYPE_ZIP_MAX_BYTES ? 'too_large' : zip;
}
