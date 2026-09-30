// src/features/jobs/media-limits.ts — the media job's limits, apart from media.ts so the tick's purge can read
// them without loading sharp/libheif.
export const MEDIA_BUDGET_MS = 90_000;
/**
 * pr38 F7: a HEIC attachment can take ~20 s, so none is claimed in the budget's last 30 s (maxDuration 120 would
 * kill it mid-way and waste an attempt). Quick r2_copy items still run then.
 */
export const MEDIA_HEAVY_RESERVE_MS = 30_000;
/** After this many tries a row stays for the operator (it's reported every time it fails). */
export const MEDIA_MAX_ATTEMPTS = 8;
/**
 * pr43 F2: an attachment_finalise still unprocessed this long after it was queued means the media job isn't
 * running on that env (it runs every 5 min): the tick reports it once.
 */
export const FINALISE_STALE_MS = 60 * 60 * 1000;
