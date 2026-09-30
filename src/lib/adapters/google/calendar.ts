// src/lib/adapters/google/calendar.ts — T3.4.01/.02 (AD-6): the real CalendarGateway on the "Time with Jon" calendar.
// - Deterministic event id = the request id without hyphens (32 hex chars, valid base32hex), so an insert that
//   timed out after Google stored it can't make a second event: the retry gets 409. Then a GET decides
//   (pr39 F3): a live event only converges quietly (sendUpdates=none: the guest already has the invite); a
//   cancelled one (Google keeps a deleted event's id: a re-lock after a cancel) is revived with status
//   'confirmed' and a real re-invite. Only that path ever sets status (pr39 F1): a plain patch never revives.
// - J2 (pr39 F2 ruling): the connected account (oauth_connection.account_email, Jon's Gmail) rides along as an
//   accepted attendee, so the booking shows him busy on his main calendar and Google emails him nothing (he
//   owns the calendar). The app itself never calls the API on `primary`: the write guard below refuses it.
// - No guest attendee (the .ics fallback's "attendee-less" event) means sendUpdates=none: Google emails no one.
import 'server-only';
import { TZ } from '@/lib/time';
import type { CalendarEvent, CalendarGateway, CalendarHealth, EventRsvps } from '../types';
import { CALENDAR_API } from './oauth';
import { GoogleApiError, googleFetch, isGoogleAuthFailure } from './http';
import { toGuestRsvp } from './rsvp';

/** Google's own cap for one events.list page. A season holds ~100 bookings, so one page is the whole answer. */
export const RSVP_LIST_MAX = 2500;

interface EventList {
  items?: { id?: string; status?: string; attendees?: { email?: string; responseStatus?: string }[] }[];
}

export class CalendarWriteGuardError extends Error {
  override name = 'CalendarWriteGuardError';
}

/** A secondary calendar the app created; `primary` or an account address would be Jon's main calendar. */
const APP_CALENDAR_ID = /^[a-z0-9._-]+@group\.calendar\.google\.com$/i;

/**
 * T3.4.02: every write must target exactly the stored "Time with Jon" calendar, which must be a secondary
 * calendar. Throws otherwise (kept in both scope modes, AD-6).
 */
export function assertWritableCalendar(
  calendarId: string | null | undefined,
  storedId: string | null,
): string {
  if (
    !calendarId ||
    calendarId !== storedId ||
    calendarId.toLowerCase() === 'primary' ||
    !APP_CALENDAR_ID.test(calendarId)
  ) {
    throw new CalendarWriteGuardError('calendar writes may only target the stored app calendar');
  }
  return calendarId;
}

/** The request id without hyphens; anything but a uuid is refused (pr39 F6), so the id is always base32hex. */
export function googleEventId(requestId: string): string {
  const id = requestId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('a Google event id needs a uuid request id');
  return id;
}

/** Where to write and who owns it, both from the stored oauth_connection row. */
export interface CalendarTarget {
  calendarId: string | null;
  /** The connected account (J2 attendee). */
  ownerEmail: string;
}

export interface GoogleCalendarDeps {
  accessToken(): Promise<string>;
  /** The stored connection; null when never connected (the write guard then refuses). */
  target(): Promise<CalendarTarget | null>;
  /** A 401 means the cached access token is dead: drop it so the next call refreshes. */
  forgetAccessToken(): void;
}

function attendees(e: CalendarEvent, ownerEmail: string) {
  const owner = ownerEmail.trim().toLowerCase();
  const guests = [...new Set(e.attendees.map((a) => a.trim().toLowerCase()))].filter((a) => a && a !== owner);
  return {
    list: [...guests.map((email) => ({ email })), { email: owner, responseStatus: 'accepted' }],
    hasGuests: guests.length > 0,
  };
}

/** Content only: no status (pr39 F1) and no attendees (pr39 F5: resending them may reset the guest's RSVP). */
function content(e: CalendarEvent) {
  return {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.startsAt.toISOString(), timeZone: TZ },
    end: { dateTime: e.endsAt.toISOString(), timeZone: TZ },
  };
}

const EVENT_SETTINGS = {
  transparency: 'opaque',
  guestsCanInviteOthers: false,
  guestsCanModify: false,
  guestsCanSeeOtherGuests: false, // a guest never sees another guest (AGENTS rule 5)
} as const;

export function googleCalendarGateway(deps: GoogleCalendarDeps): CalendarGateway {
  async function authorized<T>(url: URL, req: Parameters<typeof googleFetch>[1]): Promise<T> {
    try {
      return await googleFetch<T>(url.toString(), { ...req, accessToken: await deps.accessToken() });
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 401) deps.forgetAccessToken();
      throw e;
    }
  }

  async function call<T>(
    op: string,
    eventPath: string,
    init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; json?: unknown; notify?: boolean },
  ) {
    const stored = (await deps.target())?.calendarId ?? null;
    const calendarId = assertWritableCalendar(stored, stored);
    const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events${eventPath}`);
    if (init.notify !== undefined) url.searchParams.set('sendUpdates', init.notify ? 'all' : 'none');
    return authorized<T>(url, { op, method: init.method, json: init.json });
  }

  const ownerEmail = async () => (await deps.target())?.ownerEmail ?? '';
  const eventPath = (id: string) => `/${encodeURIComponent(id)}`;

  /** A reschedule: time and text only. Never revives a cancelled event, never touches the attendee list. */
  async function patch(eventId: string, e: CalendarEvent): Promise<void> {
    const { hasGuests } = attendees(e, await ownerEmail());
    await call('events_patch', eventPath(eventId), { method: 'PATCH', json: content(e), notify: hasGuests });
  }

  /** The 409 path: the id exists at Google. GET first (events.get returns cancelled events too). */
  async function converge(id: string, e: CalendarEvent): Promise<void> {
    const existing = await call<{ status?: string }>('events_get', eventPath(id), { method: 'GET' });
    const { list, hasGuests } = attendees(e, await ownerEmail());
    if (existing?.status === 'cancelled') {
      // A re-lock after a cancel: a real re-invite, the full event back to confirmed.
      await call('events_patch', eventPath(id), {
        method: 'PATCH',
        json: { ...content(e), ...EVENT_SETTINGS, attendees: list, status: 'confirmed' },
        notify: hasGuests,
      });
      return;
    }
    // A retry after a timed-out insert: Google already sent the invite, so converge the content silently.
    await call('events_patch', eventPath(id), { method: 'PATCH', json: content(e), notify: false });
  }

  return {
    async insert(e) {
      const id = googleEventId(e.requestId);
      const { list, hasGuests } = attendees(e, await ownerEmail());
      try {
        await call('events_insert', '', {
          method: 'POST',
          json: { id, ...content(e), ...EVENT_SETTINGS, attendees: list, status: 'confirmed' },
          notify: hasGuests,
        });
      } catch (err) {
        if (!(err instanceof GoogleApiError && err.status === 409)) throw err;
        await converge(id, e);
      }
      return { eventId: id };
    },
    patch,
    async remove(eventId) {
      try {
        await call('events_delete', `/${encodeURIComponent(eventId)}`, { method: 'DELETE', notify: true });
      } catch (err) {
        // Already gone (Jon deleted it, or a retry after Google did it): the goal is met.
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
      }
    },
    async rsvps(from) {
      // A read, but still only ever on the stored app calendar: never `primary` (T3.4 AC5).
      const target = await deps.target();
      const calendarId = assertWritableCalendar(target?.calendarId, target?.calendarId ?? null);
      const owner = (target?.ownerEmail ?? '').trim().toLowerCase();
      const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('timeMin', from.toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('maxResults', String(RSVP_LIST_MAX));
      const list = await authorized<EventList>(url, { op: 'events_list', method: 'GET' });
      return (list.items ?? [])
        .filter((ev) => ev.id && ev.status !== 'cancelled')
        .map((ev): EventRsvps => ({
          eventId: ev.id!,
          attendees: (ev.attendees ?? [])
            .filter((a) => a.email && a.email.trim().toLowerCase() !== owner)
            .map((a) => ({ email: a.email!.trim().toLowerCase(), rsvp: toGuestRsvp(a.responseStatus) })),
        }));
    },
    /**
     * T3.9.04 / TSD §C (health check): a FORCED token refresh (pr35 F9: the cached access token is dropped first,
     * so a revoked grant shows the same day) plus calendars.get on the stored app calendar, the cheapest call that
     * proves both the grant and the calendar. invalid_grant / 401 / the calendar gone (404, 410) = 'revoked';
     * 5xx, 429, timeouts and config errors (invalid_client) throw: they are not Jon's to fix.
     */
    async health(): Promise<CalendarHealth> {
      const target = await deps.target();
      if (!target) return 'not_connected';
      const calendarId = assertWritableCalendar(target.calendarId, target.calendarId);
      deps.forgetAccessToken();
      try {
        await authorized(new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`), {
          op: 'calendars_get',
          method: 'GET',
        });
        return 'ok';
      } catch (e) {
        if (isGoogleAuthFailure(e)) return 'revoked';
        if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return 'revoked';
        throw e;
      }
    },
  };
}
