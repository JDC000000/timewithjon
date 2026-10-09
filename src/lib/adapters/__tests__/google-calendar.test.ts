// T3.4.01/.02: the Google CalendarGateway against the fake Google: deterministic ids, 409 → patch back to
// confirmed, attendee-less events, deletes, the write guard, and "no call ever targets primary" (T3.4 AC5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeGoogle } from '../../../../tests/fixtures/fake-google';
import {
  assertWritableCalendar,
  CalendarWriteGuardError,
  googleCalendarGateway,
  googleEventId,
} from '../google/calendar';
import { GoogleApiError } from '../google/http';
import { GOOGLE_RESPONSE_STATUSES } from '../google/rsvp';
import type { CalendarEvent } from '../types';

/** Google's raw 'no' answer: only rsvp.ts may spell it out (TSD v1.9 §9). */
const GOOGLE_NO = GOOGLE_RESPONSE_STATUSES[2];

const CAL = 'abc123@group.calendar.google.com';
const JON = 'jon@example.com'; // the connected account (J2, pr39 F2)
const REQ = '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31';
const EVENT_ID = '0b9f6a521c3e4f7a9d2b6e8c1a0f4d31';
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  requestId: REQ,
  summary: 'The Shore Ride: Sam',
  description: 'Crew: 2',
  startsAt: new Date('2027-05-13T19:30:00Z'),
  endsAt: new Date('2027-05-13T21:30:00Z'),
  attendees: ['sam@example.com'],
  ...over,
});

let google: ReturnType<typeof fakeGoogle>;
let stored: string | null;
const forget = vi.fn();
const gateway = () =>
  googleCalendarGateway({
    accessToken: async () => 'at-1',
    target: async () => ({ calendarId: stored, ownerEmail: 'Jon@Example.com' }),
    forgetAccessToken: forget,
  });
const stored_ = () => google.events.get(`${CAL}/${EVENT_ID}`) as Record<string, unknown> | undefined;
const writes = () =>
  google.calls.map(
    (c) => `${c.method} ${decodeURIComponent(c.url.pathname)} ${c.url.searchParams.get('sendUpdates')}`,
  );

beforeEach(() => {
  google = fakeGoogle();
  google.calendars.set(CAL, { summary: 'Time with Jon', timeZone: 'America/Vancouver' });
  stored = CAL;
  forget.mockReset();
  vi.stubGlobal('fetch', google.fetch);
});
afterEach(() => {
  expect(google.calls.some((c) => /\/calendars\/primary\b/i.test(c.url.pathname))).toBe(false);
  vi.unstubAllGlobals();
});

describe('GoogleCalendarGateway', () => {
  it('the event id is the request id without hyphens (32 base32hex chars)', () => {
    expect(googleEventId(REQ)).toBe(EVENT_ID);
    expect(googleEventId(REQ.toUpperCase())).toMatch(/^[0-9a-v]{32}$/);
  });

  it('insert: the guest plus Jon (accepted), Vancouver times, guests hidden from each other, sendUpdates=all', async () => {
    expect(await gateway().insert(event())).toEqual({ eventId: EVENT_ID });
    expect(writes()).toEqual([`POST /calendar/v3/calendars/${CAL}/events all`]);
    expect(google.calls[0]?.auth).toBe('Bearer at-1');
    expect(stored_()).toMatchObject({
      id: EVENT_ID,
      status: 'confirmed',
      summary: 'The Shore Ride: Sam',
      description: 'Crew: 2',
      start: { dateTime: '2027-05-13T19:30:00.000Z', timeZone: 'America/Vancouver' },
      end: { dateTime: '2027-05-13T21:30:00.000Z', timeZone: 'America/Vancouver' },
      attendees: [{ email: 'sam@example.com' }, { email: JON, responseStatus: 'accepted' }],
      transparency: 'opaque',
      guestsCanSeeOtherGuests: false,
      guestsCanInviteOthers: false,
      guestsCanModify: false,
    });
    expect(stored_()).not.toHaveProperty('hasGuests');
  });

  it('pr39 F3: insert again after a lost answer: GET, then a silent patch (the guest already has the invite)', async () => {
    await gateway().insert(event());
    await gateway().insert(
      event({ startsAt: new Date('2027-05-14T19:30:00Z'), endsAt: new Date('2027-05-14T21:00:00Z') }),
    );
    expect(writes()).toEqual([
      `POST /calendar/v3/calendars/${CAL}/events all`,
      `POST /calendar/v3/calendars/${CAL}/events all`,
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} none`,
    ]);
    expect(google.events.size).toBe(1);
    expect(stored_()).toMatchObject({ status: 'confirmed', start: { dateTime: '2027-05-14T19:30:00.000Z' } });
    expect(JSON.parse(google.calls.at(-1)!.body)).not.toHaveProperty('status');
  });

  it('pr39 F3: re-lock after a cancel: the cancelled event comes back confirmed, a real re-invite (all)', async () => {
    await gateway().insert(event());
    await gateway().remove(EVENT_ID);
    expect(stored_()?.status).toBe('cancelled');
    await gateway().insert(
      event({ summary: 'The Shore Ride: Sam (again)', attendees: ['sam2@example.com'] }),
    );
    expect(writes().slice(-2)).toEqual([
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`,
    ]);
    expect(stored_()).toMatchObject({
      status: 'confirmed',
      summary: 'The Shore Ride: Sam (again)',
      attendees: [{ email: 'sam2@example.com' }, { email: JON, responseStatus: 'accepted' }],
      guestsCanSeeOtherGuests: false,
    });
  });

  it('pr39 F1: a plain patch never revives a cancelled event (a stale reschedule after a cancel)', async () => {
    await gateway().insert(event());
    await gateway().remove(EVENT_ID);
    await gateway().patch(EVENT_ID, event({ summary: 'Moved' }));
    expect(stored_()?.status).toBe('cancelled');
    expect(JSON.parse(google.calls.at(-1)!.body)).not.toHaveProperty('status');
  });

  it('pr39 F5: a patch leaves the attendee list (and the guest RSVP) alone', async () => {
    await gateway().insert(event());
    const ev = stored_()!;
    google.events.set(`${CAL}/${EVENT_ID}`, {
      ...ev,
      attendees: [
        { email: 'sam@example.com', responseStatus: 'accepted' },
        { email: JON, responseStatus: 'accepted' },
      ],
    });
    await gateway().patch(EVENT_ID, event({ summary: 'Moved' }));
    expect(JSON.parse(google.calls.at(-1)!.body)).not.toHaveProperty('attendees');
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com', responseStatus: 'accepted' },
      { email: JON, responseStatus: 'accepted' },
    ]);
  });

  it('pr39 F6: an event id needs a uuid request id', () => {
    expect(() => googleEventId('not-a-uuid')).toThrow(/uuid/);
    expect(() => googleEventId(`${REQ}0`)).toThrow(/uuid/);
  });

  it('attendee-less (the .ics fallback): Jon only, sendUpdates=none, so Google emails nobody', async () => {
    await gateway().insert(event({ attendees: [] }));
    await gateway().patch(EVENT_ID, event({ attendees: [] }));
    expect(writes()).toEqual([
      `POST /calendar/v3/calendars/${CAL}/events none`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} none`,
    ]);
    expect(stored_()?.attendees).toEqual([{ email: JON, responseStatus: 'accepted' }]);
  });

  it('Jon listed as a guest too (joined host) still appears once, accepted', async () => {
    await gateway().insert(event({ attendees: [' Sam@Example.com', JON.toUpperCase(), 'sam@example.com'] }));
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);
  });

  it('patch moves the event and tells the guest', async () => {
    await gateway().insert(event());
    await gateway().patch(
      EVENT_ID,
      event({ startsAt: new Date('2027-05-20T19:30:00Z'), endsAt: new Date('2027-05-20T20:30:00Z') }),
    );
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`);
    expect(stored_()).toMatchObject({ end: { dateTime: '2027-05-20T20:30:00.000Z' } });
  });

  it('remove sends the cancellation; already gone (410/404) counts as done; other errors throw', async () => {
    await gateway().insert(event());
    await gateway().remove(EVENT_ID);
    expect(writes().at(-1)).toBe(`DELETE /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`);
    await expect(gateway().remove(EVENT_ID)).resolves.toBeUndefined(); // 410
    await expect(gateway().remove('ffffffffffffffffffffffffffffffff')).resolves.toBeUndefined(); // 404
    google.state.overrides.push((c) => (c.method === 'DELETE' ? { status: 500 } : undefined));
    await expect(gateway().remove(EVENT_ID)).rejects.toMatchObject({ status: 500 });
  });

  it('a non-409 insert failure throws without a patch', async () => {
    google.state.overrides.push((c) => (c.method === 'POST' ? { status: 503 } : undefined));
    await expect(gateway().insert(event())).rejects.toMatchObject({ status: 503, op: 'events_insert' });
    expect(google.calls.map((c) => c.method)).toEqual(['POST', 'POST']); // googleFetch's one retry, no patch
  });

  it('a 401 drops the cached access token and retries once; a second 401 rethrows', async () => {
    google.state.overrides.push(() => ({
      status: 401,
      json: { error: { errors: [{ reason: 'authError' }] } },
    }));
    await expect(gateway().patch(EVENT_ID, event())).rejects.toMatchObject({ status: 401 });
    expect(forget).toHaveBeenCalledTimes(2);
    expect(google.calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH']);
    google.state.overrides = [() => ({ status: 403 })];
    await expect(gateway().patch(EVENT_ID, event())).rejects.toMatchObject({ status: 403 });
    expect(forget).toHaveBeenCalledTimes(2);
  });

  it('one 401 on a stale token: forget it, retry with a fresh one, and succeed', async () => {
    await gateway().insert(event());
    google.calls.length = 0;
    let token = 0;
    const refreshing = googleCalendarGateway({
      accessToken: async () => `at-${++token}`,
      target: async () => ({ calendarId: stored, ownerEmail: JON }),
      forgetAccessToken: forget,
    });
    google.state.overrides.push((c) => (c.auth === 'Bearer at-1' ? { status: 401 } : undefined));
    await expect(refreshing.patch(EVENT_ID, event({ summary: 'Moved' }))).resolves.toBeUndefined();
    expect(forget).toHaveBeenCalledTimes(1);
    expect(google.calls.map((c) => c.auth)).toEqual(['Bearer at-1', 'Bearer at-2']);
    expect(stored_()?.summary).toBe('Moved');
  });

  it('patch {attendees: true}: a joined guest is added, everyone else keeps their answer, sendUpdates=all', async () => {
    await gateway().insert(event());
    const ev = stored_()!;
    google.events.set(`${CAL}/${EVENT_ID}`, {
      ...ev,
      attendees: [
        { email: 'sam@example.com', responseStatus: 'accepted' },
        { email: JON, responseStatus: 'accepted' },
      ],
    });
    google.calls.length = 0;
    await gateway().patch(EVENT_ID, event({ attendees: ['sam@example.com', 'kim@example.com'] }), {
      attendees: true,
    });
    expect(writes()).toEqual([
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`,
    ]);
    expect(JSON.parse(google.calls[1]!.body)).not.toHaveProperty('status');
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com', responseStatus: 'accepted' },
      { email: 'kim@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);

    // The joined guest leaves: dropped (Google sends the cancellation), Sam's answer still kept.
    await gateway().patch(EVENT_ID, event(), { attendees: true });
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`);
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com', responseStatus: 'accepted' },
      { email: JON, responseStatus: 'accepted' },
    ]);
  });

  it('patch {attendees: true}: the last guest leaving an .ics-only event still tells them; same set = no list', async () => {
    await gateway().insert(event({ attendees: ['kim@example.com'] }));
    await gateway().patch(EVENT_ID, event({ attendees: [] }), { attendees: true });
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`);
    expect(stored_()?.attendees).toEqual([{ email: JON, responseStatus: 'accepted' }]);
    await gateway().patch(EVENT_ID, event({ attendees: [] }), { attendees: true });
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} none`);
    expect(JSON.parse(google.calls.at(-1)!.body)).not.toHaveProperty('attendees');
  });

  it('a 409 on a live event (re-sync replaced a pending attendee patch): the attendee list converges too', async () => {
    await gateway().insert(event());
    google.calls.length = 0;
    // Kim joined while Google was down; the re-sync's insert meets the live event.
    await gateway().insert(event({ attendees: ['sam@example.com', 'kim@example.com'] }));
    expect(writes()).toEqual([
      `POST /calendar/v3/calendars/${CAL}/events all`,
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`, // Kim's invite
    ]);
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: 'kim@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);
    // Kim left while Google was down: the re-sync takes her off (her cancellation).
    await gateway().insert(event());
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`);
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);
    // Same list: content only, silent (the retried-insert case is unchanged).
    await gateway().insert(event());
    expect(writes().at(-1)).toBe(`PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} none`);
    expect(JSON.parse(google.calls.at(-1)!.body)).not.toHaveProperty('attendees');
  });

  it('the last guest leaving an event that is Jon’s alone afterwards: their cancellation shows the guest’s view, never the host’s name or crew', async () => {
    const guestView = { summary: 'The Shore Ride with Jon', description: 'Where: The pier' };
    await gateway().insert(
      event({
        summary: guestView.summary,
        description: guestView.description,
        attendees: ['kim@example.com'],
        guestView,
      }),
    );
    google.calls.length = 0;
    // The .ics host's own event after Kim leaves: Jon's text ("{Dish}: {first name}", crew) and no guest.
    await gateway().patch(
      EVENT_ID,
      event({
        summary: 'The Shore Ride: Sam',
        description: 'Crew: 2\nWhere: The pier',
        attendees: [],
        guestView,
      }),
      { attendees: true },
    );
    expect(writes()).toEqual([
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`, // Kim's cancellation
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} none`, // then Jon's own text, telling no one
    ]);
    const removal = google.calls[1]!.body;
    expect(JSON.parse(removal)).toMatchObject({
      summary: guestView.summary,
      description: guestView.description,
    });
    expect(removal).not.toMatch(/Sam|Crew/);
    expect(JSON.parse(google.calls[2]!.body)).not.toHaveProperty('attendees');
    expect(stored_()).toMatchObject({
      summary: 'The Shore Ride: Sam',
      description: 'Crew: 2\nWhere: The pier',
    });
  });

  it('the attendee update is conditional on the GET’s etag: a guest who answers in between keeps their answer', async () => {
    await gateway().insert(event());
    const key = `${CAL}/${EVENT_ID}`;
    let raced = false;
    // Sam accepts between our GET and our PATCH (the GET returns the old copy, Google then changes it).
    google.state.overrides.push((call) => {
      if (raced || call.method !== 'GET' || !call.url.pathname.endsWith(EVENT_ID)) return undefined;
      raced = true;
      const before = google.events.get(key)!;
      google.put(key, {
        ...before,
        attendees: [
          { email: 'sam@example.com', responseStatus: 'accepted' },
          { email: JON, responseStatus: 'accepted' },
        ],
      });
      return { status: 200, json: before };
    });
    google.calls.length = 0;
    await gateway().patch(EVENT_ID, event({ attendees: ['sam@example.com', 'kim@example.com'] }), {
      attendees: true,
    });
    expect(writes()).toEqual([
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`, // 412: the etag moved
      `GET /calendar/v3/calendars/${CAL}/events/${EVENT_ID} null`,
      `PATCH /calendar/v3/calendars/${CAL}/events/${EVENT_ID} all`,
    ]);
    expect(google.calls[1]!.ifMatch).toBeTruthy();
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com', responseStatus: 'accepted' }, // kept, not reset
      { email: 'kim@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);
  });

  it('a second 412 in a row is thrown (the outbox retries later); nothing is written', async () => {
    await gateway().insert(event());
    google.state.overrides.push((call) =>
      call.method === 'PATCH'
        ? { status: 412, json: { error: { errors: [{ reason: 'conditionNotMet' }] } } }
        : undefined,
    );
    await expect(
      gateway().patch(EVENT_ID, event({ attendees: ['sam@example.com', 'kim@example.com'] }), {
        attendees: true,
      }),
    ).rejects.toMatchObject({ status: 412 });
    expect(google.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
    expect(stored_()?.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: JON, responseStatus: 'accepted' },
    ]);
  });

  it.each([['primary'], ['PRIMARY'], ['jon@example.com'], [null], ['']])(
    'the write guard refuses a stored calendar of %j before any call',
    async (bad) => {
      stored = bad;
      await expect(gateway().insert(event())).rejects.toThrow(/stored app calendar/);
      await expect(gateway().patch(EVENT_ID, event())).rejects.toThrow(/stored app calendar/);
      await expect(gateway().remove(EVENT_ID)).rejects.toThrow(/stored app calendar/);
      expect(google.calls).toHaveLength(0);
    },
  );

  it('assertWritableCalendar: only the stored secondary calendar passes', () => {
    expect(assertWritableCalendar(CAL, CAL)).toBe(CAL);
    expect(() => assertWritableCalendar('other@group.calendar.google.com', CAL)).toThrow();
    expect(() => assertWritableCalendar('primary', 'primary')).toThrow();
    expect(() => assertWritableCalendar(CAL, null)).toThrow();
    expect(() => assertWritableCalendar(undefined, CAL)).toThrow();
  });
});

describe('rsvps (T3.15.01)', () => {
  it('one events.list on the stored calendar; guests only (never Jon), cancelled events skipped', async () => {
    stored = CAL;
    google.state.overrides.push((c) =>
      c.method === 'GET'
        ? {
            status: 200,
            json: {
              items: [
                {
                  id: 'e1',
                  status: 'confirmed',
                  attendees: [
                    { email: JON.toUpperCase(), responseStatus: 'accepted' },
                    { email: ' Sam@Example.com ', responseStatus: GOOGLE_NO },
                    { email: 'kim@example.com', responseStatus: 'weirdNewState' },
                  ],
                },
                {
                  id: 'e2',
                  status: 'cancelled',
                  attendees: [{ email: 'x@example.com', responseStatus: GOOGLE_NO }],
                },
                { id: 'e3', status: 'confirmed' },
              ],
            },
          }
        : undefined,
    );
    expect(await gateway().rsvps(new Date('2027-05-01T00:00:00Z'))).toEqual([
      {
        eventId: 'e1',
        attendees: [
          { email: 'sam@example.com', rsvp: 'no' },
          { email: 'kim@example.com', rsvp: 'pending' },
        ],
      },
      { eventId: 'e3', attendees: [] },
    ]);
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0]!.url.searchParams.get('maxResults')).toBe('2500');
  });

  it('is refused by the guard like a write: no stored calendar, or primary, means no call', async () => {
    stored = null;
    await expect(gateway().rsvps(new Date())).rejects.toBeInstanceOf(CalendarWriteGuardError);
    stored = 'primary';
    await expect(gateway().rsvps(new Date())).rejects.toBeInstanceOf(CalendarWriteGuardError);
    expect(google.calls).toHaveLength(0);
  });
});

describe('health() (T3.9.04, pr42 F2)', () => {
  it('ok = calendars.get on the stored calendar after dropping the cached token (a forced refresh)', async () => {
    expect(await gateway().health()).toBe('ok');
    expect(forget).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([`GET /calendar/v3/calendars/${CAL} null`]);
  });

  it("invalid_grant, a 401 or the calendar gone = 'revoked'; 5xx/429/invalid_client throw", async () => {
    const answer = (status: number, json: unknown) => {
      google.state.overrides.length = 0;
      google.state.overrides.push(() => ({ status, json }));
    };
    answer(401, { error: { status: 'UNAUTHENTICATED' } });
    expect(await gateway().health()).toBe('revoked');
    answer(404, { error: { errors: [{ reason: 'notFound' }] } });
    expect(await gateway().health()).toBe('revoked');
    answer(410, {});
    expect(await gateway().health()).toBe('revoked');
    answer(503, {});
    await expect(gateway().health()).rejects.toMatchObject({ status: 503 });
    answer(429, {});
    await expect(gateway().health()).rejects.toMatchObject({ status: 429 });
    answer(403, { error: { errors: [{ reason: 'forbidden' }] } });
    await expect(gateway().health()).rejects.toMatchObject({ status: 403 });
    const dead = googleCalendarGateway({
      accessToken: async () => {
        throw new GoogleApiError(400, 'invalid_grant', 'token_refresh');
      },
      target: async () => ({ calendarId: CAL, ownerEmail: JON }),
      forgetAccessToken: forget,
    });
    expect(await dead.health()).toBe('revoked');
    const misconfigured = googleCalendarGateway({
      accessToken: async () => {
        throw new GoogleApiError(401, 'invalid_client', 'token_refresh');
      },
      target: async () => ({ calendarId: CAL, ownerEmail: JON }),
      forgetAccessToken: forget,
    });
    await expect(misconfigured.health()).rejects.toMatchObject({ reason: 'invalid_client' });
  });

  it("no stored connection = 'not_connected' with no Google call; a foreign calendar id is refused", async () => {
    const none = googleCalendarGateway({
      accessToken: async () => 'at-1',
      target: async () => null,
      forgetAccessToken: forget,
    });
    expect(await none.health()).toBe('not_connected');
    stored = 'primary';
    await expect(gateway().health()).rejects.toBeInstanceOf(CalendarWriteGuardError);
    expect(google.calls).toHaveLength(0);
  });
});
