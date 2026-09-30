// T3.15.02 (TSD T3.15 AC2, AC3; L10): A7 "Re-sync calendar" against the test DB, the REAL gateway and the fake
// Google. Every future locked booking ends up with exactly one event on the connected calendar, after a deleted
// calendar + reconnect too; past bookings are untouched; an 'ics_sent' booking stays off Google's invite list.
import '../fixtures/google-env';
import { fakeGoogle } from '../fixtures/fake-google';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { encryptToken } from '@/features/calendar/crypto';
import { resetAccessTokenCacheForTests } from '@/features/calendar/connection';
import { OUTBOX_MAX_ATTEMPTS, processOutbox } from '@/features/calendar/outbox';
import { queueResync, resyncCalendar } from '@/features/calendar/resync';
import { getEnv } from '@/config/env';
import { POST as resyncRoute } from '@/app/api/admin/google/resync/route';
import { cancelMade, joinDirect, lockDirect, newRequest } from '../fixtures/requests-db';
import { vancouverInstant } from '@/lib/time';

// The real gateway (the one staging and production get) behind the proto mailer.
vi.mock('@/lib/adapters', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/adapters')>();
  const { realCalendar } = await import('@/features/calendar/gateway');
  return { ...m, adapters: () => ({ ...m.adapters(), calendar: realCalendar }) };
});
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const CAL1 = 'twj-resync-1@group.calendar.google.com';
const CAL2 = 'twj-resync-2@group.calendar.google.com';
const NOW = vancouverInstant('2027-04-03', '23:00'); // "now" for every re-sync here: 04-03 is past, 04-04+ ahead
let google: ReturnType<typeof fakeGoogle>;

const eventId = (id: string) => id.replace(/-/g, '');
const onCalendar = (cal: string, id: string) => google.events.get(`${cal}/${eventId(id)}`);
const inserts = (id: string) =>
  google.calls.filter(
    (c) => c.method === 'POST' && c.url.pathname.endsWith('/events') && c.body.includes(eventId(id)),
  );
const state = async (id: string) =>
  (
    await q<{ calendar_state: string; google_event_id: string | null; email: string }>(
      `select calendar_state::text as calendar_state, google_event_id, contact_email::text as email
         from request where id = $1`,
      [id],
    )
  )[0]!;
const openRows = (id: string) =>
  q<{ id: string; payload: Record<string, unknown> }>(
    `select id, payload from outbox where request_id = $1 and done_at is null order by created_at, id`,
    [id],
  );

async function booking(date: string, from = '07:00', to = '08:00'): Promise<string> {
  const id = await newRequest();
  await lockDirect(id, { startsAt: vancouverInstant(date, from), endsAt: vancouverInstant(date, to) });
  return id;
}
async function connect(calendarId: string, token: string | null = 'refresh-1') {
  await q(
    `insert into oauth_connection (provider, account_email, refresh_token_enc, scopes, calendar_id)
     values ('google', 'jon@example.com', $1, $2, $3)
     on conflict (provider) do update set refresh_token_enc = excluded.refresh_token_enc,
                                          calendar_id = excluded.calendar_id`,
    [token ? encryptToken(token) : null, ['openid'], calendarId],
  );
}
/** Runs `fn` with a cached-env field changed, then restores it (getEnv() caches one parsed object). */
async function withEnv<T>(patch: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const env = getEnv() as unknown as Record<string, string | undefined>;
  const old = Object.fromEntries(Object.keys(patch).map((k) => [k, env[k]]));
  Object.assign(env, patch);
  try {
    return await fn();
  } finally {
    Object.assign(env, old);
  }
}
const post = (origin = SITE) =>
  resyncRoute(new NextRequest(`${SITE}/api/admin/google/resync`, { method: 'POST', headers: { origin } }));

beforeEach(async () => {
  google = fakeGoogle();
  for (const cal of [CAL1, CAL2])
    google.calendars.set(cal, { summary: 'Time with Jon (test)', timeZone: 'America/Vancouver' });
  vi.stubGlobal('fetch', google.fetch);
  resetAccessTokenCacheForTests();
  await q('delete from oauth_connection');
  await connect(CAL1);
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cancelMade();
  await q('delete from oauth_connection');
  await pool().end();
});

describe('Re-sync calendar (T3.15.02)', () => {
  it('AC2: creates every missing future event once; after the calendar is deleted and reconnected it recreates each exactly once', async () => {
    const past = await booking('2027-04-03');
    const cancelled = await booking('2027-04-04', '09:00', '10:00');
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [cancelled]);
    const a = await booking('2027-04-04');
    const b = await booking('2027-04-06');
    const joiner = await newRequest();
    await joinDirect(joiner, b);

    const first = await resyncCalendar(NOW);
    expect(first.queued).toBeGreaterThanOrEqual(2);
    for (const id of [a, b]) {
      expect(onCalendar(CAL1, id)).toMatchObject({ status: 'confirmed' });
      expect(inserts(id)).toHaveLength(1);
      expect(await state(id)).toMatchObject({ calendar_state: 'synced', google_event_id: eventId(id) });
      expect(await openRows(id)).toEqual([]);
    }
    // The host's event invites the host guest and the joined guest; the joined request has no event of its own.
    const attendees = (onCalendar(CAL1, b)!.attendees as { email: string }[]).map((x) => x.email);
    expect(attendees).toEqual(
      expect.arrayContaining([(await state(b)).email, (await state(joiner)).email, 'jon@example.com']),
    );
    expect(onCalendar(CAL1, joiner)).toBeUndefined();
    // Only locked host bookings get a row: never a joined guest, never a cancelled booking.
    expect(await q(`select 1 from outbox where request_id = any($1::uuid[])`, [[joiner, cancelled]])).toEqual(
      [],
    );
    // AC3: past events are untouched: no row, no call.
    expect(onCalendar(CAL1, past)).toBeUndefined();
    expect(inserts(past)).toHaveLength(0);
    expect(await openRows(past)).toEqual([]);
    expect(await state(past)).toMatchObject({ calendar_state: 'none', google_event_id: null });

    // The calendar is deleted at Google and Jon reconnects to a new one: the stored event ids now point nowhere.
    google.calendars.delete(CAL1);
    await connect(CAL2);
    const again = await resyncCalendar(NOW);
    expect(again.queued).toBeGreaterThanOrEqual(2);
    for (const id of [a, b]) {
      expect(onCalendar(CAL2, id)).toMatchObject({ status: 'confirmed', id: eventId(id) });
      expect(inserts(id)).toHaveLength(2); // one per calendar
      expect(await state(id)).toMatchObject({ calendar_state: 'synced', google_event_id: eventId(id) });
    }
    expect(google.calls.some((c) => /primary/i.test(c.url.pathname))).toBe(false);

    // A second press converges (409 + GET + a silent patch): still exactly one event each, no new invite.
    const before = google.calls.length;
    await resyncCalendar(NOW);
    const later = google.calls.slice(before).filter((c) => c.url.pathname.includes(eventId(a)));
    expect(later.map((c) => c.method)).toEqual(['GET', 'PATCH']);
    expect(later[1]!.url.searchParams.get('sendUpdates')).toBe('none');
    expect([...google.events.keys()].filter((k) => k.endsWith(eventId(a)))).toHaveLength(2); // CAL1's, CAL2's
  });

  it("an 'ics_sent' booking: Jon's calendar gets the attendee-less event, the guest gets nothing, the backlog closes", async () => {
    const id = await booking('2027-04-07');
    await q(`update request set calendar_state = 'ics_sent' where id = $1`, [id]);
    const [backlog] = await q<{ id: string }>(
      `insert into outbox (kind, request_id, attempts) values ('calendar_create', $1, 2) returning id`,
      [id],
    );
    const e4cBefore = await q(`select 1 from email_log where request_id = $1`, [id]);

    await resyncCalendar(NOW);
    const [insert] = inserts(id);
    expect(insert!.url.searchParams.get('sendUpdates')).toBe('none');
    expect(JSON.parse(insert!.body).attendees).toEqual([
      { email: 'jon@example.com', responseStatus: 'accepted' },
    ]);
    expect(await state(id)).toMatchObject({ calendar_state: 'ics_sent', google_event_id: eventId(id) });
    expect(await openRows(id)).toEqual([]);
    const [closed] = await q<{ done_at: Date | null; attempts: number }>(
      `select done_at, attempts from outbox where id = $1`,
      [backlog!.id],
    );
    expect(closed!.done_at).not.toBeNull();
    expect(closed!.attempts).toBe(2); // closed, never tried again
    expect(await q(`select 1 from email_log where request_id = $1`, [id])).toHaveLength(e4cBefore.length); // no E4c
  });

  it("drift: an event Jon deleted at Google comes back; a 'failed' booking turns 'synced'", async () => {
    const id = await booking('2027-04-11');
    await resyncCalendar(NOW);
    google.events.set(`${CAL1}/${eventId(id)}`, { ...onCalendar(CAL1, id)!, status: 'cancelled' });
    await q(`update request set calendar_state = 'failed' where id = $1`, [id]);
    expect((await resyncCalendar(NOW)).synced).toBeGreaterThanOrEqual(1);
    expect(onCalendar(CAL1, id)).toMatchObject({ status: 'confirmed' });
    expect(await state(id)).toMatchObject({ calendar_state: 'synced' });
  });

  it("Google down: an ics_sent booking's successor row is still a re-sync, so it inserts", async () => {
    const id = await booking('2027-04-13');
    await q(`update request set calendar_state = 'ics_sent' where id = $1`, [id]);
    google.state.overrides.push((c) =>
      c.url.pathname.includes('/events') ? { status: 400, json: { error: 'down' } } : undefined,
    );
    await queueResync(NOW);
    const [row] = await openRows(id);
    expect(row!.payload).toEqual({ resync: true });
    expect(await processOutbox(row!.id, { inline: true, now: NOW })).toBe('failed');
    // Out of tries: an 'ics_sent' booking gets a fresh row that is still a re-sync (so it inserts, not patches).
    const LATER = new Date(NOW.getTime() + 86_400_000);
    for (let i = 0; i < 3; i++)
      await processOutbox(row!.id, { inline: false, now: new Date(LATER.getTime() + i * 3_600_000) });
    const [fresh] = await openRows(id);
    expect(fresh!.id).not.toBe(row!.id);
    expect(fresh!.payload).toEqual({ resync: true });
    google.state.overrides.length = 0;
    await processOutbox(fresh!.id, { inline: false, now: new Date(LATER.getTime() + 5 * 3_600_000) });
    expect(onCalendar(CAL1, id)).toMatchObject({ status: 'confirmed' });
  });

  it('only the soonest bookings run inline within the budget; the rest wait for the tick', async () => {
    const id = await booking('2027-04-14');
    await q(`update request set calendar_state = 'failed' where id = $1`, [id]);
    const r = await resyncCalendar(NOW, -1);
    expect(await state(id)).toMatchObject({ calendar_state: 'pending' }); // in flight again, not 'failed'
    expect(r).toMatchObject({ synced: 0 });
    expect(r.queued).toBeGreaterThanOrEqual(1);
    expect(await openRows(id)).toHaveLength(1);
    expect(inserts(id)).toHaveLength(0);
  });

  it("presses run one at a time (advisory lock); the second closes the first one's row", async () => {
    const id = await booking('2027-04-14', '09:00', '10:00');
    const other = await pool().connect();
    await other.query('begin');
    await other.query(`select pg_advisory_xact_lock(hashtext('twj:calendar_resync'))`);
    let done = false;
    const pressed = queueResync(NOW).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(done).toBe(false); // waits for the press already running
    await other.query('commit');
    other.release();
    await pressed;
    await queueResync(NOW);
    expect(await openRows(id)).toHaveLength(1);
  });

  describe('pr57 F1-F3: rows in flight, delete rows, the hard stop', () => {
    const LATER = new Date(NOW.getTime() + 2 * 3_600_000);
    /** Holds the Google insert of `id`'s event until release(): a tick or an earlier press still running. */
    function holdInsert(id: string) {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const hold = { held: false, release };
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          !hold.held &&
          init?.method === 'POST' &&
          url.pathname.endsWith('/events') &&
          String(init.body ?? '').includes(eventId(id))
        ) {
          hold.held = true;
          await gate;
        }
        return google.fetch(input, init);
      });
      return hold;
    }
    const until = async (cond: () => boolean) => {
      for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
      expect(cond()).toBe(true);
    };
    const createRow = async (id: string) =>
      (
        await q<{ id: string }>(
          `insert into outbox (kind, request_id) values ('calendar_create', $1) returning id`,
          [id],
        )
      )[0]!.id;
    const resyncRow = async (id: string) => (await openRows(id)).find((r) => r.payload.resync === true)!.id;
    /** The tick, a couple of hours on: every open row of the request, oldest first, until none can run. */
    async function tick(id: string) {
      for (let pass = 0; pass < 4; pass++)
        for (const r of await openRows(id)) await processOutbox(r.id, { inline: false, now: LATER });
    }

    it('race A (cancel): a re-sync leaves an in-flight create open, so the delete runs last and nothing is revived', async () => {
      const id = await booking('2027-04-15');
      const o = await createRow(id);
      const hold = holdInsert(id);
      const running = processOutbox(o, { inline: true, now: NOW }); // read 'locked', now inserting
      await until(() => hold.held);

      await queueResync(NOW);
      expect((await openRows(id)).map((r) => r.id)).toContain(o); // in flight: not closed
      const r = await resyncRow(id);
      expect(await processOutbox(r, { inline: true, now: NOW })).toBe('skipped'); // waits for o
      // The guest cancels: the delete row waits too.
      await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
      const [d] = await q<{ id: string }>(
        `insert into outbox (kind, request_id) values ('calendar_delete', $1) returning id`,
        [id],
      );
      expect(await processOutbox(d!.id, { inline: true, now: NOW })).toBe('skipped');

      hold.release();
      await running;
      await tick(id);
      expect(await openRows(id)).toEqual([]);
      expect(onCalendar(CAL1, id)).toMatchObject({ status: 'cancelled' }); // never revived
      expect(await state(id)).toMatchObject({ google_event_id: null });
    });

    it('race B (move): an in-flight create that read the old times can not put them back after a time change (patch row)', async () => {
      const id = await booking('2027-04-16', '07:00', '08:00');
      const o = await createRow(id);
      const hold = holdInsert(id);
      const running = processOutbox(o, { inline: true, now: NOW }); // read 07:00, now inserting
      await until(() => hold.held);

      await queueResync(NOW);
      const r = await resyncRow(id);
      await processOutbox(r, { inline: true, now: NOW });
      const newStart = vancouverInstant('2027-04-16', '12:00');
      await q(`update request set locked_starts_at = $2, locked_ends_at = $3 where id = $1`, [
        id,
        newStart,
        vancouverInstant('2027-04-16', '13:00'),
      ]);
      const [p] = await q<{ id: string }>(
        `insert into outbox (kind, request_id) values ('calendar_patch', $1) returning id`,
        [id],
      );
      await processOutbox(p!.id, { inline: true, now: NOW });

      hold.release();
      await running;
      await tick(id);
      expect(await openRows(id)).toEqual([]);
      const start = (onCalendar(CAL1, id)!.start as { dateTime: string }).dateTime;
      expect(Date.parse(start)).toBe(newStart.getTime()); // the move stands
      expect(await state(id)).toMatchObject({ calendar_state: 'synced' });
    });

    it('an in-flight create that then FAILS is closed in favour of the newer re-sync row (no hour-long wait)', async () => {
      const id = await booking('2027-04-17');
      const o = await createRow(id);
      const hold = holdInsert(id);
      const running = processOutbox(o, { inline: true, now: NOW });
      await until(() => hold.held);
      await queueResync(NOW);
      google.state.overrides.push((c) =>
        c.method === 'POST' && c.url.pathname.endsWith('/events') ? { status: 400, json: {} } : undefined,
      );
      hold.release();
      expect(await running).toBe('failed');
      google.state.overrides.length = 0;
      const [row] = await q<{ done_at: Date | null; last_error: string | null }>(
        `select done_at, last_error from outbox where id = $1`,
        [o],
      );
      expect(row!.done_at).not.toBeNull();
      expect(row!.last_error).toBe('GoogleApiError');
      expect(await processOutbox(await resyncRow(id), { inline: true, now: NOW })).toBe('synced');
      expect(onCalendar(CAL1, id)).toMatchObject({ status: 'confirmed' });
    });

    it('idle rows are closed: failed and waiting, or a lapsed lease (a crashed worker)', async () => {
      const id = await booking('2027-04-18');
      const [waiting] = await q<{ id: string }>(
        `insert into outbox (kind, request_id, attempts, last_error, next_attempt_at)
         values ('calendar_patch', $1, 2, 'GoogleApiError', $2) returning id`,
        [id, new Date(NOW.getTime() + 600_000)],
      );
      const [lapsed] = await q<{ id: string }>(
        `insert into outbox (kind, request_id, attempts, next_attempt_at) values ('calendar_create', $1, 1, $2)
         returning id`,
        [id, new Date(NOW.getTime() - 1)],
      );
      await queueResync(NOW);
      const open = (await openRows(id)).map((r) => r.id);
      expect(open).not.toContain(waiting!.id);
      expect(open).not.toContain(lapsed!.id);
      expect(open).toHaveLength(1);
    });

    it('a never-tried row queued for later is closed too', async () => {
      const id = await booking('2027-04-18', '11:00', '12:00');
      const [later] = await q<{ id: string }>(
        `insert into outbox (kind, request_id, next_attempt_at) values ('calendar_patch', $1, $2) returning id`,
        [id, new Date(NOW.getTime() + 3_600_000)],
      );
      await queueResync(NOW);
      expect((await openRows(id)).map((r) => r.id)).not.toContain(later!.id);
    });

    it('a RETRY in flight (it failed before) stays open too: the claim clears last_error', async () => {
      const id = await booking('2027-04-18', '13:00', '14:00');
      const [o] = await q<{ id: string }>(
        `insert into outbox (kind, request_id, attempts, last_error, next_attempt_at)
         values ('calendar_create', $1, 1, 'GoogleApiError', $2) returning id`,
        [id, new Date(NOW.getTime() - 1)],
      );
      const hold = holdInsert(id);
      const running = processOutbox(o!.id, { inline: false, now: NOW });
      await until(() => hold.held);
      await queueResync(NOW);
      expect((await openRows(id)).map((r) => r.id)).toContain(o!.id);
      hold.release();
      expect(await running).toBe('synced');
    });

    it('a failed row is kept for its retry when the open re-sync row is OLDER, or the newer row is no re-sync', async () => {
      // An older re-sync row stranded out of tries, then a newer patch that fails: the patch must still retry.
      const id = await booking('2027-04-20');
      await q(
        `insert into outbox (kind, request_id, payload, attempts, next_attempt_at, created_at)
         values ('calendar_create', $1, '{"resync": true}', 4, $2, now() - interval '1 minute')`,
        [id, new Date(NOW.getTime() - 1)],
      );
      const [p] = await q<{ id: string }>(
        `insert into outbox (kind, request_id) values ('calendar_patch', $1) returning id`,
        [id],
      );
      google.state.overrides.push(() => ({ status: 400, json: {} }));
      expect(await processOutbox(p!.id, { inline: true, now: NOW })).toBe('failed');
      // A failing create while a newer PLAIN create is open (not a re-sync): kept too.
      const id2 = await booking('2027-04-21');
      const o = await createRow(id2);
      await createRow(id2);
      expect(await processOutbox(o, { inline: true, now: NOW })).toBe('failed');
      google.state.overrides.length = 0;
      const done = await q<{ id: string }>(
        `select id from outbox where id = any($1::uuid[]) and done_at is not null`,
        [[p!.id, o]],
      );
      expect(done).toEqual([]);
    });

    it('F3: an open delete row is never closed; the re-sync row runs only after it', async () => {
      const id = await booking('2027-04-18', '09:00', '10:00');
      const [d] = await q<{ id: string }>(
        `insert into outbox (kind, request_id) values ('calendar_delete', $1) returning id`,
        [id],
      );
      await queueResync(NOW);
      expect((await openRows(id)).map((r) => r.id)).toContain(d!.id);
      const r = await resyncRow(id);
      expect(await processOutbox(r, { inline: true, now: NOW })).toBe('skipped');
      expect(await processOutbox(d!.id, { inline: true, now: NOW })).toBe('synced');
      expect(await processOutbox(r, { inline: true, now: NOW })).toBe('synced');
      expect(onCalendar(CAL1, id)).toMatchObject({ status: 'confirmed' });
    });

    it('F2: a hanging Google is cut off at the hard stop; the row is left for the tick', async () => {
      const id = await booking('2027-04-19');
      vi.stubGlobal(
        'fetch',
        (_: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
          ),
      );
      const t0 = Date.now();
      const r = await resyncCalendar(NOW, 20_000, 300);
      expect(Date.now() - t0).toBeLessThan(5_000);
      expect(r.synced).toBe(0);
      const rows = await q<{ last_error: string | null; attempts: number }>(
        `select last_error, attempts from outbox where request_id = $1 and done_at is null`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempts).toBeLessThanOrEqual(1);
    });
  });

  describe('pr57-verify V2: a delete with no stored event id', () => {
    const deleteRow = async (id: string) =>
      (
        await q<{ id: string }>(
          `insert into outbox (kind, request_id) values ('calendar_delete', $1) returning id`,
          [id],
        )
      )[0]!.id;
    const removes = (id: string) =>
      google.calls.filter((c) => c.method === 'DELETE' && c.url.pathname.endsWith(`/events/${eventId(id)}`));

    it('removes the orphan an aborted insert left (Google has it, the DB never got its id)', async () => {
      const id = await booking('2027-04-22');
      // The insert reached Google, but its answer was lost: no google_event_id stored.
      google.events.set(`${CAL1}/${eventId(id)}`, { id: eventId(id), status: 'confirmed' });
      await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
      expect(await state(id)).toMatchObject({ google_event_id: null });
      expect(await processOutbox(await deleteRow(id), { inline: true, now: NOW })).toBe('synced');
      expect(onCalendar(CAL1, id)).toMatchObject({ status: 'cancelled' });
      expect(removes(id)).toHaveLength(1);
      expect(await openRows(id)).toEqual([]);
    });

    it('no event anywhere: one DELETE answers 404, the row is done', async () => {
      const id = await booking('2027-04-23');
      await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
      expect(await processOutbox(await deleteRow(id), { inline: true, now: NOW })).toBe('synced');
      expect(removes(id)).toHaveLength(1);
      expect(onCalendar(CAL1, id)).toBeUndefined();
      expect(await openRows(id)).toEqual([]);
    });

    // pr64-review N1: with no calendar we may write to there is no event to delete; the row closes at once.
    const cancelled = async (date: string) => {
      const id = await booking(date);
      await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
      return id;
    };
    const deletes = () => google.calls.filter((c) => c.method === 'DELETE');

    it.each([
      ['a Disconnect (no oauth row)', '2027-04-24', () => q('delete from oauth_connection')],
      ['no grant (GoogleNotConnectedError)', '2027-04-27', () => connect(CAL1, null)],
    ])('N1: %s: done on the first try, no call, no retry', async (_, date, disconnect) => {
      const id = await cancelled(date);
      await disconnect();
      resetAccessTokenCacheForTests();
      expect(await processOutbox(await deleteRow(id), { inline: true, now: NOW })).toBe('synced');
      expect(await openRows(id)).toEqual([]);
      expect(await state(id)).toMatchObject({ calendar_state: 'none', google_event_id: null });
      expect(deletes()).toHaveLength(0);
    });

    it("N1: the write guard refuses the stored calendar on the last try: done, never 'failed'", async () => {
      const id = await cancelled('2027-04-25');
      await connect('primary'); // Jon's main calendar: assertWritableCalendar refuses it
      const row = await deleteRow(id);
      await q(`update outbox set attempts = $2 - 1 where id = $1`, [row, OUTBOX_MAX_ATTEMPTS]);
      expect(await processOutbox(row, { inline: false, now: NOW })).toBe('synced');
      expect(await openRows(id)).toEqual([]);
      expect(await state(id)).toMatchObject({ calendar_state: 'none', google_event_id: null });
      expect(deletes()).toHaveLength(0);
    });

    it('N1: with no stored id, any other error (Google down) still retries', async () => {
      const id = await cancelled('2027-04-28');
      const real = google.fetch;
      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) =>
        init?.method === 'DELETE' ? new Response('{}', { status: 500 }) : real(url, init),
      );
      const row = await deleteRow(id);
      expect(await processOutbox(row, { inline: true, now: NOW })).toBe('failed');
      expect((await openRows(id)).map((o) => o.id)).toEqual([row]);
      await q(`update outbox set done_at = now() where id = $1`, [row]); // not swept by a later test
    });

    it('N1: a stored event id still retries while not connected (that event is real)', async () => {
      const id = await cancelled('2027-04-26');
      await q(`update request set google_event_id = $2 where id = $1`, [id, eventId(id)]);
      await connect(CAL1, null);
      resetAccessTokenCacheForTests();
      const row = await deleteRow(id);
      expect(await processOutbox(row, { inline: true, now: NOW })).toBe('failed');
      const [open] = await q<{ last_error: string }>(`select last_error from outbox where id = $1`, [row]);
      expect(open!.last_error).toMatch(/GoogleNotConnectedError/);
      await q(`update outbox set done_at = now() where id = $1`, [row]); // not swept by a later test
    });
  });

  describe('POST /api/admin/google/resync', () => {
    it('200 with the counts', async () => {
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        queued: expect.any(Number),
        synced: expect.any(Number),
      });
      expect(res.headers.get('cache-control')).toMatch(/no-store/);
    });

    it('409 not_connected on the real gateway with no grant or no calendar, and queues nothing', async () => {
      const id = await booking('2027-04-14', '11:00', '12:00');
      await withEnv({ APP_MODE: 'staging' }, async () => {
        await connect(CAL1, null);
        expect((await post()).status).toBe(409);
        await q(`update oauth_connection set refresh_token_enc = $1, calendar_id = null`, [
          encryptToken('r'),
        ]);
        const res = await post();
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'not_connected' });
      });
      expect(await openRows(id)).toEqual([]);
      expect(google.calls).toHaveLength(0);
    });

    it('403 on a foreign Origin, before anything runs', async () => {
      const res = await post('https://evil.example');
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toMatch(/no-store/); // pr57 F6
      expect(google.calls).toHaveLength(0);
    });
  });
});
