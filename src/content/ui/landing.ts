// src/content/ui/landing.ts — lane U2 copy for the landing (S1-S3, the #story block, S14) that the v2.2 design pack
// shows but src/content lacks. Every line is the pack's, word for word; `// PACK v2.2 <screen>` names the screen
// (gen.py landing() / nogifts_story(), site.js data-copy).

/** Landmark and region labels (pack aria-labels). */
export const LANDING_LABELS = {
  why: 'Why', // PACK v2.2 s01
  closing: 'Closing line', // PACK v2.2 s01
};

/** The mailbox the story block names (stories@ forwards to Jon's Gmail; NAMING.md). */
export const STORIES_DOMAIN = 'timewithjon.com'; // PACK v2.2 s01 #story

/** "Copy the address" on the #story block (and S13). */
export const COPY_ADDRESS = {
  label: 'Copy the address', // PACK v2.2 s01 #story
  copied: 'Copied', // PACK v2.2 site.js (button text after a copy)
  copiedSay: (address: string) => `Copied ${address}`, // PACK v2.2 site.js (announced)
};
