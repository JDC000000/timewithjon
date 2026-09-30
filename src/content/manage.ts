// src/content/manage.ts — T2.7.U1 S17 "Manage my booking" copy. Every line is word for word from the signed pack
// (v2.2 s17 / s17b, G1) or already approved copy, cited per line. The status label itself is GUEST_LABEL (§6).

export const MANAGE_UI = {
  title: 'Manage my booking', // PACK v2.2 s17b (page heading "Manage my booking: …")
  heading: (label: string, dish: string) => `${label}: ${dish}`, // PACK v2.2 s17 / s17b ("Locked in: The Long Lunch")
  when: 'When', // PACK v2.2 s17 (receipt facts)
  calendarInvite: 'A calendar invite is on its way.', // PACK v2.2 s17 (locked in)
  ownPlan: 'Your plan (only you can see this)', // PACK v2.2 s17b (Surprise Me, Sent)
  askAnother: 'Ask for another time', // PACK v2.2 s17
  /** Carried 1: the page says first that new times release the locked time. */
  frees: (when: string) => `Sending new times frees up ${when}.`, // PACK v2.2 s17 (note under Ask for another time)
  cancel: 'Cancel', // PACK v2.2 s17
  addStory: 'Add a story or photo', // PACK v2.2 s17
  backToMenu: 'Back to the activity menu', // PACK v2.2 s17b
};
