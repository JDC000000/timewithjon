// src/lib/engine/__tests__/windows.test.ts — T0.5 AC 1–3, 5–9, 11–16, 18–20, 24–27
import { describe, expect, it } from 'vitest';
import { openWindows } from '@/features/availability';
import { baseInput, booking, DEFAULT_SETTINGS } from '@/features/availability/fixtures';
import { vancouverInstant } from '@/lib/time';

const allWindows = (o: ReturnType<typeof openWindows>) => o.weeks.flatMap((w) => w.windows);
const week = (o: ReturnType<typeof openWindows>, ws: string) => o.weeks.find((w) => w.weekStart === ws)!;
const has = (o: ReturnType<typeof openWindows>, date: string, win: 'lunch' | 'evening') =>
  allWindows(o).some((w) => w.date === date && w.window === win);

describe('C3 openWindows', () => {
  it('H3 omits past weeks (never spoken_for, so never stand-by) and keeps a part-past week', () => {
    const now = new Date('2027-05-20T18:00:00Z'); // Thu May 20, 11:00 in Vancouver
    const o = openWindows(baseInput({ now }));
    expect(o.weeks.find((w) => w.weekStart === '2027-04-05')).toBeUndefined();
    expect(o.weeks.map((w) => w.weekStart)[0]).toBe('2027-05-17');
    expect(o.weeks.some((w) => w.state === 'spoken_for')).toBe(false);
    expect(has(o, '2027-05-20', 'lunch')).toBe(true); // 12:00 hasn't started yet
  });
  it('AC1 empty season (hold released) gives 52 windows', () => {
    const i = baseInput();
    i.settings.householdHoldReleased = true;
    expect(allWindows(openWindows(i))).toHaveLength(52);
  });
  it('AC2 after 2 weekly_cap locks the week is spoken_for with 0 windows', () => {
    const o = openWindows(
      baseInput({
        bookings: [
          booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
          booking('2027-05-14', '19:00', '22:00', 'weekly_cap'),
        ],
      }),
    );
    expect(week(o, '2027-05-10')).toMatchObject({ state: 'spoken_for', windows: [] });
  });
  it('AC3 cap override 3 keeps the week open until the third lock', () => {
    const i = baseInput({
      bookings: [
        booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
        booking('2027-05-14', '19:00', '22:00', 'weekly_cap'),
      ],
    });
    i.weeks.find((w) => w.weekStart === '2027-05-10')!.capOverride = 3;
    expect(week(openWindows(i), '2027-05-10').state).toBe('open');
    i.bookings.push(booking('2027-05-13', '19:00', '22:00', 'weekly_cap'));
    expect(week(openWindows(i), '2027-05-10').state).toBe('spoken_for');
  });
  it('AC5 a Friday May 14 Big Day removes both Friday windows and does not use the cap', () => {
    const o = openWindows(baseInput({ bookings: [booking('2027-05-14', '09:00', '13:00', 'big_day')] }));
    expect(has(o, '2027-05-14', 'lunch')).toBe(false);
    expect(has(o, '2027-05-14', 'evening')).toBe(false);
    expect(has(o, '2027-05-13', 'lunch') && has(o, '2027-05-13', 'evening')).toBe(true);
  });
  it('AC6 household hold hides Apr 1 lunch until released', () => {
    const i = baseInput();
    expect(has(openWindows(i), '2027-04-01', 'lunch')).toBe(false);
    i.settings.householdHoldReleased = true;
    expect(has(openWindows(i), '2027-04-01', 'lunch')).toBe(true);
  });
  it('AC7 away Apr 26 – May 3 hides windows and returns awayNotice', () => {
    const o = openWindows(
      baseInput({
        blocks: [{ startDate: '2027-04-26', endDate: '2027-05-03', kind: 'away', confirmBy: '2027-05-05' }],
      }),
    );
    expect(week(o, '2027-04-26')).toMatchObject({ state: 'away', windows: [] });
    expect(o.awayNotice).toEqual({ until: '2027-05-03', confirmBy: '2027-05-05' });
    expect(week(o, '2027-05-03').state).toBe('open');
  });
  it('AC8 before release: opensAt, no windows; personal and general differ', () => {
    const now = new Date('2027-02-27T18:00:00Z');
    const g = openWindows(baseInput({ now, inviteKind: 'general' }));
    const p = openWindows(baseInput({ now, inviteKind: 'personal' }));
    expect(g.opensAt).toBe('2027-03-01T16:00:00.000Z');
    expect(g.weeks.every((w) => w.state === 'closed' && w.windows.length === 0)).toBe(true);
    expect(p.opensAt).toBeUndefined();
    expect(allWindows(p).length).toBeGreaterThan(0);
  });
  it('AC9 a 12:30–13:00 busy block on the main calendar hides that lunch', () => {
    const o = openWindows(
      baseInput({
        busy: [
          { start: vancouverInstant('2027-05-13', '12:30'), end: vancouverInstant('2027-05-13', '13:00') },
        ],
      }),
    );
    expect(has(o, '2027-05-13', 'lunch')).toBe(false);
    expect(has(o, '2027-05-13', 'evening')).toBe(true);
  });
  it('AC11 The Long Distance never counts toward the cap', () => {
    const o = openWindows(
      baseInput({
        bookings: [
          booking('2027-05-11', '10:00', '10:45', 'none'),
          booking('2027-05-12', '10:00', '10:45', 'none'),
          booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
        ],
      }),
    );
    expect(week(o, '2027-05-10').state).toBe('open');
  });
  it('AC12 payload has no cap/count/remaining keys', () => {
    const o = openWindows(baseInput({ bookings: [booking('2027-05-13', '12:00', '14:00', 'weekly_cap')] }));
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          keys.push(k);
          walk(x);
        }
    };
    walk(o);
    expect(keys.filter((k) => /cap|count|remaining/i.test(k))).toEqual([]);
  });
  it('AC13 window labels read 12:00 or 19:00 local', () => {
    const i = baseInput();
    i.settings.householdHoldReleased = true;
    for (const w of allWindows(openWindows(i)))
      expect(w.label).toMatch(w.window === 'lunch' ? /, 12:00$/ : /, 19:00$/);
  });
  it('AC14 Encore locks count toward the show date week cap', () => {
    const o = openWindows(
      baseInput({
        bookings: [
          booking('2027-05-11', '19:30', '23:00', 'weekly_cap'),
          booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
        ],
      }),
    );
    expect(week(o, '2027-05-10').state).toBe('spoken_for');
  });
  it('AC15 an Encore locked Thu 19:00–22:00 hides that Thursday evening', () => {
    const o = openWindows(baseInput({ bookings: [booking('2027-05-13', '19:00', '22:00', 'weekly_cap')] }));
    expect(has(o, '2027-05-13', 'evening')).toBe(false);
  });
  it('AC16 a Long Distance call Fri 12:30–13:15 hides Friday lunch', () => {
    const o = openWindows(baseInput({ bookings: [booking('2027-05-14', '12:30', '13:15', 'none')] }));
    expect(has(o, '2027-05-14', 'lunch')).toBe(false);
  });
  it('AC18 a live standby_open offer hides its window from everyone else', () => {
    const offer = {
      id: 'o1',
      requestId: 'rX',
      kind: 'standby_open' as const,
      slotIds: ['2027-05-13-lunch'],
      ranges: [],
      expiresAt: new Date('2027-05-12T00:00:00Z'),
      takenAt: null,
      releasedAt: null,
    };
    const now = new Date('2027-05-10T18:00:00Z');
    expect(has(openWindows(baseInput({ now, offers: [offer] })), '2027-05-13', 'lunch')).toBe(false);
    expect(
      has(openWindows(baseInput({ now, offers: [offer], viewerRequestId: 'rX' })), '2027-05-13', 'lunch'),
    ).toBe(true);
    expect(
      has(
        openWindows(baseInput({ now: new Date('2027-05-12T01:00:00Z'), offers: [offer] })),
        '2027-05-13',
        'lunch',
      ),
    ).toBe(true); // expired
  });
  it('AC19 default general_open_at is 2027-03-01T16:00Z', () => {
    expect(DEFAULT_SETTINGS.generalOpenAt.toISOString()).toBe('2027-03-01T16:00:00.000Z');
  });
  it('AC20 1 done + 1 locked weekly_cap booking makes the week spoken for', () => {
    const now = new Date('2027-05-13T23:00:00Z'); // Thu lunch is done
    const o = openWindows(
      baseInput({
        now,
        bookings: [
          booking('2027-05-13', '12:00', '14:00', 'weekly_cap'),
          booking('2027-05-14', '12:00', '14:00', 'weekly_cap'),
        ],
      }),
    );
    expect(week(o, '2027-05-10').state).toBe('spoken_for');
  });
  it('AC24 First Round spoken_for (1 locked evening + other evening busy); Surprise Me open', () => {
    const over = {
      bookings: [booking('2027-05-13', '19:00', '22:00', 'weekly_cap')],
      busy: [
        { start: vancouverInstant('2027-05-14', '18:00'), end: vancouverInstant('2027-05-14', '23:00') },
      ],
    };
    expect(week(openWindows(baseInput({ ...over, dishWindows: ['evening'] })), '2027-05-10').state).toBe(
      'spoken_for',
    );
    expect(
      week(openWindows(baseInput({ ...over, dishWindows: ['lunch', 'evening'] })), '2027-05-10').state,
    ).toBe('open');
  });
  it('AC25 a week inside an away block is away; before release it is closed', () => {
    const blocks = [
      { startDate: '2027-05-10', endDate: '2027-05-16', kind: 'away' as const, confirmBy: null },
    ];
    expect(week(openWindows(baseInput({ blocks })), '2027-05-10').state).toBe('away');
    expect(
      week(openWindows(baseInput({ blocks, now: new Date('2027-02-01T00:00:00Z') })), '2027-05-10').state,
    ).toBe('closed');
  });
  it('AC26 unavailableDates has blocked and away dates, never booking-only dates', () => {
    const o = openWindows(
      baseInput({
        blocks: [
          { startDate: '2027-05-20', endDate: '2027-05-21', kind: 'blocked', confirmBy: null },
          { startDate: '2027-06-01', endDate: '2027-06-01', kind: 'away', confirmBy: null },
        ],
        bookings: [booking('2027-05-29', '09:00', '15:00', 'big_day')],
      }),
    );
    expect(o.unavailableDates).toEqual(expect.arrayContaining(['2027-05-20', '2027-05-21', '2027-06-01']));
    expect(o.unavailableDates).not.toContain('2027-05-29');
  });
  it('AC27 a joined request neither counts nor occupies a range', () => {
    const o = openWindows(
      baseInput({
        bookings: [
          booking('2027-05-13', '12:00', '14:00', 'weekly_cap', { joinedToRequestId: 'host' }),
          booking('2027-05-14', '12:00', '14:00', 'weekly_cap', { joinedToRequestId: 'host' }),
        ],
      }),
    );
    expect(has(o, '2027-05-13', 'lunch')).toBe(true);
    expect(week(o, '2027-05-10').state).toBe('open');
  });
});
