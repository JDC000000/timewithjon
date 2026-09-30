// T3.14.02 (E14 at once on invalid_grant/401, 1 per 6 h, banner data) and T3.15.01 (the RSVP watch: one
// events.list per tick, 'no' -> flag + awaiting_jon_since, status never changes), against the real test DB and
// the fake Google. The real gateway stands in for the proto mock here.
import '../fixtures/google-env';
import { fakeGoogle } from '../fixtures/fake-google';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { encryptToken } from '@/features/calendar/crypto';
import { resetAccessTokenCacheForTests } from '@/features/calendar/connection';
import { realCalendar } from '@/features/calendar/gateway';
import {
  alertIfGoogleAuthFailure,
  e14EventKey,
  GOOGLE_ALERT_KEY,
  googleBanner,
  sendE14Once,
} from '@/features/calendar/alerts';
import { watchRsvps } from '@/features/calendar/rsvp-watch';
import { realFreeBusy } from '@/features/calendar/freebusy-source';
import { GoogleApiError } from '@/lib/adapters/google/http';
import { mockMailer } from '@/lib/adapters/mock/mailer';

vi.mock('@/lib/adapters', () => ({ adapters: () => ({ calendar: realCalendar, mailer: mockMailer }) }));
const warn = vi.hoisted(() => vi.fn<(message: string, tags: Record<string, string>) => void>());
vi.mock('@/lib/report', async (orig) => ({
  ...(await orig<typeof import('@/lib/report')>()),
  reportMessage: warn,
}));

const CAL = 'twj-test@group.calendar.google.com';
const NOW = new Date('2031-05-01T17:00:00Z');
let google: ReturnType<typeof fakeGoogle>;
const created: { request: string; guest: string }[] = [];

async function connect(token = 'refresh-1') {
  await q(
    `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
     values ('google', 'jon@example.com', $1, $2, $3)`,
    [encryptToken(token), ['openid'], CAL],
  );
}
const e14s = async () =>
  (await q<{ n: number }>(`select count(*)::int n from email_log where template = 'E14'`))[0]!.n;

/** A locked booking `days` after NOW, with its Google event (guest answer `answer`) on the app calendar. */
async function booking(
  days: number,
  answer: string | null,
  rsvp: string | null = null,
  status = 'locked',
  others: { email: string; responseStatus: string }[] = [],
) {
  const [inv] = await q<{ id: string }>(`select id from invite where kind = 'general'`);
  const email = `rsvp${days}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [email]);
  const starts = new Date(NOW.getTime() + days * 86_400_000);
  const ends = new Date(starts.getTime() + 2 * 3_600_000);
  const [r] = await q<{ id: string }>(
    `insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status,
                          counts_toward, locked_starts_at, locked_ends_at, guest_rsvp)
     values (gen_random_uuid(), $1, $2, 'Sam', $3, 'the-long-lunch', 'slots', $7, 'weekly_cap', $4, $5, $6)
     returning id`,
    [g!.id, inv!.id, email.toUpperCase(), starts, ends, rsvp, status],
  );
  created.push({ request: r!.id, guest: g!.id });
  const eventId = r!.id.replace(/-/g, '');
  await q(`update request set google_event_id = $2 where id = $1`, [r!.id, eventId]);
  google.events.set(`${CAL}/${eventId}`, {
    id: eventId,
    status: 'confirmed',
    end: { dateTime: ends.toISOString() },
    attendees: [
      ...others,
      ...(answer ? [{ email, responseStatus: answer }] : []),
      { email: 'jon@example.com', responseStatus: 'accepted' }, // J2: the connected account
    ],
  });
  return r!.id;
}
/** A joined guest (T2.10, M8) on `hostId`: locked with no range or event of its own; `answer` on the host event. */
async function joinedGuest(hostId: string, answer: string) {
  const [inv] = await q<{ id: string }>(`select id from invite where kind = 'general'`);
  const email = `joined-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [email]);
  const [r] = await q<{ id: string }>(
    `insert into request (client_key, guest_id, invite_id, contact_name, contact_email, dish, mode, status,
                          counts_toward, joined_to_request_id)
     values (gen_random_uuid(), $1, $2, 'Kim', $3, 'the-long-lunch', 'slots', 'locked', 'weekly_cap', $4)
     returning id`,
    [g!.id, inv!.id, email, hostId],
  );
  created.unshift({ request: r!.id, guest: g!.id }); // deleted before its host
  const key = `${CAL}/${hostId.replace(/-/g, '')}`;
  const ev = google.events.get(key)!;
  google.events.set(key, {
    ...ev,
    attendees: [...(ev.attendees as object[]), { email, responseStatus: answer }],
  });
  return r!.id;
}
const contact = async (id: string) =>
  (await q<{ e: string }>(`select lower(contact_email::text) e from request where id = $1`, [id]))[0]!.e;
const state = async (id: string) =>
  (
    await q<{ status: string; guest_rsvp: string | null; awaiting_jon_since: Date | null }>(
      `select status, guest_rsvp, awaiting_jon_since from request where id = $1`,
      [id],
    )
  )[0]!;

beforeEach(async () => {
  google = fakeGoogle();
  google.calendars.set(CAL, { summary: 'Time with Jon (test)', timeZone: 'America/Vancouver' });
  vi.stubGlobal('fetch', google.fetch);
  resetAccessTokenCacheForTests();
  await q('delete from oauth_connection');
  await q(`delete from system_status where key = $1`, [GOOGLE_ALERT_KEY]);
  await q(`delete from email_log where template = 'E14'`);
  await q(`delete from email_suppression where email = 'jon.personal@example.com'`);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  // Other files count locked requests: leave none behind.
  await q(`delete from request where id = any($1::uuid[])`, [created.map((c) => c.request)]);
  await q(`delete from guest where id = any($1::uuid[])`, [created.map((c) => c.guest)]);
  created.length = 0;
});

describe('E14 at once on a dead grant (T3.14.02)', () => {
  it('AC2/AC3: invalid_grant inline sends one E14, records the reason, a second failure within 6 h sends none', async () => {
    await connect('refresh-dead');
    google.state.revoked.add('refresh-dead');
    const ev = {
      requestId: '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31',
      summary: 's',
      description: '',
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 3_600_000),
      attendees: [],
    };
    await expect(realCalendar.insert(ev)).rejects.toMatchObject({ reason: 'invalid_grant' });
    expect(await e14s()).toBe(1);
    const [log] = await q<{ to_email: string; vars: { adminLink: string }; status: string }>(
      `select to_email::text, vars, status from email_log where template = 'E14'`,
    );
    expect(log).toMatchObject({
      to_email: 'jon.personal@example.com',
      vars: { adminLink: 'http://localhost:3000/admin/settings' },
      status: 'sent',
    });
    expect(await googleBanner()).toEqual({ problem: 'broken', reason: 'invalid_grant' });
    await expect(realCalendar.remove('x')).rejects.toMatchObject({ reason: 'invalid_grant' });
    expect(await e14s()).toBe(1);
  });

  it('a 401 on a data call alerts too; after 6 h a new failure alerts again', async () => {
    await connect();
    const unauthorized = new GoogleApiError(401, 'authError', 'events_insert');
    await alertIfGoogleAuthFailure(unauthorized, NOW);
    await alertIfGoogleAuthFailure(unauthorized, new Date(NOW.getTime() + 6 * 3_600_000 - 1000));
    expect(await e14s()).toBe(1);
    await alertIfGoogleAuthFailure(unauthorized, new Date(NOW.getTime() + 6 * 3_600_000));
    expect(await e14s()).toBe(2);
    expect(await googleBanner()).toEqual({ problem: 'broken', reason: 'authError' });
  });

  it('other failures (timeouts, 5xx, 403, invalid_client) send nothing and leave the row alone', async () => {
    await connect();
    await alertIfGoogleAuthFailure(new GoogleApiError(503, 'backendError', 'events_insert'), NOW);
    // pr35 F6: a wrong client secret is an operator config error; "reconnect" (E14) would not fix it
    await alertIfGoogleAuthFailure(new GoogleApiError(401, 'invalid_client', 'token_refresh'), NOW);
    await alertIfGoogleAuthFailure(new GoogleApiError(403, 'forbidden', 'events_insert'), NOW);
    await alertIfGoogleAuthFailure(new Error('boom'), NOW);
    expect(await e14s()).toBe(0);
    expect(await googleBanner()).toBeNull();
  });

  it('banner: no row = none (never connected); disconnected = not_connected', async () => {
    expect(await googleBanner()).toBeNull();
    await connect();
    await q(`update oauth_connection set refresh_token_enc = null, last_error = 'disconnected'`);
    expect(await googleBanner()).toEqual({ problem: 'not_connected' });
  });

  it('pr41 F1: the event key is the 6-hour UTC bucket; the email_log key still dedupes with the claim lost', async () => {
    expect(e14EventKey(new Date('2031-05-01T17:59:59.999Z'))).toBe('google_auth:2031-05-01T12:00:00.000Z');
    expect(e14EventKey(new Date('2031-05-01T18:00:00.000Z'))).toBe('google_auth:2031-05-01T18:00:00.000Z');
    expect(e14EventKey(new Date('2031-05-01T05:59:59.999Z'))).toBe('google_auth:2031-05-01T00:00:00.000Z');
    await connect();
    expect(await sendE14Once('invalid_grant', NOW)).toBe('sent');
    const [log] = await q<{ event_key: string }>(`select event_key from email_log where template = 'E14'`);
    expect(log!.event_key).toBe('google_auth:2031-05-01T12:00:00.000Z');
    await q(`delete from system_status where key = $1`, [GOOGLE_ALERT_KEY]); // a purge or restore
    expect(await sendE14Once('invalid_grant', new Date(NOW.getTime() + 1_800_000))).toBe('duplicate'); // 17:30, same bucket
    expect(await e14s()).toBe(1);
  });

  it('pr41 F2: a suppressed or failed-to-queue E14 burns nothing; the next failure still alerts', async () => {
    await connect();
    await q(`insert into email_suppression (email, reason) values ('jon.personal@example.com', 'bounced')`);
    warn.mockClear();
    expect(await sendE14Once('invalid_grant', NOW)).toBe('suppressed');
    expect(warn).toHaveBeenCalledWith('e14_not_sent:suppressed', { area: 'google_alert' }); // Sentry, not silence
    expect(await q(`select 1 from system_status where key = $1`, [GOOGLE_ALERT_KEY])).toHaveLength(0);
    await q(`delete from email_suppression where email = 'jon.personal@example.com'`);
    // A throw inside the queue transaction (here: the insert refused) rolls the claim back too.
    await q(`alter table email_log add constraint twj_test_no_e14 check (template <> 'E14') not valid`);
    try {
      await expect(sendE14Once('invalid_grant', NOW)).rejects.toThrow();
      await alertIfGoogleAuthFailure(new GoogleApiError(401, 'authError', 'events_insert'), NOW); // reported, not thrown
    } finally {
      await q(`alter table email_log drop constraint twj_test_no_e14`);
    }
    expect(await q(`select 1 from system_status where key = $1`, [GOOGLE_ALERT_KEY])).toHaveLength(0);
    expect(await sendE14Once('invalid_grant', NOW)).toBe('sent');
    expect(await e14s()).toBe(1);
  });

  it('pr42 F1: the 07:00 check and a live failure share one sender: 1 E14 across the bucket edge, 8 racing = 1', async () => {
    await connect();
    const at0559 = new Date('2031-05-01T05:59:00Z');
    expect(await sendE14Once('revoked', at0559)).toBe('sent');
    expect(await googleBanner()).toEqual({ problem: 'broken', reason: 'revoked' });
    await alertIfGoogleAuthFailure(
      new GoogleApiError(400, 'invalid_grant', 'token_refresh'),
      new Date('2031-05-01T06:01:00Z'),
    );
    expect(await sendE14Once('revoked', new Date('2031-05-01T11:58:00Z'))).toBe('recent');
    expect(await e14s()).toBe(1);
    // 6 h after the first: free again, but only once, even for failures racing across a bucket edge (two
    // different event keys: only the advisory lock stops a second E14 there).
    const edge = [new Date('2031-05-01T11:59:30Z'), new Date('2031-05-01T12:00:30Z')];
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => sendE14Once('invalid_grant', edge[i % 2]!)),
    );
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(await e14s()).toBe(2);
    expect((await googleBanner())?.problem).toBe('broken');
  });

  it('sendE14Once waits for the E14 advisory lock (so a check-then-queue can never interleave)', async () => {
    await connect();
    const holder = await pool().connect();
    try {
      await holder.query(`select pg_advisory_lock(hashtext('twj_e14'))`);
      let done = false;
      const sending = sendE14Once('invalid_grant', NOW).then((r) => ((done = true), r));
      await new Promise((r) => setTimeout(r, 300));
      expect(done).toBe(false);
      await holder.query(`select pg_advisory_unlock(hashtext('twj_e14'))`);
      expect(await sending).toBe('sent');
    } finally {
      holder.release();
    }
  });

  it('pr41 F8: the banner says broken only for a dead grant, not a transient refresh failure', async () => {
    await connect();
    for (const transient of ['backendError', 'http_503', 'rateLimitExceeded', 'disconnected']) {
      await q(`update oauth_connection set last_error = $1`, [transient]);
      expect(await googleBanner()).toBeNull();
    }
    for (const dead of ['invalid_grant', 'http_401', 'UNAUTHENTICATED', 'unauthorized']) {
      await q(`update oauth_connection set last_error = $1`, [dead]);
      expect(await googleBanner()).toEqual({ problem: 'broken', reason: dead });
    }
  });
});

describe('CalendarGateway.health() (T3.9.04, pr42 F2)', () => {
  const tokenCalls = () => google.calls.filter((c) => c.url.pathname === '/token').length;

  it('ok: a forced refresh every time plus calendars.get on the stored app calendar (never primary)', async () => {
    await connect();
    expect(await realCalendar.health()).toBe('ok');
    expect(await realCalendar.health()).toBe('ok');
    expect(tokenCalls()).toBe(2); // pr35 F9: the cached access token is never trusted by the health check
    const gets = google.calls.filter(
      (c) => c.method === 'GET' && c.url.pathname.startsWith('/calendar/v3/calendars/'),
    );
    expect(gets.map((c) => decodeURIComponent(c.url.pathname))).toEqual([
      `/calendar/v3/calendars/${CAL}`,
      `/calendar/v3/calendars/${CAL}`,
    ]);
    expect(await e14s()).toBe(0); // health() itself sends nothing: its caller uses sendE14Once
  });

  it('revoked: invalid_grant on the refresh, a 401, or the calendar gone', async () => {
    await connect('refresh-dead');
    google.state.revoked.add('refresh-dead');
    expect(await realCalendar.health()).toBe('revoked');
    google.state.revoked.clear();
    google.state.overrides.push((c) =>
      c.url.pathname.startsWith('/calendar/') ? { status: 401, json: {} } : undefined,
    );
    expect(await realCalendar.health()).toBe('revoked');
    google.state.overrides.length = 0;
    google.calendars.delete(CAL);
    expect(await realCalendar.health()).toBe('revoked');
    expect(await e14s()).toBe(0);
  });

  it('not_connected: no row, or a stored row after a Disconnect; transient trouble throws', async () => {
    expect(await realCalendar.health()).toBe('not_connected');
    await connect();
    await q(`update oauth_connection set refresh_token_enc = null`);
    expect(await realCalendar.health()).toBe('not_connected');
    await q('delete from oauth_connection');
    await connect();
    google.state.overrides.push((c) =>
      c.url.pathname.startsWith('/calendar/') ? { status: 503, json: {} } : undefined,
    );
    await expect(realCalendar.health()).rejects.toMatchObject({ status: 503 });
    google.state.overrides.length = 0;
    google.state.overrides.push((c) =>
      c.url.pathname === '/token' ? { status: 401, json: { error: 'invalid_client' } } : undefined,
    );
    await expect(realCalendar.health()).rejects.toMatchObject({ reason: 'invalid_client' });
  });
});

describe('the RSVP watch (T3.15.01)', () => {
  it('pr41 F6: a booking cancelled while the list call runs is never flagged', async () => {
    await connect();
    const id = await booking(3, 'declined');
    const spy = vi.spyOn(realCalendar, 'rsvps').mockImplementation(async () => {
      await q(`update request set status = 'cancelled' where id = $1`, [id]);
      return [{ eventId: id.replace(/-/g, ''), attendees: [{ email: await contact(id), rsvp: 'no' }] }];
    });
    try {
      expect(await watchRsvps(NOW)).toBe(0);
    } finally {
      spy.mockRestore();
    }
    expect(await state(id)).toMatchObject({
      status: 'cancelled',
      guest_rsvp: null,
      awaiting_jon_since: null,
    });
  });

  it("pr41 F7: a joined guest's answer on the host's event lands on its own row; a dead host's joiners are left alone", async () => {
    await connect();
    const host = await booking(3, 'accepted');
    const joined = await joinedGuest(host, 'declined');
    const gone = await booking(4, 'accepted', null, 'cancelled');
    const orphan = await joinedGuest(gone, 'declined');
    const pastHost = await booking(-1, 'accepted');
    const pastJoined = await joinedGuest(pastHost, 'declined');
    expect(await watchRsvps(NOW)).toBe(2);
    expect(await state(host)).toMatchObject({ guest_rsvp: 'yes', awaiting_jon_since: null });
    expect(await state(joined)).toMatchObject({
      status: 'locked',
      guest_rsvp: 'no',
      awaiting_jon_since: NOW,
    });
    expect(await state(orphan)).toMatchObject({ guest_rsvp: null });
    expect(await state(pastJoined)).toMatchObject({ guest_rsvp: null });
  });
  it("maps answers, flags a 'no' for Jon, never changes the status, one events.list per run", async () => {
    await connect();
    const no = await booking(3, 'declined');
    const yes = await booking(4, 'accepted');
    const maybe = await booking(5, 'tentative');
    const pending = await booking(6, 'needsAction');
    const icsOnly = await booking(7, null); // attendee-less (.ics fallback): nothing to read
    expect(await watchRsvps(NOW)).toBe(4);
    expect(await state(no)).toMatchObject({ status: 'locked', guest_rsvp: 'no', awaiting_jon_since: NOW });
    expect(await state(yes)).toMatchObject({ guest_rsvp: 'yes', awaiting_jon_since: null });
    expect(await state(maybe)).toMatchObject({ guest_rsvp: 'maybe', awaiting_jon_since: null });
    expect(await state(pending)).toMatchObject({ guest_rsvp: 'pending', awaiting_jon_since: null });
    expect(await state(icsOnly)).toMatchObject({ guest_rsvp: null });
    const lists = google.calls.filter((c) => c.method === 'GET' && c.url.pathname.endsWith('/events'));
    expect(lists).toHaveLength(1);
    expect(decodeURIComponent(lists[0]!.url.pathname)).toBe(`/calendar/v3/calendars/${CAL}/events`);
    expect(lists[0]!.url.searchParams.get('singleEvents')).toBe('true');
    expect(lists[0]!.url.searchParams.get('timeMin')).toBe(NOW.toISOString());
    // A second run changes nothing and keeps the first wait time.
    expect(await watchRsvps(new Date(NOW.getTime() + 900_000))).toBe(0);
    expect((await state(no)).awaiting_jon_since).toEqual(NOW);
  });

  it("a guest who changes to 'no' later is flagged then; an existing wait is kept", async () => {
    await connect();
    const id = await booking(3, 'declined', 'yes');
    const earlier = new Date(NOW.getTime() - 86_400_000);
    await q(`update request set awaiting_jon_since = $2 where id = $1`, [id, earlier]);
    expect(await watchRsvps(NOW)).toBe(1);
    expect(await state(id)).toMatchObject({ guest_rsvp: 'no', awaiting_jon_since: earlier });
  });

  it("reads the booking's own guest, not whoever is listed first; other statuses are not watched", async () => {
    await connect();
    const id = await booking(3, 'accepted', null, 'locked', [
      { email: 'plus-one@example.com', responseStatus: 'declined' },
    ]);
    const cancelled = await booking(4, 'declined', null, 'cancelled');
    expect(await watchRsvps(NOW)).toBe(1);
    expect(await state(id)).toMatchObject({ guest_rsvp: 'yes', awaiting_jon_since: null });
    expect(await state(cancelled)).toMatchObject({ status: 'cancelled', guest_rsvp: null });
  });

  it('a dead grant during the watch sends E14 and fails the job (the tick reports it)', async () => {
    await connect('refresh-dead');
    google.state.revoked.add('refresh-dead');
    await booking(3, 'declined');
    await expect(watchRsvps(NOW)).rejects.toMatchObject({ reason: 'invalid_grant' });
    expect(await e14s()).toBe(1);
  });

  it('past bookings and cancelled Google events are left alone', async () => {
    await connect();
    const past = await booking(-2, 'declined');
    const gone = await booking(3, 'declined');
    const key = `${CAL}/${gone.replace(/-/g, '')}`;
    google.events.set(key, { ...google.events.get(key), status: 'cancelled' });
    expect(await watchRsvps(NOW)).toBe(0);
    expect((await state(past)).guest_rsvp).toBeNull();
    expect((await state(gone)).guest_rsvp).toBeNull();
  });

  it('nothing to watch = no Google call; disconnected = a quiet no-op', async () => {
    await connect();
    await booking(3, 'declined', null, 'cancelled'); // only locked bookings are watched
    expect(await watchRsvps(NOW)).toBe(0);
    expect(google.calls).toHaveLength(0);
    await booking(3, 'declined');
    await q(`update oauth_connection set refresh_token_enc = null`);
    expect(await watchRsvps(NOW)).toBe(0);
    expect(google.calls).toHaveLength(0);
  });
});

describe('realFreeBusy (T3.5.01)', () => {
  it('queries settings.freebusy_calendar_ids (J1) and alerts on a dead grant', async () => {
    await connect();
    await q(`update settings set freebusy_calendar_ids = array['primary', $1]`, [CAL]);
    google.state.busy.set(CAL, []);
    try {
      await realFreeBusy.busy(NOW, new Date(NOW.getTime() + 86_400_000));
      const body = JSON.parse(google.calls.find((c) => c.url.pathname.endsWith('/freeBusy'))!.body) as {
        items: unknown;
      };
      expect(body.items).toEqual([{ id: 'primary' }, { id: CAL }]);
    } finally {
      await q(`update settings set freebusy_calendar_ids = array['primary']`);
    }
    await q('delete from oauth_connection');
    resetAccessTokenCacheForTests();
    await connect('refresh-dead');
    google.state.revoked.add('refresh-dead');
    await expect(realFreeBusy.busy(NOW, new Date(NOW.getTime() + 86_400_000))).rejects.toMatchObject({
      reason: 'invalid_grant',
    });
    expect(await e14s()).toBe(1);
  });
});
