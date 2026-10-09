// src/app/admin/_requests/rows.ts — A2's filters and how one inbox card reads as a row (pack a2: who, the wait
// or the date, the meta line, the Jon-only flags). Pure: the page passes `now`.
import { JON_FLAGS } from '@/content';
import { INBOX, MAIL, ROW } from '@/content/ui/admin-requests';
import { PITCH } from '@/content/ui/booking';
import type { InboxCard, InboxTab } from '@/features/admin/inbox';
import { dayLabel, vancouverInstant } from '@/lib/time';
import { ageLabel, shortDate, whenLabel } from './format';

/** The pack's filter keys (also the URL hash: `/admin#locked`), in the pack's order, and the server tab each reads. */
export const FILTERS = [
  { key: 'needs', tab: 'needs_reply' },
  { key: 'waiting', tab: 'waiting' },
  { key: 'standby', tab: 'standby' },
  { key: 'locked', tab: 'locked' },
  { key: 'done', tab: 'done' },
  { key: 'cancelled', tab: 'cancelled' },
] as const satisfies readonly { key: string; tab: InboxTab }[];
export type FilterKey = (typeof FILTERS)[number]['key'];

export interface RowView {
  id: string;
  who: string;
  /** The right-hand figure: a wait ("3 h", "1 d") or a date ("Apr 8"). */
  age: string;
  meta: string;
  flags: string[];
}

/** The Jon-only flags a row repeats from A3 (wireframe 09: "flags ... repeat in the row meta"). */
export function flagsOf(c: {
  /** T3.2.U1: an email to them failed for good (the Resend is on A3). */
  failedSend?: boolean;
  noTimesLeft: boolean;
  bigCrew: boolean;
  contactProblem: InboxCard['contactProblem'];
  guestRsvp: InboxCard['guestRsvp'];
}): string[] {
  const flags: string[] = [];
  if (c.failedSend) flags.push(MAIL.failed);
  if (c.contactProblem === 'bounced' || c.contactProblem === 'complained') flags.push(JON_FLAGS.bounced);
  if (c.guestRsvp === 'no') flags.push(JON_FLAGS.rsvpNo);
  if (c.noTimesLeft) flags.push(INBOX.noTimesLeft);
  if (c.bigCrew) flags.push(JON_FLAGS.bigCrew);
  return flags;
}

export function rowView(card: InboxCard, key: FilterKey, now: Date, failedSend = false): RowView {
  const dish = card.dishName ?? card.dish;
  const flags = flagsOf({ ...card, failedSend });
  const base = { id: card.id, who: card.contactName, flags };
  const start = card.lockedStartsAt ? new Date(card.lockedStartsAt) : null;
  const end = card.lockedEndsAt ? new Date(card.lockedEndsAt) : null;

  if ((key === 'locked' || key === 'done') && start && end) {
    const when =
      card.countsToward === 'big_day' ? `${dayLabel(start)} · ${INBOX.bigDay}` : whenLabel(start, end);
    return { ...base, age: shortDate(start), meta: `${dish} · ${when}` };
  }
  if (key === 'cancelled') {
    const how = card.closedInPerson
      ? ROW.closedInPerson
      : card.cancelledBy === 'jon'
        ? ROW.cancelledByYou
        : ROW.cancelledByGuest;
    const parts = [dish, ...(start ? [dayLabel(start)] : []), how];
    const at = card.cancelledAt ? new Date(card.cancelledAt) : new Date(card.createdAt);
    return { ...base, age: shortDate(at), meta: parts.join(' · ') };
  }
  const parts = [dish, INBOX.crew(card.crewSize)];
  if (key === 'standby' && card.standbyWeek) {
    parts.push(INBOX.weekOf(shortDate(vancouverInstant(card.standbyWeek, '12:00'))));
  } else if (card.windowText) {
    parts.push(card.windowText);
  } else if (card.datesCount > 0) {
    parts.push(ROW.dates(card.datesCount));
  } else if (card.timesCount > 0) {
    parts.push(ROW.times(card.timesCount));
  }
  if (card.overnight) parts.push(PITCH.oneNightAway); // QA4 M1: the guest's own words, so Jon never books a half day
  const since = new Date(card.awaitingJonSince ?? card.createdAt);
  return { ...base, age: ageLabel(since, now), meta: parts.join(' · ') };
}
