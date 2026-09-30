// T3.4.01/.02 wiring: realCalendar (staging/production) on Jon's stored connection, against the real test DB
// and the fake Google. The write guard reads oauth_connection.calendar_id; nothing ever targets `primary`.
import '../fixtures/google-env';
import { fakeGoogle } from '../fixtures/fake-google';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { q } from '@/lib/db';
import { encryptToken } from '@/features/calendar/crypto';
import { resetAccessTokenCacheForTests } from '@/features/calendar/connection';
import { realCalendar } from '@/features/calendar/gateway';
import { CalendarWriteGuardError } from '@/lib/adapters/google/calendar';

const CAL = 'twj-test@group.calendar.google.com';
const REQ = '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31';
const event = {
  requestId: REQ,
  summary: 'The Shore Ride: Sam',
  description: 'Crew: 2',
  startsAt: new Date('2027-05-13T19:30:00Z'),
  endsAt: new Date('2027-05-13T21:30:00Z'),
  attendees: ['sam@example.com'],
};
let google: ReturnType<typeof fakeGoogle>;

async function connect(calendarId: string | null, token: string | null = 'refresh-1') {
  await q(
    `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
     values ('google', 'jon@example.com', $1, $2, $3)`,
    [token ? encryptToken(token) : null, ['openid'], calendarId],
  );
}

beforeEach(async () => {
  google = fakeGoogle();
  google.calendars.set(CAL, { summary: 'Time with Jon (test)', timeZone: 'America/Vancouver' });
  vi.stubGlobal('fetch', google.fetch);
  resetAccessTokenCacheForTests();
  await q('delete from oauth_connection');
});
afterEach(() => vi.unstubAllGlobals());

describe('realCalendar (T3.4.01)', () => {
  it('inserts on the stored calendar with the refreshed token, the guest + the connected account accepted (J2)', async () => {
    await connect(CAL);
    expect(await realCalendar.insert(event)).toEqual({ eventId: REQ.replace(/-/g, '') });
    const insert = google.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/events'));
    expect(decodeURIComponent(insert!.url.pathname)).toBe(`/calendar/v3/calendars/${CAL}/events`);
    expect(insert!.auth).toBe('Bearer access-for-refresh-1');
    expect(insert!.url.searchParams.get('sendUpdates')).toBe('all');
    const body = JSON.parse(insert!.body) as { attendees: unknown[] };
    expect(body.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: 'jon@example.com', responseStatus: 'accepted' }, // account_email, NOT JON_PERSONAL_EMAIL (pr39 F2)
    ]);
    await realCalendar.patch(REQ.replace(/-/g, ''), { ...event, summary: 'Moved' });
    await realCalendar.remove(REQ.replace(/-/g, ''));
    expect(google.calls.some((c) => /primary/i.test(c.url.pathname))).toBe(false);
  });

  it('T3.4.02: no stored calendar = refused before any Google call', async () => {
    await connect(null);
    await expect(realCalendar.insert(event)).rejects.toBeInstanceOf(CalendarWriteGuardError);
    expect(google.calls).toHaveLength(0);
  });

  it("T3.4.02: a stored 'primary' (a corrupt row) is refused, never written", async () => {
    await connect('primary');
    await expect(realCalendar.insert(event)).rejects.toBeInstanceOf(CalendarWriteGuardError);
    await expect(realCalendar.remove('x')).rejects.toBeInstanceOf(CalendarWriteGuardError);
    expect(google.calls).toHaveLength(0);
  });

  it('not connected (no token) fails loudly, with no Google call', async () => {
    await connect(CAL, null);
    await expect(realCalendar.insert(event)).rejects.toMatchObject({ name: 'GoogleNotConnectedError' });
    expect(google.calls).toHaveLength(0);
  });

  it('a 401 drops the cached access token, so the next call refreshes', async () => {
    await connect(CAL);
    await realCalendar.insert(event);
    const refreshes = () => google.calls.filter((c) => c.url.pathname === '/token').length;
    expect(refreshes()).toBe(1);
    google.state.overrides.push((c) =>
      c.url.pathname.includes('/events')
        ? { status: 401, json: { error: { status: 'UNAUTHENTICATED' } } }
        : undefined,
    );
    await expect(realCalendar.patch('abc', event)).rejects.toMatchObject({ status: 401 });
    google.state.overrides.length = 0;
    await realCalendar.patch(REQ.replace(/-/g, ''), event);
    expect(refreshes()).toBe(2);
  });
});
