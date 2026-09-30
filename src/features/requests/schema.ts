// src/lib/requests/schema.ts — T1.7 Zod schema for POST /api/requests (AD-2 max lengths).
import { z } from 'zod';
import { honeypotField } from '@/lib/honeypot';

// M5: single-line fields refuse every control character (CR/LF would reach email subjects and, with the
// Gmail API mailer's raw RFC 822, headers). Multi-line fields allow only tab, LF and CR.
// V1: plus the Unicode line and paragraph separators (U+2028, U+2029), which some clients render as breaks.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;
/** Every control character except tab, LF and CR (also used by Jon's admin notes, T2.8). */
export const CONTROL_EXCEPT_NEWLINES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL.test(s), 'control_character');
const multiLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((s) => !CONTROL_EXCEPT_NEWLINES.test(s), 'control_character');
// M3/L8: a repeated slot or date is a malformed request (400), not a primary-key crash (500).
const unique = <T>(a: T[]) => new Set(a).size === a.length;
export const CREW_BIG = 16;

export const RequestBody = z.object({
  clientKey: z.uuid(),
  dish: singleLine(64).min(1),
  name: singleLine(80).min(1, 'name_required'),
  email: z.string().trim().max(254).pipe(z.email('email_invalid')),
  phone: singleLine(30).optional().or(z.literal('')),
  crew: z.number().int().min(1, 'crew_min').max(99),
  note: multiLine(1000).optional(),
  slotIds: z.array(z.string().min(1).max(64)).max(52).default([]).refine(unique, 'duplicate_slot'), // uuids in the DB; checked against engine output
  standbyWeek: z.iso.date().optional(), // "Put me on stand-by" on a spoken-for week
  dates: z.array(z.iso.date()).max(2).default([]).refine(unique, 'duplicate_date'),
  windowText: singleLine(200).optional(),
  overnight: z.boolean().default(false),
  overnightNight: singleLine(60).optional(), // "Which night?" (wireframe 06-F); only with overnight (validate.ts)
  guestTimeZone: singleLine(64).optional(),
  pitchIdea: multiLine(2000).optional(),
  surpriseNeedToKnow: multiLine(2000).optional(),
  surprisePlan: multiLine(2000).optional(),
  hp: honeypotField, // AD-9: filled => spam_suspect, never rejected
  turnstileToken: z.string().max(4096).optional(),
});
export type RequestBody = z.infer<typeof RequestBody>;
