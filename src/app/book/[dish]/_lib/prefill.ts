// T1.7.U2 personal-link pre-fill (T1.7 AC8, R1-07): a personal invite's details step opens as one line,
// "Sending as Dave · dave@… · Change", and Change shows the normal fields holding those values. A general link (or a
// personal invite missing its name or email) opens on the fields, blank or part-filled, as before. Pure.
import type { GuestView } from './flow-view';

/** NEW COPY (contract R1-07, design s07 .sendas); moves to @/content when Jon signs the line. */
export const SEND_AS = { lead: 'Sending as', change: 'Change' } as const;

/** The email as the summary line shows it: the part before the @, then "@…" ("dave@example.com" → "dave@…"). */
export function maskEmail(email: string): string {
  const e = email.trim();
  const at = e.indexOf('@');
  return at < 0 ? `${e}…` : `${e.slice(0, at + 1)}…`;
}

export interface Prefill {
  /** the fields' starting values (what POST /api/requests sends until the guest edits them) */
  name: string;
  email: string;
  /** the one summary line, or null when the fields show from the start */
  summary: { name: string; email: string } | null;
}

export function prefill(guest: GuestView): Prefill {
  const name = guest.name.trim();
  const email = guest.email.trim();
  const summary = !guest.general && name && email ? { name, email: maskEmail(email) } : null;
  return { name: guest.name, email: guest.email, summary };
}
