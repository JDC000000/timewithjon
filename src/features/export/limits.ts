// src/features/export/limits.ts — the largest stories zip an export uploads. The `exports` bucket's own size limit
// (ops/bucket-limits.ts) is this same number, so the export checks the zip it built before sending it, instead of
// sending hundreds of MB to be refused. A free-plan project caps every upload lower (50 MB; limitsFor there), so
// there a zip under this one can still be refused by the bucket.

const MiB = 1024 * 1024;

/** 450 MiB: room for the season's book (~300-400 MiB), under the 512 MB /tmp it is built in (see bucket-limits). */
export const EXPORT_MAX_BYTES = 450 * MiB;
