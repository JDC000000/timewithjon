// src/app/admin/_requests/preview.ts — a sheet's "Preview" (wireframe 09 A3f, A3i): the guest email's own subject
// and body from src/content/emails.ts, filled with what Jon picked. The link lines ({takeLink}, {manageLink}, …)
// are minted at send time and aren't shown; the sign-off is. Times read as the email writes them.
import { copyFor, fill, SIGN_OFF, type TemplateId } from '@/content';
import { guestWhen } from '@/lib/when';

/** A line that is only a link placeholder, e.g. "{takeLink}". */
const LINK_LINE = /^\{[a-zA-Z]+Link\}$/;

export function emailPreview(
  id: TemplateId,
  vars: Record<string, string | number>,
): { subject: string; lines: string[]; signOff: string } {
  const copy = copyFor(id, vars); // the variant the email will send (Q6 singular, E7's deadline)
  const lines = copy.body
    .split('\n')
    .filter((l) => !LINK_LINE.test(l.trim()))
    .map((l) => fill(l, vars));
  return { subject: fill(copy.subject, vars), lines, signOff: SIGN_OFF };
}

/** "Fri May 21 · noon–2 pm Vancouver time": how E5 writes an offered time (suggest.ts timeLabel, QA C; no guest zone here). */
export function emailTime(startsAt: Date, endsAt: Date): string {
  return guestWhen(startsAt, endsAt, null);
}
