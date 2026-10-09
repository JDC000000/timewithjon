// src/content/calendar.ts — the calendar event text. Jon's own calendar (TSD §7): summary "{Dish}: {first name}",
// description the crew and where. What a guest gets (the .ics, or the Google event once a guest is on it, since
// one Google event shows every attendee the same title): "{Dish} with Jon" and only "Where: …" when Jon set it (Q2).
// NEVER the sealed plan or the guest's note (AD-11, AD-12).
export const CALENDAR_EVENT = {
  summary: '{dish}: {firstName}',
  crew: 'Crew: {crew}',
  where: 'Where: {where}',
  guestSummary: '{dish} with Jon', // approved: Jon (2026-10-09) Q2 ("The Long Lunch with Jon")
} as const;
