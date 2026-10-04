// src/features/requests/intake-emails.ts — which emails a new request queues (§6 state machine). Pure.
//   (new) -> requested: E1 to the guest, E2 to Jon.   (new) -> standby: E6 to the guest, E2 to Jon.
// event_key per §6: E1/E2 = the request id; E6 = the triggering audit id.
import { formatInTimeZone } from 'date-fns-tz';
import { TZ, vancouverInstant } from '@/lib/time';
import { guestWhen } from '@/lib/when';
import { ROW } from '@/content/ui/admin-requests';
import type { EmailArgs } from '@/features/email/send';

export interface IntakeEmailInput {
  requestId: string;
  auditId: string;
  status: 'requested' | 'standby';
  dishName: string;
  guestEmail: string;
  guestName: string;
  crew: number;
  bigCrew: boolean;
  choiceCount: number;
  /** What the choices are: picked times (slots mode) or dates (dates mode), for E2's count (QA r2 L3). */
  choiceKind: 'times' | 'dates';
  standbyWeek: string | null;
  /** E1: the requested times (slots mode) or dates (dates mode), one line each; see requestedTimeLines. */
  requestedTimes: string[];
  jonEmail: string;
  siteUrl: string;
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
          vars: { week: standbyWeekLabel(i.standbyWeek!) },
        }
      : {
          template: 'E1',
          to: i.guestEmail,
          requestId: i.requestId,
          eventKey: i.requestId,
          vars: { dish: i.dishName, times: i.requestedTimes.join('\n') },
        };
  const summary = `Crew ${i.crew}${i.bigCrew ? ' (big crew)' : ''}. ${
    i.status === 'standby'
      ? `Stand-by, week of ${standbyWeekLabel(i.standbyWeek!)}.`
      : `${ROW[i.choiceKind](i.choiceCount)}.`
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
