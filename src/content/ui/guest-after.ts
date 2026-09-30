// src/content/ui/guest-after.ts — lane U4 copy for the guest screens after booking (S11 After Send, the photo
// picker, S17/S18 manage and offer pages, S19) that isn't in src/content yet. Every line is word for word from the
// signed pack (G1, Jon decisions 46-47), already approved copy (decision 31), or the 8 picker / stand-by lines Jon
// approved in decision 49 (2026-09-28), cited per line. Anything else waits for Jon and is not here (ruling B).
// Every string here is also in the checked-in allowlist tests/unit/fixtures/guest-after-approved.json (pr90 F4).

export const STORY_FORM = {
  send: 'Send the story', // PACK v2.2 s11 (the button; AFTER_SEND.send reads "Send")
  sending: 'Sending…', // PACK v2.2 site.js (the busy state every Send button shows)
  empty: 'Add a line or a photo first, or skip it.', // PACK v2.2 s11 (G1 copy list, decision 31)
  waiting: 'Waiting for your photo…', // approved: Jon decision 49 (2026-09-28), line 1 (Send busy while a photo uploads)
  honeypot: 'Leave this empty', // PACK v2.2 s06/s07/s10 (the hidden honeypot label, AD-9)
};

export const PHOTO_PICKER = {
  added: 'Added', // approved: Jon decision 49 (2026-09-28), line 2 (tile done)
  addedSay: 'Photo added.', // PACK v2.2 site.js (the live-region line)
  remove: 'Remove', // approved: PACK v1.12 s06 (booking.ts PICKER.remove)
  uploading: 'Uploading', // approved: Jon decision 49 (2026-09-28), line 3 (tile in flight; no progress bar, T1.8.U2)
  stop: 'Stop', // approved: Jon decision 49 (2026-09-28), line 4 (abort an upload in flight)
  failed: 'That one didn’t go through.', // approved: Jon decision 49 (2026-09-28), line 5 (tile failed)
  tryAgain: 'Try again', // approved (admin-requests.ts retry), paired with line 5 in Jon decision 49 (2026-09-28)
  full: (n: number, max: number) => `${n} of ${max} · Remove one to swap`, // approved: Jon decision 49 (2026-09-28), line 6 (picker full)
  photoName: (n: number) => `photo ${n}`, // approved: Jon decision 49 (2026-09-28), line 7 (each tile's accessible name)
};

export const AFTER_SEND_STANDBY = {
  promise: (week: string) =>
    `You’re on stand-by for the week of ${week}. If something opens up, I’ll email you.`, // PACK v2.2 s17b
  receiptLine: (days: string) => `stand-by, ${days}`, // approved: Jon decision 49 (2026-09-28), line 9 (stand-by receipt line)
};

/** S16 / s17b "Link expired" frame: ERRORS.stale split as the pack sets it (heading, then a line). */
export const STALE = {
  pill: 'Link expired', // PACK v2.2 s17b (status pill)
  title: 'This link’s gone a bit stale.', // PACK v2.2 s17b; ERRORS.stale, first sentence
  body: 'Text me and I’ll send you a fresh one.', // PACK v2.2 s17b; ERRORS.stale, second sentence
};

/** S11 chrome: the pack's back link on the Sent page. */
export const SENT_UI = {
  backHome: 'Home', // PACK v2.2 s11 (header "‹ Home")
};
