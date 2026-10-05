// T1.7 AC4, AC9 + T1.6 AC2, AC3 (server side)
import { describe, expect, it } from 'vitest';
import { dishBySlug } from '@/content/menu-helpers';
import { openWindows } from '@/features/availability';
import { baseInput, booking } from '@/features/availability/fixtures';
import { RequestBody } from '@/features/requests/schema';
import { storableBody, validateRequest } from '@/features/requests/validate';

const season = { start: '2027-04-01', end: '2027-06-30' };
const now = new Date('2027-03-10T18:00:00Z');
const body = (over: Record<string, unknown>) =>
  RequestBody.parse({
    clientKey: crypto.randomUUID(),
    name: 'Dave',
    email: 'dave@example.com',
    crew: 1,
    ...over,
  });
const engineFor = (slug: string, over = {}) =>
  openWindows(baseInput({ dishWindows: dishBySlug(slug)!.windows, ...over }));
const slotId = (date: string, w: string) => `${date}-${w}`; // fixture ids; the DB uses uuids
const bodyWithFixtureSlots = (dish: string, ids: string[], over = {}) => ({
  ...body({ dish, ...over }),
  slotIds: ids,
});

describe('validateRequest', () => {
  it('H3 refuses stand-by on a past week, even when handed a stale engine payload', () => {
    const later = new Date('2027-05-20T18:00:00Z');
    const dish = dishBySlug('the-long-lunch')!;
    const engine = engineFor('the-long-lunch', { now: later });
    const b = body({ dish: 'the-long-lunch', standbyWeek: '2027-04-05' });
    expect(validateRequest(b, dish, engine, season, later)).toEqual({
      ok: false,
      code: 'standby_not_allowed',
    });
    const stale = {
      ...engine,
      weeks: [...engine.weeks, { weekStart: '2027-04-05', state: 'spoken_for' as const, windows: [] }],
    };
    expect(validateRequest(b, dish, stale, season, later)).toEqual({
      ok: false,
      code: 'standby_not_allowed',
    });
  });
  it('accepts a Flat White with 3 open lunches', () => {
    const v = validateRequest(
      bodyWithFixtureSlots('the-flat-white', [
        slotId('2027-05-13', 'lunch'),
        slotId('2027-05-14', 'lunch'),
        slotId('2027-05-20', 'lunch'),
      ]),
      dishBySlug('the-flat-white')!,
      engineFor('the-flat-white'),
      season,
      now,
    );
    expect(v).toMatchObject({ ok: true, mode: 'slots', countsToward: 'weekly_cap', status: 'requested' });
  });
  it('AC4 rejects a full-week slot, a blocked slot, the wrong window and a pre-release slot', () => {
    const full = engineFor('the-flat-white', {
      bookings: [
        booking('2027-05-13', '19:00', '22:00', 'weekly_cap'),
        booking('2027-05-14', '19:00', '22:00', 'weekly_cap'),
      ],
    });
    expect(
      validateRequest(
        bodyWithFixtureSlots('the-flat-white', [slotId('2027-05-13', 'lunch')]),
        dishBySlug('the-flat-white')!,
        full,
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'time_gone' });
    const blocked = engineFor('the-flat-white', {
      blocks: [{ startDate: '2027-05-13', endDate: '2027-05-13', kind: 'blocked', confirmBy: null }],
    });
    expect(
      validateRequest(
        bodyWithFixtureSlots('the-flat-white', [slotId('2027-05-13', 'lunch')]),
        dishBySlug('the-flat-white')!,
        blocked,
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'time_gone' });
    expect(
      validateRequest(
        bodyWithFixtureSlots('the-flat-white', [slotId('2027-05-13', 'evening')]),
        dishBySlug('the-flat-white')!,
        engineFor('the-flat-white'),
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'time_gone' });
    const pre = engineFor('the-flat-white', { now: new Date('2027-02-01T00:00:00Z') });
    expect(
      validateRequest(
        bodyWithFixtureSlots('the-flat-white', [slotId('2027-05-13', 'lunch')]),
        dishBySlug('the-flat-white')!,
        pre,
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'time_gone' });
  });
  it('AC4 rejects a dish that is not bookable (any dish with bookable: false)', () => {
    expect(
      validateRequest(
        body({ dish: 'the-day-trip', dates: ['2027-04-10'] }),
        { ...dishBySlug('the-day-trip')!, bookable: false },
        engineFor('the-day-trip'),
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'not_bookable' });
  });
  it('AC9 crew 20 is accepted and flagged big_crew', () => {
    const v = validateRequest(
      bodyWithFixtureSlots('the-long-lunch', [slotId('2027-05-13', 'lunch')], { crew: 20 }),
      dishBySlug('the-long-lunch')!,
      engineFor('the-long-lunch'),
      season,
      now,
    );
    expect(v).toMatchObject({ ok: true, bigCrew: true });
  });
  it('T1.6 AC2 out-of-season dates are rejected; AC3 Surprise Me needs need-to-know', () => {
    expect(
      validateRequest(
        body({ dish: 'the-shore-ride', dates: ['2027-07-03'] }),
        dishBySlug('the-shore-ride')!,
        engineFor('the-shore-ride'),
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'out_of_season' });
    expect(
      validateRequest(
        bodyWithFixtureSlots('surprise-me', [slotId('2027-05-13', 'lunch')]),
        dishBySlug('surprise-me')!,
        engineFor('surprise-me'),
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'need_to_know_required' });
  });
  it('stand-by is only allowed on a spoken-for week', () => {
    const full = engineFor('the-long-lunch', {
      bookings: [
        booking('2027-05-13', '19:00', '22:00', 'weekly_cap'),
        booking('2027-05-14', '19:00', '22:00', 'weekly_cap'),
      ],
    });
    expect(
      validateRequest(
        body({ dish: 'the-long-lunch', standbyWeek: '2027-05-10' }),
        dishBySlug('the-long-lunch')!,
        full,
        season,
        now,
      ),
    ).toMatchObject({ ok: true, status: 'standby' });
    expect(
      validateRequest(
        body({ dish: 'the-long-lunch', standbyWeek: '2027-05-17' }),
        dishBySlug('the-long-lunch')!,
        full,
        season,
        now,
      ),
    ).toEqual({ ok: false, code: 'standby_not_allowed' });
  });
  it('06-F "Which night?" only rides with an overnight request', () => {
    const dish = dishBySlug('pitch-me')!;
    const engine = engineFor('pitch-me');
    const base = { dish: 'pitch-me', pitchIdea: 'Hut trip', dates: ['2027-05-15'] };
    expect(validateRequest(body({ ...base, overnightNight: 'Saturday' }), dish, engine, season, now)).toEqual(
      {
        ok: false,
        code: 'night_without_overnight',
      },
    );
    expect(
      validateRequest(
        body({ ...base, overnight: true, overnightNight: 'Saturday' }),
        dish,
        engine,
        season,
        now,
      ).ok,
    ).toBe(true);
    expect(validateRequest(body({ ...base, overnight: true }), dish, engine, season, now).ok).toBe(true);
  });
});

describe('storableBody (B012)', () => {
  it('drops a Surprise plan sent with any other dish; keeps it on Surprise Me', () => {
    const flat = body({ dish: 'the-flat-white', surprisePlan: 'a plan' });
    expect(storableBody(flat, dishBySlug('the-flat-white')!).surprisePlan).toBeUndefined();
    const surprise = body({ dish: 'surprise-me', surprisePlan: 'a plan', surpriseNeedToKnow: 'x' });
    expect(storableBody(surprise, dishBySlug('surprise-me')!).surprisePlan).toBe('a plan');
  });
});
