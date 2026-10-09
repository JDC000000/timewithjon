// src/features/photos/limits.ts — T3.6 / T3.7.03: how many photos a story may carry, by where it came from.
export const MAX_PHOTOS: Record<'after_send' | 'story_page' | 'email_in', number> = {
  after_send: 2, // T3.6 AC4: a 3rd photo on one story is refused
  story_page: 2, // T3.12 reuses the S11 picker
  email_in: 5, // T3.7.03: Jon adds up to 5 for an emailed story
};
/**
 * Upload attempts a story may spend WITHOUT getting a photo (refused at finalise, or signed and never finished), for
 * its whole life: MAX_PHOTOS x this. A guest who retries a few unreadable files is never near it; sign -> upload ->
 * refused can't repeat without end (each round costs a full download and a parse). Successful uploads never count.
 */
export const FAILED_UPLOADS_PER_PHOTO = 5;
/** TSD C-5: stored at 3000 px on the long edge, which is also the export resolution (never enlarged). */
export const MAX_LONG_EDGE_PX = 3000;
/** The bucket's own limit is 20 MB (AD-4); re-checked server side before decoding. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/**
 * sharp's decompression-bomb guard (AD-4), on every sharp decode in reencode.ts and on EVERY image in a HEIC before
 * heic-decode decodes one. It is the largest photo a phone saves by default with a little room: a 48 MP iPhone
 * photo is 8064 x 6048 = 48.8 MP. A file that claims more is refused from its header, before pixels are allocated.
 */
export const MAX_INPUT_PIXELS = 50_000_000;
/**
 * Photo decodes at once per server instance (decode-gate.ts): each may hold ~200 MB of pixels at the ceiling above.
 * A decode waits up to DECODE_WAIT_MS for a slot; with ENCODE_TIMEOUT_SECONDS (40 s) that still fits finalise's
 * 60 s maxDuration, so a refused wait answers "try again" before the function is killed.
 */
export const MAX_CONCURRENT_DECODES = 2;
export const DECODE_WAIT_MS = 15_000;
/** Jon's admin thumbnails are 10-minute signed URLs (AD-4, T3.6.07). */
export const THUMB_URL_TTL_SECONDS = 600;
/** Raw uploads (with GPS) never outlive this (T3.6 AC7: gone within 1 h 15 min with the 15-min tick). */
export const INCOMING_MAX_AGE_MS = 60 * 60 * 1000;
