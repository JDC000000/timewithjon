// src/features/admin/busy-markers.ts — T3.5.02: the A4 "Busy on main calendar" markers (TSD T3.5, C3 rule 7).
// Pure. Jon's main-calendar busy time (the cached freebusy read, J1) clipped to one season week, MINUS the app's
// own locked bookings: J2 puts every booking on his primary calendar through the attendee copy, so without this
// each booking would come back as a marker on itself. Google merges adjacent busy time, so a booking next to a
// real event leaves just the event's part. What's left is time taken by something else on his calendar.
import type { BusyInterval } from '@/features/availability/types';

export interface BusyMarker {
  startsAt: string;
  endsAt: string;
}

/** `a` minus `b`: zero, one or two pieces. */
function subtract(a: BusyInterval, b: BusyInterval): BusyInterval[] {
  if (b.end <= a.start || b.start >= a.end) return [a];
  const out: BusyInterval[] = [];
  if (b.start > a.start) out.push({ start: a.start, end: b.start });
  if (b.end < a.end) out.push({ start: b.end, end: a.end });
  return out;
}

export function busyMarkers(
  busy: readonly BusyInterval[],
  ownBookings: readonly BusyInterval[],
  weekFrom: Date,
  weekTo: Date,
): BusyMarker[] {
  let pieces: BusyInterval[] = busy
    .map((b) => ({
      start: new Date(Math.max(b.start.getTime(), weekFrom.getTime())),
      end: new Date(Math.min(b.end.getTime(), weekTo.getTime())),
    }))
    .filter((b) => b.start < b.end);
  for (const own of ownBookings) pieces = pieces.flatMap((p) => subtract(p, own));
  return pieces
    .sort((x, y) => x.start.getTime() - y.start.getTime())
    .map((p) => ({ startsAt: p.start.toISOString(), endsAt: p.end.toISOString() }));
}
