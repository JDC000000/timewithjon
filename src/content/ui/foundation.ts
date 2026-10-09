// src/content/ui/foundation.ts (U1): strings the shared UI shows that src/content doesn't have yet.
// Every line is word for word from the v1.12 design pack (`// PACK v1.12 <screen>`); new lines are `// NEW COPY (needs Jon)`.
import { MENU_TITLE } from '@/content/menu';

/** The skip link on every page. */
export const SKIP_TO_CONTENT = 'Skip to content'; // PACK v1.12 page shell (every screen)

/** The site name as the header and admin wordmark show it (CSS sets the caps; NAMING.md). */
export const MARK = 'Time with Jon'; // PACK v1.12 s01 header, a2 admin shell

/** The guest header nav. */
export const SITE_NAV = { menu: MENU_TITLE, story: 'Send a story' } as const; // PACK v1.12 s01 header; v2.1 COPY (decision 37d); "No gifts" removed (decision 45)

/** The admin shell. */
export const ADMIN_SHELL = {
  nav: { requests: 'Requests', season: 'Season', links: 'Links', stories: 'Stories', more: 'More' }, // PACK v1.12 a2 nav
  settings: 'Settings', // PACK v1.12 a2 top bar
  signedInAs: 'Signed in as', // PACK v1.12 a2 side bar; followed by the admin's email
  soloTag: 'Admin', // PACK v1.12 a1 sign-in header, next to the wordmark
  needReplyVh: ' need a reply', // PACK v1.12 a2 nav badge (visually hidden, after the count)
} as const;

/** The staging banner (T3.16.U1). */
export const STAGING_BANNER = 'Staging. Test data only.'; // approved: Jon (2026-10-03)

/** The 404 page title (the line and the link are NOT_FOUND in src/content/site.ts). */
export const NOT_FOUND_TITLE = 'Page not found · Time with Jon'; // PACK v1.12 wireframe 01 state D

/** The toggle on a photo slideshow (src/ui/Slideshow.tsx): the word shown is what a press does. */
export const SLIDESHOW = {
  pause: 'Pause', // approved: Jon (2026-10-05)
  play: 'Play', // approved: Jon (2026-10-05)
  /** A /menu card's toggle name: the word shown and the dish ("Play The Grind"), so each one is told apart. */
  named: (word: string, dish: string) => `${word} ${dish}`, // approved: Jon (2026-10-09)
} as const;
