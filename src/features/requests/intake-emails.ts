// src/features/requests/intake-emails.ts — which emails a new request queues (§6 state machine). Pure.
//   (new) -> requested: E1 to the guest, E2 to Jon.   (new) -> standby: E6 to the guest, E2 to Jon.
// event_key per §6: E1/E2 = the request id; E6 = the triggering audit id.
import { formatInTimeZone } from 'date-fns-tz';
import { TZ, vancouverInstant } from '@/lib/time';
import { guestWhen, whenLabel } from '@/lib/when';
import { DETAIL, ROW } from '@/content/ui/admin-requests';
import { DATES, TIME_ZONE } from '@/content/ui/booking';
import { dishBySlug } from '@/content/menu-helpers';
import { manageLink } from '@/features/email/link-vars';
import type { EmailArgs } from '@/features/email/send';

export interface IntakeEmailInput {
  requestId: string;
  auditId: string;
  status: 'requested' | 'standby';
  dishName: string;
  guestEmail: string;
  guestName: string;
  crew: number;
  choiceCount: number;
  /** What the choices are: picked times (slots mode) or dates (dates mode), for E2's count (QA r2 L3). */
  choiceKind: 'times' | 'dates';
  /** The guest ticked "It’s one night away" (QA4 M1: E2 says so, in the guest's own words). */
  overnight: boolean;
  /** The dish (a Pitch Me request with nothing to list gets its own E1 wording, r6 Q3c). */
  dishSlug?: string;
  /** E2's details for Jon (Q5, DEV6 follow-up): see jonDetails. Absent (Not spam's E2) = the counts. */
  jon?: JonDetails;
  standbyWeek: string | null;
  /** E1: the requested times (slots mode) or dates (dates mode), one line each; see requestedTimeLines. */
  requestedTimes: string[];
  jonEmail: string;
  siteUrl: string;
}

/** What Jon's E2 shows besides the crew: the actual times or dates, the guest's rough window, the night, the zone. */
export interface JonDetails {
  /** Vancouver time, as the admin writes it ("Fri May 14 · noon–2 pm", "Sat May 8"), in order. */
  times: string[];
  windowText: string | null;
  overnightNight: string | null;
  guestTimeZone: string | null;
}

/** E2's details from the request body as sent (create.ts). */
export function jonDetails(
  b: { windowText?: string; overnightNight?: string; guestTimeZone?: string },
  slots: { startsAt: Date; endsAt: Date }[],
  dates: string[],
): JonDetails {
  return {
    times: [
      ...[...slots]
        .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime())
        .map((s) => whenLabel(s.startsAt, s.endsAt)),
      ...[...dates].sort().map((d) => formatInTimeZone(vancouverInstant(d, '12:00'), TZ, 'EEE MMM d')),
    ],
    windowText: b.windowText?.trim() || null,
    overnightNight: b.overnightNight?.trim() || null,
    guestTimeZone: b.guestTimeZone && b.guestTimeZone !== TZ ? b.guestTimeZone : null,
  };
}

const zoneName = (zone: string) =>
  TIME_ZONE.options.find((o) => o.value === zone)?.label ?? zone.replace(/_/g, ' ');

/**
 * E2's {summary}: "Crew 2. Fri May 14 · noon–2 pm, Thu May 20 · noon–2 pm." (Q5, approved: Jon 2026-10-09: the
 * times, not "2 times"), then the guest's own rough window in quotes, "It’s one night away" with their "Which
 * night?" answer, and a Long Distance guest's time zone (DEV6 follow-up). Without details, the counts (QA r2 L3).
 */
function choicesLine(i: IntakeEmailInput): string {
  const j = i.jon;
  const parts: string[] = [];
  if (j?.times.length) parts.push(`${j.times.join(', ')}.`);
  if (j?.windowText) parts.push(`“${j.windowText}”.`);
  if (!parts.length) parts.push(`${ROW[i.choiceKind](i.choiceCount)}.`);
  if (i.overnight) parts.push(`${DATES.oneNight}${j?.overnightNight ? ` (“${j.overnightNight}”)` : ''}.`);
  if (j?.guestTimeZone) parts.push(`${DETAIL.labels.zone}: ${zoneName(j.guestTimeZone)}.`);
  return parts.join(' ');
}

export function standbyWeekLabel(weekStart: string): string {
  return formatInTimeZone(vancouverInstant(weekStart, '12:00'), TZ, 'MMMM d');
}

/**
 * E1's list (Jon option A): each chosen slot as the site writes it, "Thu Oct 1 · noon–2 pm" (QA C: guestWhen, with
 * the guest's own zone when it differs), and in dates mode each date as "Thu Oct 1" with no time.
 */
export function requestedTimeLines(
  slots: { startsAt: Date; endsAt: Date }[],
  dates: string[],
  guestTimeZone: string | null,
): string[] {
  return [
    ...[...slots]
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .map((s) => guestWhen(s.startsAt, s.endsAt, guestTimeZone)),
    ...[...dates].sort().map((d) => formatInTimeZone(vancouverInstant(d, '12:00'), TZ, 'EEE MMM d')),
  ];
}

export function intakeEmails(i: IntakeEmailInput): EmailArgs[] {
  const guest: EmailArgs =
    i.status === 'standby'
      ? {
          template: 'E6',
          to: i.guestEmail,
          requestId: i.requestId,
          eventKey: i.auditId,
          vars: { week: standbyWeekLabel(i.standbyWeek!), manageLink: manageLink(i.requestId) }, // r6 Q4
        }
      : {
          template: 'E1',
          to: i.guestEmail,
          requestId: i.requestId,
          eventKey: i.requestId,
          // UX-09 / F20: E1 carries the manage link too, a "Change or cancel" button.
          vars: {
            dish: i.dishName,
            times: i.requestedTimes.join('\n'),
            manageLink: manageLink(i.requestId),
            // r6 Q3c: a pitch with only a rough window has nothing to list: "Email me your idea, or let’s talk."
            ...(i.dishSlug && dishBySlug(i.dishSlug)?.flow === 'pitch' && i.requestedTimes.length === 0
              ? { pitchWindowOnly: 1 }
              : {}),
          },
        };
  const summary = `Crew ${i.crew}. ${
    i.status === 'standby' ? `Stand-by, week of ${standbyWeekLabel(i.standbyWeek!)}.` : choicesLine(i)
  }`;
  const jon: EmailArgs = {
    template: 'E2',
    to: i.jonEmail,
    requestId: i.requestId,
    eventKey: i.requestId,
    vars: {
      dish: i.dishName,
      name: i.guestName,
      summary,
      adminLink: `${i.siteUrl}/admin/requests/${i.requestId}`,
    },
  };
  return [guest, jon];
}
