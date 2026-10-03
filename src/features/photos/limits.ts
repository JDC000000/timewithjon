// src/features/photos/limits.ts — T3.6 / T3.7.03: how many photos a story may carry, by where it came from.
export const MAX_PHOTOS: Record<'after_send' | 'story_page' | 'email_in', number> = {
  after_send: 2, // T3.6 AC4: a 3rd photo on one story is refused
  story_page: 2, // T3.12 reuses the S11 picker
  email_in: 5, // T3.7.03: Jon adds up to 5 for an emailed story
};
/** TSD C-5: stored at 3000 px on the long edge, which is also the export resolution (never enlarged). */
export const MAX_LONG_EDGE_PX = 3000;
/** The bucket's own limit is 20 MB (AD-4); re-checked server side before decoding. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** sharp's decompression-bomb guard (AD-4), also applied to EVERY image in a HEIC before heic-decode decodes one. */
export const MAX_INPUT_PIXELS = 50_000_000;
/** Jon's admin thumbnails are 10-minute signed URLs (AD-4, T3.6.07). */
export const THUMB_URL_TTL_SECONDS = 600;
/** Raw uploads (with GPS) never outlive this (T3.6 AC7: gone within 1 h 15 min with the 15-min tick). */
export const INCOMING_MAX_AGE_MS = 60 * 60 * 1000;
/**
 * How many story-page stories one invite may start in all (S19). A personal invite is one guest; the general invite
 * is shared by many, so it has no total here, only Turnstile and its daily limit (LIMITS.storyPageNew).
 */
export const STORY_PAGE_MAX_PER_INVITE: Record<'personal' | 'general', number | null> = {
  personal: 3,
  general: null,
};
