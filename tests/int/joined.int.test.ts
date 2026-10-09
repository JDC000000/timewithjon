// TSD T2.10 AC1–AC8 (T2.10.05): Join to booking, Close (handled in person), and the §6 "Joined requests" rules
// 1–5 incl. Promote to host, against the test DB with the mock calendar. afterAll removes every request made here,
// and beforeAll clears leftovers on these days, so two runs on one DB both start clean.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { CLOSED_IN_PERSON_LABEL } from '@/content';
import { adminCounts } from '@/features/admin/settings';
import { getRequestDetail } from '@/features/admin/detail';
import { sentLines } from '@/app/manage/_lib/sent-lines';
import { loadEngineData } from '@/features/availability/load';
import { bigDayDates } from '@/features/availability/rules';
import { listRequests } from '@/features/admin/inbox';
import { findToken, issueManageToken } from '@/features/invites/action-tokens';
import { loadManageModel } from '@/features/invites/manage-model';
import { closeInPerson } from '@/features/requests/close-in-person';
import { createRequestTx } from '@/features/requests/create';
import { cancelByGuest } from '@/features/requests/guest-cancel';
import { joinToBooking, promoteToHost } from '@/features/requests/joined';
import { cascadeToJoined, HostRangeClearedError } from '@/features/requests/joined-cascade';
import { lockRequest, type LockTarget } from '@/features/requests/lock';
import { rerequest } from '@/features/requests/rerequest';
import { moveToStandby } from '@/features/requests/standby';
import { suggestTimes } from '@/features/requests/suggest';
import { RequestBody } from '@/features/requests/schema';
import { mockCalendar, mockCalendarAttendees } from '@/lib/adapters/mock/calendar';
import { pool, q, withTx } from '@/lib/db';
import { removeRequests } from '../fixtures/requests-db';
import { vancouverInstant } from '@/lib/time';
import { POST as joinRoute } from '@/app/api/admin/requests/[id]/join/route';
import { POST as promoteRoute } from '@/app/api/admin/requests/[id]/promote/route';
import { POST as closeRoute } from '@/app/api/admin/requests/[id]/close-in-person/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
/** Booking is open by then (the seeded release times), so Ask for another time can pick a window. */
const OPEN = new Date('2027-03-15T18:00:00Z');
// Thu/Fri pairs, one week per test that locks (the weekly cap is per week).
const DAYS = [
  '2027-04-22',
  '2027-04-23',
  '2027-04-29',
  '2027-05-01',
  '2027-05-27',
  '2027-05-28',
  '2027-06-03',
  '2027-06-04',
  '2027-06-10',
  '2027-06-11',
  '2027-06-13',
  '2027-06-17',
  '2027-06-24',
  '2027-06-25',
];
const made: string[] = [];
let inviteId = '';
beforeAll(async () => {
  inviteId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' order by created_at limit 1`)
  )[0]!.id;
  await q(
    `update request set status = 'cancelled', cancelled_at = now()
      where status in ('locked', 'done', 'standby', 'needs_new_time')
        and (locked_starts_at at time zone 'America/Vancouver')::date = any($1::date[])`,
    [DAYS],
  );
});
beforeEach(async () => {
  vi.restoreAllMocks();
  // The AD-5 daily-cap guard (T3.2) digests Jon-facing mail from the 60th send of the day: every test starts at 0.
  await q('delete from email_budget');
});
afterAll(async () => {
  await removeRequests(made); // many rows (the race rounds): removed, not left cancelled
  await q('delete from email_budget'); // the files after this one start at 0 sends today too
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;

async function newRequest(o: { crew?: number; tz?: string; slotIds?: string[] } = {}) {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave Guest',
    email: `dave+${randomUUID().slice(0, 8)}@example.com`,
    crew: o.crew ?? 2,
    slotIds: o.slotIds ?? [],
    guestTimeZone: o.tz,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam: false,
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  made.push(requestId);
  return requestId;
}
async function locked(target: LockTarget) {
  const id = await newRequest();
  expect(await lockRequest({ requestId: id, target, mode: 'lock' })).toMatchObject({ ok: true });
  return id;
}
/** A date-mode lock; 'none' by default so the weekly cap only matters where a test is about it. */
const range = (
  date: string,
  from: string,
  to: string,
  countsToward: 'weekly_cap' | 'none' = 'none',
): LockTarget => ({
  startsAt: vancouverInstant(date, from),
  endsAt: vancouverInstant(date, to),
  countsToward,
  where: 'The Shore',
});
const row = async (id: string) =>
  (
    await q<{
      status: string;
      joined_to_request_id: string | null;
      awaiting_jon_since: Date | null;
      locked_starts_at: Date | null;
      locked_ends_at: Date | null;
      locked_slot_id: string | null;
      counts_toward: string;
      closed_in_person: boolean;
      cancelled_by: string | null;
      google_event_id: string | null;
    }>(
      `select status, joined_to_request_id, awaiting_jon_since, locked_starts_at, locked_ends_at, locked_slot_id,
              counts_toward, closed_in_person, cancelled_by, google_event_id
         from request where id = $1`,
      [id],
    )
  )[0]!;
/** In commit-independent order: rows of two racing transactions carry their START times. */
const templateSet = async (id: string) => (await templates(id)).sort();
const templates = async (id: string) =>
  (
    await q<{ template: string; status: string }>(
      `select template, status from email_log where request_id = $1 and template not in ('E1', 'E2')
        order by created_at, template`,
      [id],
    )
  ).map((e) => `${e.template}:${e.status}`);
const email = async (id: string) =>
  (await q<{ e: string }>(`select contact_email::text as e from request where id = $1`, [id]))[0]!.e;
const sentBody = async (id: string, template: string) =>
  (
    await q<{ text_body: string }>(
      `select d.text_body from dev_outbox d join request r on r.contact_email = d.to_email
        where r.id = $1 and d.template = $2 order by d.created_at desc limit 1`,
      [id, template],
    )
  )[0]?.text_body;
const tokenIn = (body: string) => /\/manage\?t=([A-Za-z0-9_-]{43})/.exec(body)![1]!;

describe('Join to booking (T2.10.01, rule 1)', () => {
  it('AC1 + AC2: the joined guest is an attendee, gets exactly one E4, and does not count toward the week cap', async () => {
    const patch = vi.spyOn(mockCalendar, 'patch');
    const lunch = await slotId('2027-05-27', 'lunch');
    const host = await locked({ slotId: lunch });
    const joined = await newRequest();
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', '{}')`, [joined]);
    const earlier = await withTx((c) => issueManageToken(c, joined)); // e.g. from an earlier email
    expect(await joinToBooking(joined, host)).toEqual({ ok: true, warnings: [] });
    expect(await q(`select 1 from offer where request_id = $1 and released_at is null`, [joined])).toEqual(
      [],
    );
    expect(await row(joined)).toMatchObject({
      status: 'locked',
      joined_to_request_id: host,
      locked_starts_at: null,
      locked_slot_id: null,
      awaiting_jon_since: null,
    });
    // The host's event now lists both guests.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1].attendees).toEqual([await email(host), await email(joined)]);
    // ...and the patch carries the attendee change, so the event (as Google would hold it) has both.
    expect(patch.mock.calls[0]![2]).toEqual({ attendees: true });
    expect(mockCalendarAttendees((await row(host)).google_event_id!)).toEqual([
      await email(host),
      await email(joined),
    ]);
    // AC2: one E4, sent, with a manage link that opens the joined request at the host's time.
    expect(await templates(joined)).toEqual(['E4:sent']);
    const body = (await sentBody(joined, 'E4'))!;
    expect(body).not.toContain('{manageLink}');
    expect(body).not.toContain('You pick the place'); // Q1: a joined guest doesn't pick the place
    const token = tokenIn(body);
    const hostRow = await row(host);
    expect(await loadManageModel(token)).toMatchObject({
      kind: 'manage',
      requestId: joined,
      status: 'locked',
      when: 'Thu May 27 · noon–2 pm Vancouver time', // QA C, EML-01: as the site writes it
    });
    expect((await findToken(token))!.expires_at.getTime()).toBe(
      hostRow.locked_ends_at!.getTime() + 7 * 86400_000,
    );
    // An earlier manage link of the joined request now lasts as long as the booking does (§6).
    expect((await findToken(earlier))!.expires_at).toEqual((await findToken(token))!.expires_at);
    // A second tap is refused: still one E4 and one patch.
    expect(await joinToBooking(joined, host)).toMatchObject({ status: 409, reason: 'already_locked' });
    expect(await templates(joined)).toEqual(['E4:sent']);
    expect(patch).toHaveBeenCalledTimes(1);
    // AC1: the week cap (2) still has room for exactly one more weekly_cap booking: the joined one never counts.
    const fri = await newRequest();
    expect(
      await lockRequest({
        requestId: fri,
        target: { slotId: await slotId('2027-05-28', 'evening') },
        mode: 'lock',
      }),
    ).toMatchObject({ ok: true });
    const third = await newRequest();
    expect(
      await lockRequest({
        requestId: third,
        target: { slotId: await slotId('2027-05-28', 'lunch') },
        mode: 'lock',
      }),
    ).toMatchObject({ status: 409, reason: 'week_full' });
    expect(
      (await q(`select 1 from audit_log where request_id = $1 and action = 'request_joined'`, [joined]))
        .length,
    ).toBe(1);
  });

  it('refuses a host that is not a live booking, a joined host, itself, and a cancelled or unknown request', async () => {
    const host = await locked(range('2027-06-10', '10:00', '11:00'));
    const notLocked = await newRequest();
    const j1 = await newRequest();
    expect(await joinToBooking(j1, notLocked)).toMatchObject({ status: 409, reason: 'host_not_locked' });
    expect(await joinToBooking(j1, host)).toMatchObject({ ok: true });
    const j2 = await newRequest();
    expect(await joinToBooking(j2, j1)).toMatchObject({
      status: 409,
      reason: 'host_not_locked',
      message: 'That booking isn’t locked in any more.',
    });
    // A cancelled host keeps its old range, but is no booking to join.
    const gone = await locked(range('2027-06-10', '16:00', '17:00'));
    await cancelByGuest(gone);
    expect(await joinToBooking(j2, gone)).toMatchObject({ reason: 'host_not_locked' });
    // The host's end has passed (lazy done): nothing left to join.
    const after = new Date((await row(host)).locked_ends_at!.getTime() + 60_000);
    expect(await joinToBooking(j2, host, after)).toMatchObject({ reason: 'host_not_locked' });
    expect(await joinToBooking(host, host)).toMatchObject({ status: 409, reason: 'not_lockable' });
    await cancelByGuest(j2);
    expect(await joinToBooking(j2, host)).toMatchObject({ status: 409, reason: 'cancelled' });
    expect(await joinToBooking(randomUUID(), host)).toMatchObject({
      status: 404,
      reason: 'request_not_found',
    });
    expect(await joinToBooking(j2, randomUUID())).toMatchObject({ status: 404, reason: 'host_not_found' });
    expect(await templates(j2)).toEqual(['E11:sent', 'E12:sent']);
  });

  it('AC5 (rule 1): after the host ends, both show as done without a tick, and people reached counts both crews', async () => {
    const host = await locked(range('2027-06-10', '14:00', '15:00'));
    const joined = await newRequest({ crew: 4 });
    await joinToBooking(joined, host);
    const end = (await row(host)).locked_ends_at!;
    const [before, after] = [new Date(end.getTime() - 60_000), new Date(end.getTime() + 60_000)];
    const done = async (now: Date) => (await listRequests('done', now)).cards.map((c) => c.id);
    expect(await done(before)).not.toContain(joined);
    expect(await done(after)).toEqual(expect.arrayContaining([host, joined]));
    expect((await listRequests('locked', after)).cards.map((c) => c.id)).not.toContain(joined);
    const [a, b] = [await adminCounts(before), await adminCounts(after)];
    expect(b.guestsReached - a.guestsReached).toBe(2);
    expect(b.peopleReached - a.peopleReached).toBe(2 + 1 + 3); // two guests + the host's 1 + the joined 3
    expect(b.confirmedBookings).toBe(a.confirmedBookings); // one booking either way; joined never counts
    expect(await row(joined)).toMatchObject({ status: 'locked' }); // nothing was written: done is derived
  });
});

describe('the admin detail of a shared booking (QA4b M3)', () => {
  it('each page names the other: the guest has the host and its time, the host its guests; after the host leaves, neither', async () => {
    const lunch = await slotId('2027-06-11', 'lunch');
    const host = await locked({ slotId: lunch });
    const guest = await newRequest({ slotIds: [lunch] }); // they picked the host's time (Join is offered for it)
    expect(await joinToBooking(guest, host)).toMatchObject({ ok: true });
    const [h, g] = [await getRequestDetail(host), await getRequestDetail(guest)];
    // The A2 row reads the shared time too (it read "crew 1" with no time).
    const card = (await listRequests('locked', OPEN)).cards.find((c) => c.id === guest);
    expect(card).toMatchObject({ lockedStartsAt: h!.lockedStartsAt, lockedEndsAt: h!.lockedEndsAt });
    expect(g).toMatchObject({
      status: 'locked',
      lockedStartsAt: h!.lockedStartsAt, // the host's time is theirs (rule 1)
      lockedEndsAt: h!.lockedEndsAt,
      calendarState: h!.calendarState, // they're an attendee on the host's event
      joinedHost: { id: host, name: 'Dave Guest', on: true },
      joinedGuests: [],
    });
    expect(h).toMatchObject({ joinedHost: null, joinedGuests: [{ id: guest, name: 'Dave Guest' }] });
    // The host leaves (rule 4): the guest's page names an old host that is no longer on (Make host applies).
    expect(await cancelByGuest(host)).toEqual({ ok: true, already: false });
    expect(await getRequestDetail(guest)).toMatchObject({
      status: 'needs_new_time',
      joinedHost: { id: host, on: false },
    });
    expect((await getRequestDetail(host))!.joinedGuests).toEqual([]);
    // Their manage page: "Let's find another time", without the old time listed as theirs.
    const model = await loadManageModel(await withTx((c) => issueManageToken(c, guest)));
    expect(model).toMatchObject({ kind: 'manage', status: 'needs_new_time', when: null, hostLeft: true });
    expect(await sentLines(model as Extract<typeof model, { kind: 'manage' }>)).toEqual([]);
  });
});

describe('Close (handled in person) (T2.10.02, AC3)', () => {
  it('sends nothing, leaves Needs a reply, and the manage page reads "Sorted. See you soon."', async () => {
    const id = await newRequest();
    await q(`update request set awaiting_jon_since = now() where id = $1`, [id]);
    const token = await withTx((c) => issueManageToken(c, id));
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', '{}')`, [id]);
    const liveOffers = () => q(`select 1 from offer where request_id = $1 and released_at is null`, [id]);
    expect(await liveOffers()).toHaveLength(1);
    const needsReply = async () => (await listRequests('needs_reply')).cards.map((c) => c.id);
    expect(await needsReply()).toContain(id);
    const mails = async () =>
      (await q<{ n: number }>(`select count(*)::int as n from email_log where request_id = $1`, [id]))[0]!.n;
    const before = await mails();
    expect(await closeInPerson(id)).toEqual({ ok: true, already: false });
    expect(await mails()).toBe(before);
    expect(await row(id)).toMatchObject({
      status: 'cancelled',
      closed_in_person: true,
      cancelled_by: 'jon',
      awaiting_jon_since: null,
    });
    expect(await needsReply()).not.toContain(id);
    expect(await liveOffers()).toEqual([]); // its windows are free at once
    expect(await loadManageModel(token)).toMatchObject({ kind: 'manage', label: CLOSED_IN_PERSON_LABEL });
    expect(await closeInPerson(id)).toEqual({ ok: true, already: true });
    expect(await mails()).toBe(before);
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'request_closed_in_person'`, [id]),
    ).toHaveLength(1);
  });

  it('a locked booking is not closed quietly (Cancel for the guest is the way); an unknown one is a 404', async () => {
    const id = await locked(range('2027-06-17', '10:00', '11:00'));
    expect(await closeInPerson(id)).toMatchObject({ status: 409, reason: 'not_closable' });
    expect((await row(id)).status).toBe('locked');
    expect(await closeInPerson(randomUUID())).toMatchObject({ status: 404 });
  });
});

describe('the joined lifecycle (§6 rules 2–5)', () => {
  it('AC4 (rule 2): a joined guest cancels: only their attendee goes, the host stays locked', async () => {
    const [patch, remove] = [vi.spyOn(mockCalendar, 'patch'), vi.spyOn(mockCalendar, 'remove')];
    const host = await locked(range('2027-06-17', '14:00', '15:00'));
    const joined = await newRequest();
    await joinToBooking(joined, host);
    expect(await cancelByGuest(joined)).toEqual({ ok: true, already: false });
    expect(remove).not.toHaveBeenCalled();
    expect(patch.mock.calls.at(-1)![1].attendees).toEqual([await email(host)]);
    expect(patch.mock.calls.at(-1)![2]).toEqual({ attendees: true });
    expect(mockCalendarAttendees((await row(host)).google_event_id!)).toEqual([await email(host)]);
    expect((await row(host)).status).toBe('locked');
    expect((await row(host)).google_event_id).toMatch(/^mock-/);
    expect(await templates(joined)).toEqual(['E4:sent', 'E11:sent', 'E12:sent']);
  });

  it("pr48-review F3: a joined guest's cancel racing the host's cancel: no deadlock, one outcome", async () => {
    for (let i = 0; i < 3; i++) {
      const host2 = await locked(range('2027-06-24', `1${i + 6}:00`, `1${i + 6}:30`));
      const joined2 = await newRequest();
      await joinToBooking(joined2, host2);
      const both = await Promise.all([cancelByGuest(joined2), cancelByGuest(host2)]);
      expect(both).toEqual([
        { ok: true, already: false },
        { ok: true, already: false },
      ]);
      expect((await row(host2)).status).toBe('cancelled');
      expect((await row(joined2)).status).toBe('cancelled');
      // If the host went first the guest got E5j and then cancelled from needs_new_time.
      expect([
        ['E11:sent', 'E12:sent', 'E4:sent'],
        ['E11:sent', 'E12:sent', 'E4:sent', 'E5j:sent'],
      ]).toContainEqual(await templateSet(joined2));
    }
  });

  it('pr52-review M2/M4: a second cascade on the same host is a no-op; a cascade after the range is cleared throws', async () => {
    const host = await locked(range('2027-06-13', '09:00', '10:00'));
    const [a, b] = [await newRequest(), await newRequest()];
    await joinToBooking(a, host);
    await joinToBooking(b, host);
    await cancelByGuest(b); // joined, then left: hostLeft passes it by
    await cancelByGuest(host);
    expect(await templates(a)).toEqual(['E4:sent', 'E5j:sent']);
    expect(await templates(b)).toEqual(['E4:sent', 'E11:sent', 'E12:sent']);
    expect((await row(b)).status).toBe('cancelled');
    // Another lane's cascade later (e.g. a block over the same day): nobody is still riding, so nothing happens.
    const again = await withTx((c) =>
      cascadeToJoined(c, host, {
        template: 'E5b',
        eventKey: randomUUID(),
        now: new Date(),
        toStatus: { status: 'needs_new_time', auditAction: 'block_over' },
        vars: () => ({ dish: 'x', times: 'y' }),
      }),
    );
    expect(again).toEqual([]);
    expect(await templates(a)).toEqual(['E4:sent', 'E5j:sent']);
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'host_left'`, [a]),
    ).toHaveLength(1);
    expect(
      await q(`select 1 from audit_log where request_id = any($1::uuid[]) and action = 'block_over'`, [
        [a, b],
      ]),
    ).toEqual([]);

    // M4: a caller that clears the host's range first loses the copy: the cascade refuses and the tx rolls back.
    const h2 = await locked(range('2027-06-13', '11:00', '12:00'));
    const c2 = await newRequest();
    await joinToBooking(c2, h2);
    await expect(
      withTx(async (c) => {
        await c.query(
          `update request set status = 'needs_new_time', locked_starts_at = null, locked_ends_at = null where id = $1`,
          [h2],
        );
        return cascadeToJoined(c, h2, {
          template: 'E5b',
          eventKey: randomUUID(),
          now: new Date(),
          toStatus: { status: 'needs_new_time', auditAction: 'block_over' },
          vars: () => ({ dish: 'x', times: 'y' }),
        });
      }),
    ).rejects.toBeInstanceOf(HostRangeClearedError);
    expect(await row(c2)).toMatchObject({ status: 'locked', joined_to_request_id: h2 });
    expect((await row(h2)).status).toBe('locked');
  });

  it('pr52-review M1: Promote to host racing Lock it in on the other orphan: no deadlock, one consistent outcome', async () => {
    // Forced interleaving: a third connection holds the week row, so the promote (host, j1, and with the fix j2)
    // queues on the week first; then Lock it in on j2 starts. Without the sibling lock it would take j2 and queue
    // on the week behind the promote, which then needs j2: a deadlock. With it, Lock it in waits on j2 instead.
    const host = await locked(range('2027-06-04', '12:00', '12:20'));
    const [j1, j2] = [await newRequest(), await newRequest()];
    await joinToBooking(j1, host);
    await joinToBooking(j2, host);
    await cancelByGuest(host);
    const holder = await pool().connect();
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await holder.query('begin');
      await holder.query(`select 1 from week where week_start = '2027-05-31' for update`);
      const promoting = promoteToHost(j1);
      await pause(300);
      const locking = lockRequest({
        requestId: j2,
        target: range('2027-06-04', '12:30', '12:50'),
        mode: 'lock',
      });
      await pause(300);
      await holder.query('commit');
      const [promoted, lockedOwn] = await Promise.all([promoting, locking]);
      expect(promoted).toMatchObject({ ok: true });
      // The promote went first: j2 rides j1, and Lock it in refuses a riding row.
      expect(lockedOwn).toMatchObject({ reason: 'not_lockable' });
      expect(await row(j2)).toMatchObject({ status: 'locked', joined_to_request_id: j1 });
    } finally {
      holder.release();
    }
  });

  it('pr59-review M2: Join to booking waits on the host row lock, so a holder of that lock sees a stable joined set', async () => {
    // A holder takes the host row lock as block-confirm's H1 fix does, then counts the joined guests. A join started
    // meanwhile must queue on the host row, so a fresh count under the lock doesn't change; once the holder moves
    // the host on, the join sees it and refuses.
    const host = await locked(range('2027-06-25', '17:00', '17:20'));
    const guest = await newRequest();
    const holder = await pool().connect();
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const joinedCount = async () =>
      (
        await holder.query<{ n: number }>(
          `select count(*)::int n from request where joined_to_request_id = $1 and status = 'locked'`,
          [host],
        )
      ).rows[0]!.n;
    try {
      await holder.query('begin');
      await holder.query(`select 1 from request where id = $1 for update`, [host]);
      expect(await joinedCount()).toBe(0);
      let settled = false;
      const joining = joinToBooking(guest, host).finally(() => {
        settled = true;
      });
      await pause(300);
      expect(settled).toBe(false); // queued on the host row
      expect(await joinedCount()).toBe(0); // a new READ COMMITTED snapshot: still nothing joined
      await holder.query(`update request set status = 'needs_new_time' where id = $1`, [host]);
      await holder.query('commit');
      expect(await joining).toMatchObject({ ok: false, status: 409, reason: 'host_not_locked' });
      expect(await row(guest)).toMatchObject({ status: 'requested', joined_to_request_id: null });
    } finally {
      holder.release();
    }
  });

  it('pr52-verify N1: joining a locked booking is refused before any lock, so it cannot deadlock with block-confirm', async () => {
    // block-confirm locks its rows by id. Here a holder takes the lower id (the would-be joiner), a join of it onto
    // the higher id starts, then the holder asks for the higher id too. Locking the host before refusing the
    // joiner would hold the higher id and wait on the lower: 40P01. The early peek refuses without waiting.
    const a = await locked(range('2027-06-24', '17:00', '17:20'));
    const b = await locked(range('2027-06-24', '18:00', '18:20'));
    const [lo, hi] = [a, b].sort();
    const holder = await pool().connect();
    try {
      await holder.query('begin');
      await holder.query(`select 1 from request where id = $1 for update`, [lo]);
      const joining = joinToBooking(lo!, hi!);
      await new Promise((r) => setTimeout(r, 300));
      await holder.query(`select 1 from request where id = $1 for update`, [hi]);
      await holder.query('commit');
      expect(await joining).toMatchObject({ ok: false, status: 409, reason: 'already_locked' });
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
    expect(await row(lo!)).toMatchObject({ status: 'locked', joined_to_request_id: null });
  });

  it('pr63 M1: a joiner locked between the peek and the row lock is refused after the lock (409 already_locked)', async () => {
    // The peek sees 'requested'; B holds the joiner's row, so the join waits in lockRequestRow; B locks the joiner
    // into its own time and commits. Only the re-check under the lock can refuse now. Dedicated clients: the
    // shared pool is busy with the waiting join.
    const host = await locked(range('2027-06-24', '19:00', '19:20'));
    const joiner = await newRequest();
    const own = {
      startsAt: vancouverInstant('2027-06-24', '20:00'),
      endsAt: vancouverInstant('2027-06-24', '20:20'),
    };
    const [b, poll] = [new Client(process.env.DATABASE_URL), new Client(process.env.DATABASE_URL)];
    await b.connect();
    await poll.connect();
    try {
      await b.query('begin');
      await b.query(`select 1 from request where id = $1 for update`, [joiner]);
      const joining = joinToBooking(joiner, host);
      for (let i = 0; i < 100; i++) {
        const { rows } = await poll.query<{ n: number }>(
          `select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
        );
        if (rows[0]!.n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await b.query(
        `update request set status = 'locked', locked_starts_at = $2, locked_ends_at = $3, counts_toward = 'none'
          where id = $1`,
        [joiner, own.startsAt, own.endsAt],
      );
      await b.query('commit');
      expect(await joining).toMatchObject({ ok: false, status: 409, reason: 'already_locked' });
    } finally {
      await b.query('rollback').catch(() => undefined);
      await Promise.all([b.end(), poll.end()]);
    }
    expect(await row(joiner)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_starts_at: own.startsAt,
      locked_ends_at: own.endsAt,
    });
    expect(await templates(joiner)).toEqual([]); // no E4
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'request_joined'`, [joiner]),
    ).toEqual([]);
  });

  it('AC6 (rule 4): the host cancels: the event goes, the others need a new time; Promote to host makes a new event with all of them', async () => {
    const [insert, remove] = [vi.spyOn(mockCalendar, 'insert'), vi.spyOn(mockCalendar, 'remove')];
    const lunch = await slotId('2027-06-03', 'lunch');
    const host = await locked({ slotId: lunch });
    const [j1, j2, j3] = [await newRequest(), await newRequest(), await newRequest()];
    await joinToBooking(j1, host);
    await joinToBooking(j2, host);
    await joinToBooking(j3, host);
    const hostRow = await row(host);
    expect(await cancelByGuest(host)).toEqual({ ok: true, already: false });
    expect(remove).toHaveBeenCalledTimes(1);
    // QA4b M3: Jon's E12 names the guests who were riding the booking.
    const [e12] = await q<{ vars: Record<string, string> }>(
      `select vars from email_log where request_id = $1 and template = 'E12'`,
      [host],
    );
    expect(e12!.vars.joined).toBe('Joined to it: Dave Guest, Dave Guest, Dave Guest.');
    for (const j of [j1, j2]) {
      expect(await row(j)).toMatchObject({ status: 'needs_new_time', joined_to_request_id: host });
      expect((await row(j)).awaiting_jon_since).not.toBeNull();
      expect(await templates(j)).toEqual(['E4:sent', 'E5j:sent']);
    }
    expect(
      (await q(`select 1 from request where id = any($1::uuid[]) and status = 'cancelled'`, [[host, j1, j2]]))
        .length,
    ).toBe(1);
    // pr52-review M3: an orphan Jon already closed stays closed; the promote below never picks it up.
    expect(await closeInPerson(j3)).toEqual({ ok: true, already: false });
    // Promote to host: j1 gets the old host's slot (canLock re-checked), j2 rides j1, one new event with both.
    insert.mockClear();
    expect(await promoteToHost(j1)).toEqual({ ok: true, warnings: [] });
    expect(await row(j1)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_slot_id: lunch,
      locked_starts_at: hostRow.locked_starts_at,
      counts_toward: 'weekly_cap',
      awaiting_jon_since: null,
    });
    expect(await row(j2)).toMatchObject({
      status: 'locked',
      joined_to_request_id: j1,
      locked_starts_at: null,
      awaiting_jon_since: null,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]![0].attendees).toEqual([await email(j1), await email(j2)]);
    expect(await templates(j1)).toEqual(['E4:sent', 'E5j:sent', 'E4:sent']);
    expect(await templates(j2)).toEqual(['E4:sent', 'E5j:sent', 'E4:sent']);
    expect(await row(j3)).toMatchObject({
      status: 'cancelled',
      closed_in_person: true,
      joined_to_request_id: host,
    });
    expect(await templates(j3)).toEqual(['E4:sent', 'E5j:sent']);
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'request_promoted'`, [j1]),
    ).toHaveLength(1);
    expect(
      await q(`select 1 from audit_log where request_id = $1 and action = 'host_promoted'`, [j2]),
    ).toHaveLength(1);
    // The other guest is no longer the host's to promote; the promoted one is no longer joined.
    expect(await promoteToHost(j2)).toMatchObject({ status: 409, reason: 'already_locked' });
    expect(await promoteToHost(j1)).toMatchObject({ status: 409, reason: 'not_joined' });
    expect(await promoteToHost(randomUUID())).toMatchObject({ status: 404 });
  });

  it('CR-01: an orphan of a Big Day host, locked on a slot, counts as its own dish, not as the old Big Day', async () => {
    // The host: a Saturday morning ride, a Big Day. A Long Lunch guest joins it.
    const host = await locked({
      startsAt: vancouverInstant('2027-05-01', '09:00'),
      endsAt: vancouverInstant('2027-05-01', '13:00'),
      countsToward: 'big_day',
      where: 'The Shore',
    });
    const guest = await newRequest();
    expect(await joinToBooking(guest, host)).toMatchObject({ ok: true });
    expect((await row(guest)).counts_toward).toBe('weekly_cap');
    // The host leaves (rule 4): the guest needs a new time and carries the host's booking, Big Day included (the
    // copy Promote to host needs).
    expect(await cancelByGuest(host)).toEqual({ ok: true, already: false });
    expect(await row(guest)).toMatchObject({ status: 'needs_new_time', counts_toward: 'big_day' });
    // Jon locks the guest on a Thursday lunch instead (A3 sends the slot).
    const thuLunch = await slotId('2027-04-29', 'lunch');
    expect(await lockRequest({ requestId: guest, target: { slotId: thuLunch }, mode: 'lock' })).toMatchObject(
      {
        ok: true,
      },
    );
    expect(await row(guest)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_slot_id: thuLunch,
      counts_toward: 'weekly_cap',
    });
    // So the Thursday is not a Big Day: its evening stays open to everyone else.
    expect(bigDayDates((await loadEngineData()).bookings).has('2027-04-29')).toBe(false);
  });

  it('rule 4 via Ask for another time: the old range is kept on the joined guest, so Promote to host still works', async () => {
    const insert = vi.spyOn(mockCalendar, 'insert');
    const old = range('2027-06-04', '09:00', '10:30'); // counts_toward 'none': the promoted guest takes the host's kind, not its own
    const host = await locked(old);
    const joined = await newRequest();
    await joinToBooking(joined, host);
    const target = await slotId('2027-06-11', 'lunch');
    expect(
      await rerequest(host, { slotIds: [target], dates: [], overnight: false }, OPEN, {
        clientKey: randomUUID(),
      }),
    ).toMatchObject({ ok: true });
    expect(await row(host)).toMatchObject({ status: 'requested', locked_starts_at: null });
    expect(await row(joined)).toMatchObject({
      status: 'needs_new_time',
      joined_to_request_id: host,
      locked_starts_at: vancouverInstant('2027-06-04', '09:00'),
    });
    // Still out of every count while it waits (the copy of the range is not a booking).
    expect((await listRequests('locked')).cards.map((c) => c.id)).not.toContain(joined);
    insert.mockClear();
    expect(await promoteToHost(joined)).toMatchObject({ ok: true });
    expect(await row(joined)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_starts_at: vancouverInstant('2027-06-04', '09:00'),
      locked_ends_at: vancouverInstant('2027-06-04', '10:30'),
      counts_toward: 'none',
    });
    expect(insert.mock.calls[0]![0]).toMatchObject({
      attendees: [await email(joined)],
      description: expect.stringContaining('The Shore'),
    });
  });

  it('an orphan left before the copy existed (no range of its own) is promoted from the old host row', async () => {
    const host = await locked(range('2027-06-25', '09:00', '10:00')); // counts_toward 'none'
    const orphan = await newRequest(); // counts_toward 'weekly_cap'
    await q(`update request set status = 'cancelled' where id = $1`, [host]);
    await q(
      `update request set status = 'needs_new_time', joined_to_request_id = $2, awaiting_jon_since = now()
        where id = $1`,
      [orphan, host],
    );
    expect(await promoteToHost(orphan)).toMatchObject({ ok: true });
    expect(await row(orphan)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_starts_at: vancouverInstant('2027-06-25', '09:00'),
      counts_toward: 'none',
    });
    // With neither a copy nor a host range, there is nothing to copy.
    const bare = await newRequest();
    const other = await newRequest();
    await q(`update request set status = 'needs_new_time', joined_to_request_id = $2 where id = $1`, [
      bare,
      other,
    ]);
    expect(await promoteToHost(bare)).toMatchObject({
      status: 409,
      reason: 'no_host_range',
      message: 'That booking has no time to copy. Lock it in instead.',
    });
  });

  it('Promote to host re-checks canLock, and is refused while the old host is back on', async () => {
    const lunch = await slotId('2027-06-17', 'lunch');
    const host = await locked({ slotId: lunch });
    const joined = await newRequest();
    await joinToBooking(joined, host);
    await cancelByGuest(host);
    // Someone else takes the window meanwhile: the copied time is gone.
    await locked({ slotId: lunch });
    expect(await promoteToHost(joined)).toMatchObject({
      status: 409,
      reason: 'time_taken',
      message: 'That time just went.',
    });
    expect(await row(joined)).toMatchObject({ status: 'needs_new_time', joined_to_request_id: host });
    // Lock it in still takes the orphaned guest on its own, which detaches it.
    const evening = await slotId('2027-06-17', 'evening');
    expect(await lockRequest({ requestId: joined, target: { slotId: evening }, mode: 'lock' })).toMatchObject(
      {
        ok: true,
      },
    );
    expect(await row(joined)).toMatchObject({
      status: 'locked',
      joined_to_request_id: null,
      locked_slot_id: evening,
    });

    // An old host that is locked again: its guest is joined to it, not promoted over it.
    const h2 = await locked(range('2027-06-24', '15:00', '16:00'));
    const j2 = await newRequest();
    await joinToBooking(j2, h2);
    await rerequest(
      h2,
      { slotIds: [await slotId('2027-06-11', 'lunch')], dates: [], overnight: false },
      OPEN,
      {
        clientKey: randomUUID(),
      },
    );
    expect(
      await lockRequest({
        requestId: h2,
        target: { slotId: await slotId('2027-06-11', 'lunch') },
        mode: 'lock',
      }),
    ).toMatchObject({ ok: true });
    expect(await promoteToHost(j2)).toMatchObject({ status: 409, reason: 'host_still_locked' });
    expect(await joinToBooking(j2, h2)).toMatchObject({ ok: true });
  });

  it('AC8 (rule 5): a joined guest asks for another time: detached, requested, E16 to Jon', async () => {
    const patch = vi.spyOn(mockCalendar, 'patch');
    const host = await locked(range('2027-06-25', '15:00', '16:00'));
    const joined = await newRequest();
    await joinToBooking(joined, host);
    expect(
      await rerequest(
        joined,
        { slotIds: [await slotId('2027-06-10', 'lunch')], dates: [], overnight: false },
        OPEN,
        {
          clientKey: randomUUID(),
        },
      ),
    ).toMatchObject({ ok: true });
    expect(await row(joined)).toMatchObject({ status: 'requested', joined_to_request_id: null });
    expect(await templates(joined)).toEqual(['E4:sent', 'E16:sent']);
    expect(patch.mock.calls.at(-1)![1].attendees).toEqual([await email(host)]);
    expect(mockCalendarAttendees((await row(host)).google_event_id!)).toEqual([await email(host)]);
    expect((await row(host)).status).toBe('locked');
  });
});

describe('the admin routes (T2.10.01, .02, .04)', () => {
  const post = (handler: typeof joinRoute, path: string, id: string, body: unknown) =>
    handler(
      new NextRequest(`${SITE}/api/admin/requests/${id}/${path}`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );

  it('join, promote and close answer 200, a 409 with the message, 400 on a bad body, 404 on a bad id', async () => {
    const host = await locked(range('2027-06-03', '15:00', '16:00'));
    const joined = await newRequest();
    const ok = await post(joinRoute, 'join', joined, { hostId: host });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ ok: true, warnings: [] });
    const again = await post(joinRoute, 'join', joined, { hostId: host });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'already_locked', message: 'Already locked in.' });
    const notJoined = await post(promoteRoute, 'promote', host, {});
    expect(notJoined.status).toBe(409);
    expect(await notJoined.json()).toMatchObject({ code: 'not_joined' });
    const closeLocked = await post(closeRoute, 'close-in-person', host, {});
    expect(closeLocked.status).toBe(409);
    expect(await closeLocked.json()).toMatchObject({ code: 'not_closable' });
    const fresh = await newRequest();
    const closed = await post(closeRoute, 'close-in-person', fresh, {});
    expect(closed.status).toBe(200);
    expect(await closed.json()).toEqual({ ok: true, already: false });

    for (const [handler, path, body] of [
      [joinRoute, 'join', {}],
      [joinRoute, 'join', { hostId: 'nope' }],
      [joinRoute, 'join', { hostId: host, extra: 1 }],
      [promoteRoute, 'promote', { overrideWeek: 'yes' }],
      [closeRoute, 'close-in-person', { quietly: true }],
      [closeRoute, 'close-in-person', null],
    ] as const) {
      expect((await post(handler, path, fresh, body)).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect((await post(joinRoute, 'join', 'not-a-uuid', { hostId: host })).status).toBe(404);
    expect((await post(joinRoute, 'join', randomUUID(), { hostId: host })).status).toBe(404);
    expect((await post(joinRoute, 'join', fresh, { hostId: randomUUID() })).status).toBe(404);
    expect((await post(promoteRoute, 'promote', randomUUID(), {})).status).toBe(404);
    expect((await post(closeRoute, 'close-in-person', randomUUID(), {})).status).toBe(404);
    // A cross-site POST is refused before anything is read (AD-7); a missing session is covered for every admin
    // route by tests/unit/admin-routes.test.ts.
    for (const [handler, path, body] of [
      [joinRoute, 'join', { hostId: host }],
      [promoteRoute, 'promote', {}],
      [closeRoute, 'close-in-person', {}],
    ] as const) {
      const res = await handler(
        new NextRequest(`${SITE}/api/admin/requests/${fresh}/${path}`, {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: fresh }) },
      );
      expect(res.status, path).toBe(403);
    }
  });
});

describe('after the host has gone (QA5 N-M2, Make host with its ticks)', () => {
  const post = (id: string, body: unknown) =>
    promoteRoute(
      new NextRequest(`${SITE}/api/admin/requests/${id}/promote`, {
        method: 'POST',
        headers: { origin: SITE, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  /** A guest joined to a host who then cancelled: back in Needs a reply, still naming that host. */
  async function orphanOf(target: LockTarget) {
    const host = await locked(target);
    const guest = await newRequest();
    expect(await joinToBooking(guest, host, OPEN)).toMatchObject({ ok: true });
    expect(await cancelByGuest(host, OPEN)).toMatchObject({ ok: true });
    return { host, guest };
  }

  it('Make host over a week that has filled since: 409 with which booking it would be; Override this week goes', async () => {
    const { guest } = await orphanOf(range('2027-04-22', '10:00', '12:00', 'weekly_cap'));
    await locked(range('2027-04-22', '18:00', '20:00', 'weekly_cap'));
    await locked(range('2027-04-23', '18:00', '20:00', 'weekly_cap'));
    const refused = await post(guest, {});
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      ok: false,
      code: 'week_full',
      message: 'That week is full. Tick Override this week to go ahead.',
      nth: 3,
    });
    const ok = await post(guest, { overrideWeek: true });
    expect(ok.status).toBe(200);
    expect((await row(guest)).status).toBe('locked');
  });

  it('Suggest another time and Move to stand-by work for that guest (they answered not_allowed), and detach them', async () => {
    const { guest } = await orphanOf(range('2027-04-23', '10:00', '12:00'));
    expect((await row(guest)).locked_starts_at).not.toBeNull(); // the old host's time, kept for Make host
    expect((await suggestTimes(guest, { slotIds: [await slotId('2027-04-22', 'lunch')] }, '', OPEN)).ok).toBe(
      true,
    );
    expect(await row(guest)).toMatchObject({
      status: 'needs_new_time',
      joined_to_request_id: null,
      locked_starts_at: null,
      locked_slot_id: null,
    });
    const other = await orphanOf(range('2027-04-23', '13:00', '14:00'));
    expect(await moveToStandby(other.guest, '2027-04-19', OPEN)).toEqual({ ok: true });
    expect(await row(other.guest)).toMatchObject({ status: 'standby', joined_to_request_id: null });
  });

  it('a guest still riding a live host is not offered times of its own', async () => {
    const host = await locked(range('2027-04-23', '15:00', '16:00'));
    const guest = await newRequest();
    expect(await joinToBooking(guest, host, OPEN)).toMatchObject({ ok: true });
    expect(
      await suggestTimes(guest, { slotIds: [await slotId('2027-04-22', 'lunch')] }, '', OPEN),
    ).toMatchObject({
      ok: false,
      status: 409,
      reason: 'not_allowed',
    });
  });
});
