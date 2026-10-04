// T3.4.01/.02 wiring: realCalendar (staging/production) on Jon's stored connection, against the real test DB
// and the fake Google. The write guard reads oauth_connection.calendar_id; nothing ever targets `primary`.
import '../fixtures/google-env';
import { fakeGoogle } from '../fixtures/fake-google';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { q, withTx } from '@/lib/db';
import { encryptToken } from '@/features/calendar/crypto';
import { resetAccessTokenCacheForTests } from '@/features/calendar/connection';
import { realCalendar } from '@/features/calendar/gateway';
import { processOutbox } from '@/features/calendar/outbox';
import { watchRsvps } from '@/features/calendar/rsvp-watch';
import { enqueueCalendar, patchHostIfLocked } from '@/features/requests/side-effects';
import { CalendarWriteGuardError } from '@/lib/adapters/google/calendar';
import { mockMailer } from '@/lib/adapters/mock/mailer';

vi.mock('@/lib/adapters', () => ({ adapters: () => ({ calendar: realCalendar, mailer: mockMailer }) }));

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
const created: { request: string; guest: string }[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  // Other files count locked requests: leave none behind (joined guests first, then their host).
  await q(`delete from outbox where request_id = any($1::uuid[])`, [created.map((c) => c.request)]);
  await q(`delete from request where id = any($1::uuid[])`, [created.map((c) => c.request)]);
  await q(`delete from guest where id = any($1::uuid[])`, [created.map((c) => c.guest)]);
  created.length = 0;
});

/** A locked request (a host when `hostId` is unset, else a guest joined to it), as the app stores them. */
async function lockedRow(starts: Date, hostId?: string) {
  const [inv] = await q<{ id: string }>(`select id from invite where kind = 'general'`);
  const email = `cal-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [email]);
  const [r] = await q<{ id: string }>(
    `insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status,
                          counts_toward, locked_starts_at, locked_ends_at, joined_to_request_id)
     values (gen_random_uuid(), $1, $2, 'Sam', $3, 'the-long-lunch', 'slots', 'locked', 'weekly_cap', $4, $5, $6)
     returning id`,
    [
      g!.id,
      inv!.id,
      email,
      hostId ? null : starts,
      hostId ? null : new Date(starts.getTime() + 2 * 3_600_000),
      hostId ?? null,
    ],
  );
  if (hostId) created.unshift({ request: r!.id, guest: g!.id });
  else created.push({ request: r!.id, guest: g!.id });
  return { id: r!.id, email };
}
const runRow = async (kind: 'calendar_create' | 'calendar_patch', id: string, attendees = false) =>
  processOutbox(await withTx((c) => enqueueCalendar(c, kind, id, attendees ? { attendees: true } : {})), {
    inline: true,
  });

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

  it('a 401 drops the cached access token and retries once; a second 401 throws, the next call refreshes', async () => {
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
    expect(refreshes()).toBe(2); // the retry ran on a fresh token
    google.state.overrides.length = 0;
    await realCalendar.patch(REQ.replace(/-/g, ''), event);
    expect(refreshes()).toBe(3);
  });

  it('a 401 on a stale access token refreshes and retries once: no alert, last_error stays null', async () => {
    await connect(CAL);
    await realCalendar.insert(event); // caches access-for-refresh-1
    let refused = 0;
    google.state.overrides.push((c) =>
      c.url.pathname.includes('/events') && refused++ === 0
        ? { status: 401, json: { error: { status: 'UNAUTHENTICATED' } } }
        : undefined,
    );
    const e14 = async () =>
      (await q<{ n: number }>(`select count(*)::int n from email_log where template = 'E14'`))[0]!.n;
    const before = await e14();
    await realCalendar.patch(REQ.replace(/-/g, ''), { ...event, summary: 'Moved' });
    expect(google.calls.filter((c) => c.method === 'PATCH')).toHaveLength(2); // refused, then the retry
    expect(google.calls.filter((c) => c.url.pathname === '/token')).toHaveLength(2);
    expect(await e14()).toBe(before);
    const [row] = await q<{ last_error: string | null }>(`select last_error from oauth_connection`);
    expect(row!.last_error).toBeNull();
  });
});

describe('joined guests on the host event (T2.7, T3.4)', () => {
  const starts = new Date('2031-06-12T19:00:00Z');
  const stored = (hostId: string) =>
    google.events.get(`${CAL}/${hostId.replace(/-/g, '')}`) as { attendees: { email: string }[] };

  it('a join sends Google the new attendee (sendUpdates=all) and keeps the host guest RSVP; a leave drops it', async () => {
    await connect(CAL);
    const host = await lockedRow(starts);
    expect(await runRow('calendar_create', host.id)).toBe('synced');
    // The host guest answered yes on Google.
    const ev = stored(host.id);
    google.events.set(`${CAL}/${host.id.replace(/-/g, '')}`, {
      ...ev,
      attendees: ev.attendees.map((a) => (a.email === host.email ? { ...a, responseStatus: 'accepted' } : a)),
    });

    const joined = await lockedRow(starts, host.id);
    google.calls.length = 0;
    expect(await runRow('calendar_patch', host.id, true)).toBe('synced');
    const patch = google.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url.searchParams.get('sendUpdates')).toBe('all');
    expect(stored(host.id).attendees).toEqual([
      { email: host.email, responseStatus: 'accepted' },
      { email: joined.email },
      { email: 'jon@example.com', responseStatus: 'accepted' },
    ]);

    // The RSVP watch now sees the joined guest's answer on the host event.
    google.events.set(`${CAL}/${host.id.replace(/-/g, '')}`, {
      ...stored(host.id),
      attendees: stored(host.id).attendees.map((a) =>
        a.email === joined.email ? { ...a, responseStatus: 'tentative' } : a,
      ),
    });
    expect(await watchRsvps(new Date('2031-06-01T00:00:00Z'))).toBe(2); // the host guest's yes + this one
    const rsvp = async (id: string) =>
      (await q<{ guest_rsvp: string | null }>(`select guest_rsvp from request where id = $1`, [id]))[0]!
        .guest_rsvp;
    expect(await rsvp(joined.id)).toBe('maybe');
    expect(await rsvp(host.id)).toBe('yes');

    // The joined guest leaves: the host row is patched through patchHostIfLocked, as a cancel does.
    await q(
      `update request set status = 'cancelled', cancelled_at = now(), cancelled_by = 'guest' where id = $1`,
      [joined.id],
    );
    const leave = await withTx((c) => patchHostIfLocked(c, host.id));
    google.calls.length = 0;
    expect(await processOutbox(leave!, { inline: true })).toBe('synced');
    expect(google.calls.find((c) => c.method === 'PATCH')!.url.searchParams.get('sendUpdates')).toBe('all');
    expect(stored(host.id).attendees).toEqual([
      { email: host.email, responseStatus: 'accepted' },
      { email: 'jon@example.com', responseStatus: 'accepted' },
    ]);
  });

  it('a plain patch row (time or text) still sends no attendee list', async () => {
    await connect(CAL);
    const host = await lockedRow(starts);
    await runRow('calendar_create', host.id);
    google.calls.length = 0;
    expect(await runRow('calendar_patch', host.id)).toBe('synced');
    expect(google.calls.map((c) => c.method)).toEqual(['PATCH']);
    expect(JSON.parse(google.calls[0]!.body)).not.toHaveProperty('attendees');
  });
});
