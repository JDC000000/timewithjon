// src/features/calendar/event.ts — the event a locked booking becomes, shared by the Google outbox (outbox.ts)
// and the .ics fallback (ics-email.ts), so both always describe the booking the same way.
import { CALENDAR_EVENT, fill } from '@/content';
import { dishBySlug } from '@/content/menu-helpers';
import type { CalendarEvent } from '@/lib/adapters/types';

export interface LockedRow {
  status: string;
  dish: string;
  contact_name: string;
  contact_email: string;
  crew_size: number;
  locked_starts_at: Date | null;
  locked_ends_at: Date | null;
  locked_where: string | null;
  google_event_id: string | null;
  calendar_state: string;
}

/** The columns LockedRow reads, for `select ${LOCKED_COLUMNS} from request`. */
export const LOCKED_COLUMNS = `status, dish, contact_name, contact_email::text as contact_email, crew_size,
  locked_starts_at, locked_ends_at, locked_where, google_event_id, calendar_state::text as calendar_state`;

/**
 * Pure: the event Google gets. Never the plan, the note or the phone. `joined` = the joined guests' emails.
 * AD-6: once the guest has the .ics (calendar_state 'ics_sent'), the Google event leaves them off, so they never
 * get a second invite; joined guests got no .ics, so Google's invite stays theirs.
 */
export function calendarEvent(requestId: string, r: LockedRow, joined: string[] = []): CalendarEvent {
  const firstName = r.contact_name.trim().split(/\s+/)[0] ?? r.contact_name;
  const description = [
    fill(CALENDAR_EVENT.crew, { crew: r.crew_size }),
    r.locked_where ? fill(CALENDAR_EVENT.where, { where: r.locked_where }) : null,
  ]
    .filter(Boolean)
    .join('\n');
  const others = joined.filter((e) => e !== r.contact_email);
  return {
    requestId,
    summary: fill(CALENDAR_EVENT.summary, { dish: dishBySlug(r.dish)?.name ?? r.dish, firstName }),
    description,
    startsAt: r.locked_starts_at!,
    endsAt: r.locked_ends_at!,
    attendees: r.calendar_state === 'ics_sent' ? others : [r.contact_email, ...others],
  };
}
