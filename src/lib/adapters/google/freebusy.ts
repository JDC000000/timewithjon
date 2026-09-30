// src/lib/adapters/google/freebusy.ts — T3.5.01 (AD-6, J1): the real FreeBusySource. One read-only
// freebusy.query on settings.freebusy_calendar_ids (J1: ['primary'], Jon's personal Gmail): the ONLY call the
// app ever makes about `primary` (T3.5 AC3). The caller (availability/busy.ts) caches 10 minutes and fails open.
// - A season is ~91 days; the query is split into windows of at most 60 days, so a Google time-range limit can
//   never turn into "no busy time" (two calls per refresh).
// - A calendar-level error in the answer (notFound, a refused calendar) THROWS: an empty busy list there would
//   silently open every lunch Jon is busy for. The caller then falls back to the cache or to no filter.
// - Propagation (T0.6): an event where Jon is an attendee shows busy on primary ~30 s after the insert. That's
//   fine: locked bookings are already excluded by the database, never by this read (C3 rule 7).
import 'server-only';
import type { BusyInterval } from '@/features/availability/types';
import type { FreeBusySource } from '../types';
import { CALENDAR_API } from './oauth';
import { GoogleApiError, googleFetch } from './http';

export const FREEBUSY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export interface GoogleFreeBusyDeps {
  accessToken(): Promise<string>;
  calendarIds(): Promise<string[]>;
  forgetAccessToken(): void;
}

interface FreeBusyAnswer {
  calendars?: Record<
    string,
    { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] } | undefined
  >;
}

/** [from, to) cut into consecutive windows of at most FREEBUSY_WINDOW_MS. */
export function freeBusyWindows(from: Date, to: Date): { timeMin: Date; timeMax: Date }[] {
  const out: { timeMin: Date; timeMax: Date }[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += FREEBUSY_WINDOW_MS) {
    out.push({ timeMin: new Date(t), timeMax: new Date(Math.min(t + FREEBUSY_WINDOW_MS, to.getTime())) });
  }
  return out;
}

export function googleFreeBusySource(deps: GoogleFreeBusyDeps): FreeBusySource {
  return {
    async busy(from, to) {
      const ids = await deps.calendarIds();
      if (ids.length === 0) return [];
      const busy: BusyInterval[] = [];
      for (const w of freeBusyWindows(from, to)) {
        let answer: FreeBusyAnswer;
        try {
          answer = await googleFetch<FreeBusyAnswer>(`${CALENDAR_API}/freeBusy`, {
            op: 'freebusy_query',
            method: 'POST',
            accessToken: await deps.accessToken(),
            json: {
              timeMin: w.timeMin.toISOString(),
              timeMax: w.timeMax.toISOString(),
              items: ids.map((id) => ({ id })),
            },
          });
        } catch (e) {
          if (e instanceof GoogleApiError && e.status === 401) deps.forgetAccessToken();
          throw e;
        }
        for (const id of ids) {
          const cal = answer.calendars?.[id];
          if (!cal) throw new GoogleApiError(200, 'missing', 'freebusy_query');
          if (cal.errors?.length) {
            const reason = cal.errors[0]?.reason || 'calendar_error';
            throw new GoogleApiError(200, reason.slice(0, 40), 'freebusy_query');
          }
          for (const b of cal.busy ?? []) busy.push({ start: new Date(b.start), end: new Date(b.end) });
        }
      }
      return busy.sort((a, b) => a.start.getTime() - b.start.getTime());
    },
  };
}
