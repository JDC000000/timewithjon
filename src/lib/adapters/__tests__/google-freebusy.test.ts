// T3.5.01: the Google FreeBusySource against the fake Google: J1 ids only, ≤60-day windows, calendar-level
// errors throw (the caller fails open), 401 drops the cached token, and no call writes anything (T3.5 AC3).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGoogle } from '../../../../tests/fixtures/fake-google';
import { FREEBUSY_WINDOW_MS, freeBusyWindows, googleFreeBusySource } from '../google/freebusy';
import { GoogleApiError } from '../google/http';

let google: ReturnType<typeof fakeGoogle>;
let ids: string[];
const forget = vi.fn();
const source = () =>
  googleFreeBusySource({
    accessToken: async () => 'at-1',
    calendarIds: async () => ids,
    forgetAccessToken: forget,
  });
const SEASON = [new Date('2027-04-01T07:00:00Z'), new Date('2027-07-01T07:00:00Z')] as const;

beforeEach(() => {
  google = fakeGoogle();
  ids = ['primary'];
  forget.mockReset();
  vi.stubGlobal('fetch', google.fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('freeBusyWindows', () => {
  it('cuts a season into consecutive windows of at most 60 days, covering it exactly', () => {
    const w = freeBusyWindows(...SEASON);
    expect(w).toHaveLength(2);
    expect(w[0]!.timeMin).toEqual(SEASON[0]);
    expect(w[0]!.timeMax.getTime() - w[0]!.timeMin.getTime()).toBe(FREEBUSY_WINDOW_MS);
    expect(w[1]!.timeMin).toEqual(w[0]!.timeMax);
    expect(w[1]!.timeMax).toEqual(SEASON[1]);
  });
  it('one window for a short range; none for an empty one', () => {
    const a = new Date('2027-05-13T00:00:00Z');
    expect(freeBusyWindows(a, new Date(a.getTime() + 1000))).toHaveLength(1);
    expect(freeBusyWindows(a, a)).toEqual([]);
  });
});

describe('googleFreeBusySource', () => {
  it('returns primary busy time from every window, sorted, as Dates (J1)', async () => {
    google.state.busy.set('primary', [
      { start: '2027-06-20T19:30:00Z', end: '2027-06-20T20:30:00Z' },
      { start: '2027-05-13T19:30:00Z', end: '2027-05-13T20:30:00Z' },
    ]);
    const busy = await source().busy(...SEASON);
    expect(busy).toEqual([
      { start: new Date('2027-05-13T19:30:00Z'), end: new Date('2027-05-13T20:30:00Z') },
      { start: new Date('2027-06-20T19:30:00Z'), end: new Date('2027-06-20T20:30:00Z') },
    ]);
    expect(google.calls).toHaveLength(2);
    for (const c of google.calls) {
      expect(c.method).toBe('POST');
      expect(c.url.pathname).toBe('/calendar/v3/freeBusy');
      expect(c.auth).toBe('Bearer at-1');
      expect((JSON.parse(c.body) as { items: unknown }).items).toEqual([{ id: 'primary' }]);
    }
  });

  it('asks only for the configured ids; none configured = no call, no busy time', async () => {
    ids = [];
    expect(await source().busy(...SEASON)).toEqual([]);
    expect(google.calls).toHaveLength(0);
  });

  it('a calendar-level error throws instead of reading as "free"', async () => {
    ids = ['primary', 'gone@group.calendar.google.com'];
    await expect(source().busy(...SEASON)).rejects.toMatchObject({
      name: 'GoogleApiError',
      reason: 'notFound',
    });
  });

  it('an error entry without a reason still throws (never read as free)', async () => {
    google.state.overrides.push(() => ({
      status: 200,
      json: { calendars: { primary: { busy: [], errors: [{ domain: 'global' }] } } },
    }));
    await expect(source().busy(...SEASON)).rejects.toMatchObject({ reason: 'calendar_error' });
  });

  it('busy time from several calendars comes back in start order', async () => {
    ids = ['primary', 'other@group.calendar.google.com'];
    google.state.busy.set('primary', [{ start: '2027-05-20T19:00:00Z', end: '2027-05-20T20:00:00Z' }]);
    google.state.busy.set('other@group.calendar.google.com', [
      { start: '2027-05-13T19:00:00Z', end: '2027-05-13T20:00:00Z' },
    ]);
    const busy = await source().busy(...SEASON);
    expect(busy.map((b) => b.start.toISOString())).toEqual([
      '2027-05-13T19:00:00.000Z',
      '2027-05-20T19:00:00.000Z',
    ]);
  });

  it('a calendar missing from the answer throws too', async () => {
    google.state.overrides.push(() => ({ status: 200, json: { calendars: {} } }));
    await expect(source().busy(...SEASON)).rejects.toMatchObject({ reason: 'missing' });
  });

  it('a 401 drops the cached access token and rethrows; other failures keep it', async () => {
    google.state.overrides.push(() => ({ status: 401, json: { error: { status: 'UNAUTHENTICATED' } } }));
    await expect(source().busy(...SEASON)).rejects.toBeInstanceOf(GoogleApiError);
    expect(forget).toHaveBeenCalledTimes(1);
    google.state.overrides.length = 0;
    google.state.overrides.push(() => ({ status: 503, json: {} }));
    await expect(source().busy(...SEASON)).rejects.toMatchObject({ status: 503 });
    expect(forget).toHaveBeenCalledTimes(1);
  });
});
