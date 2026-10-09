// src/lib/tz.ts — the site's one time zone (AD-2). Its own module so browser code can name it without loading
// date-fns-tz (src/lib/time.ts re-exports it for server code).
export const TZ = 'America/Vancouver';
