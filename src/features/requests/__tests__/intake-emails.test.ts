// H4: §6 state machine — (new) -> requested sends E1 + E2; (new) -> standby sends E6 + E2, never E1.
import { describe, expect, it } from 'vitest';
import { intakeEmails, jonDetails, requestedTimeLines } from '@/features/requests/intake-emails';
import { vancouverInstant } from '@/lib/time';

const base = {
  requestId: 'req-1',
  auditId: 'audit-1',
  dishName: 'The Long Lunch',
  guestEmail: 'dave@example.com',
  guestName: 'Dave',
  crew: 2,
  bigCrew: false,
  choiceCount: 2,
  choiceKind: 'times' as const,
  overnight: false,
  standbyWeek: null,
  requestedTimes: ['Thu Oct 1, 12:00 pm', 'Sat Oct 3, 6:00 pm'],
  jonEmail: 'jon@example.com',
  siteUrl: 'https://timewithjon.com',
};

describe('intakeEmails', () => {
  it('a request sends E1 (keyed on the request) and E2', () => {
    const [g, j] = intakeEmails({ ...base, status: 'requested' });
    expect(g).toMatchObject({ template: 'E1', to: 'dave@example.com', eventKey: 'req-1' });
    expect(j).toMatchObject({ template: 'E2', to: 'jon@example.com', eventKey: 'req-1' });
    expect(g!.vars.times).toBe('Thu Oct 1, 12:00 pm\nSat Oct 3, 6:00 pm'); // Jon option A
  });
  it('stand-by sends E6 (keyed on the audit id, with the week) and E2, never E1', () => {
    const emails = intakeEmails({ ...base, status: 'standby', standbyWeek: '2027-05-10', choiceCount: 0 });
    expect(emails.map((e) => e.template)).toEqual(['E6', 'E2']);
    expect(emails[0]).toMatchObject({ eventKey: 'audit-1', vars: { week: 'May 10' } });
    expect(String(emails[1]!.vars.summary)).toContain('Stand-by, week of May 10.');
  });
});

describe('E2 summary counts (QA r2 L3)', () => {
  const summary = (choiceCount: number, choiceKind: 'times' | 'dates') =>
    String(intakeEmails({ ...base, status: 'requested', choiceCount, choiceKind })[1]!.vars.summary);
  it('says "1 time" / "2 times", and "1 date" / "2 dates" for a date dish; never "time(s)"', () => {
    expect(summary(1, 'times')).toBe('Crew 2. 1 time.');
    expect(summary(2, 'times')).toBe('Crew 2. 2 times.');
    expect(summary(1, 'dates')).toBe('Crew 2. 1 date.');
    expect(summary(2, 'dates')).toBe('Crew 2. 2 dates.');
  });
  it('QA4 M1: an overnight request tells Jon, in the guest’s own words', () => {
    const e2 = intakeEmails({ ...base, status: 'requested', choiceKind: 'dates', overnight: true })[1]!;
    expect(e2.vars.summary).toBe('Crew 2. 2 dates. It’s one night away.');
  });
});

describe('requestedTimeLines (E1 lists the requested times, Jon option A; as the site writes them, QA C)', () => {
  const HOUR = 3_600_000;
  const at = (iso: string, hours: number) => ({
    startsAt: new Date(iso),
    endsAt: new Date(Date.parse(iso) + hours * HOUR),
  });
  const noon = at('2026-10-01T19:00:00Z', 2); // Thu Oct 1, noon–2 pm Vancouver (PDT): a lunch
  const eve = at('2026-10-04T02:00:00Z', 3); // Sat Oct 3, 7–10 pm Vancouver: an evening
  it('slots: in order, Vancouver time when the guest has no zone', () => {
    expect(requestedTimeLines([eve, noon], [], null)).toEqual([
      'Thu Oct 1 · noon–2 pm Vancouver time',
      'Sat Oct 3 · 7 pm Vancouver time',
    ]);
  });
  it('slots: with the guest’s own zone when it differs', () => {
    expect(requestedTimeLines([noon], [], 'America/Toronto')).toEqual([
      'Thu Oct 1 · noon–2 pm Vancouver time (3–5 pm your time)',
    ]);
  });
  it('an unknown zone falls back to Vancouver', () => {
    expect(requestedTimeLines([noon], [], 'Not/AZone')).toEqual(['Thu Oct 1 · noon–2 pm Vancouver time']);
  });
  it('dates mode: the dates, no times', () => {
    expect(requestedTimeLines([], ['2026-10-03', '2026-10-01'], 'Europe/London')).toEqual([
      'Thu Oct 1',
      'Sat Oct 3',
    ]);
  });
});

describe('E2 details for Jon (Q5, approved: Jon 2026-10-09; DEV6 follow-up)', () => {
  const at = (date: string, time: string) => vancouverInstant(date, time);
  const e2 = (over: Partial<Parameters<typeof intakeEmails>[0]>) =>
    String(intakeEmails({ ...base, status: 'requested', ...over })[1]!.vars.summary);
  const lunch = { startsAt: at('2027-05-14', '12:00'), endsAt: at('2027-05-14', '14:00') };
  const lunch2 = { startsAt: at('2027-05-20', '12:00'), endsAt: at('2027-05-20', '14:00') };

  it('lists the actual times (Vancouver, in order), not "2 times"', () => {
    expect(e2({ jon: jonDetails({}, [lunch2, lunch], []) })).toBe(
      'Crew 2. Fri May 14 · noon–2 pm, Thu May 20 · noon–2 pm.',
    );
  });
  it('a date dish: its dates and the guest’s rough window; a window-only request no longer reads "0 dates."', () => {
    expect(
      e2({
        choiceKind: 'dates',
        jon: jonDetails({ windowText: 'sometime in May' }, [], ['2027-05-09', '2027-05-08']),
      }),
    ).toBe('Crew 2. Sat May 8, Sun May 9. “sometime in May”.');
    expect(
      e2({
        choiceKind: 'dates',
        choiceCount: 0,
        jon: jonDetails({ windowText: 'any Saturday in June' }, [], []),
      }),
    ).toBe('Crew 2. “any Saturday in June”.');
  });
  it('one night away with the guest’s “Which night?” answer, and a Long Distance guest’s time zone', () => {
    expect(
      e2({
        choiceKind: 'dates',
        overnight: true,
        jon: jonDetails(
          { overnightNight: 'the Saturday', guestTimeZone: 'Europe/London' },
          [],
          ['2027-05-08'],
        ),
      }),
    ).toMatch(/^Crew 2\. Sat May 8\. It’s one night away \(“the Saturday”\)\. Time zone: .*London.*\.$/);
    // Vancouver (or no zone) is not worth a line.
    expect(e2({ jon: jonDetails({ guestTimeZone: 'America/Vancouver' }, [lunch], []) })).toBe(
      'Crew 2. Fri May 14 · noon–2 pm.',
    );
  });
  it('without details (Not spam’s E2) it keeps the counts', () => {
    expect(e2({})).toBe('Crew 2. 2 times.');
  });
});
