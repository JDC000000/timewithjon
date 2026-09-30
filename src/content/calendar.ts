// src/content/calendar.ts — the Google event text (TSD §7): summary "{Dish}: {first name}"; the description is the
// crew and where, NEVER the sealed plan or the guest's note (AD-11, AD-12).
export const CALENDAR_EVENT = {
  summary: '{dish}: {firstName}',
  crew: 'Crew: {crew}',
  where: 'Where: {where}',
} as const;
