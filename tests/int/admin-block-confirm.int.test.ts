// T2.5.02 (TSD T2.5 AC3): a block or away range over locked bookings: preview (409 + the list) → Jon confirms,
// with fresh times per booking or none → each goes to needs_new_time, its event is deleted (calendar_delete) and
// the guest gets E5b. Through the admin route, as the A4 sheet will call it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { POST as blocksRoute } from '@/app/api/admin/season/blocks/route';
import { POST as confirmRoute } from '@/app/api/admin/season/blocks/confirm/route';
import { GET as previewRoute } from '@/app/api/admin/season/blocks/preview/route';
import { E5B_PARTS } from '@/content/emails';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { openWindows } from '@/features/availability';
import { confirmBlock } from '@/features/admin/block-confirm';
import { findToken, issueManageToken, manageExpiry } from '@/features/invites/action-tokens';
import { withTx } from '@/lib/db';
import { block, previewBlock } from '@/features/admin/season';
import { vancouverInstant } from '@/lib/time';
import { cancelMade, joinDirect, lockDirect, newRequest, slotId } from '../fixtures/requests-db';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const WEEK = { startDate: '2027-06-07', endDate: '2027-06-13', kind: 'blocked' } as const;
const blocks: string[] = [];
/** Blocks this file adds, by date (a run that failed half-way leaves no ids behind). */
describe('a block that sends a booking back to a new time keeps its manage links alive', () => {
  it('the host and its joined guest: live manage links last the unlocked lifetime, not the old end + 7 days', async () => {
    const now = new Date('2027-06-01T18:00:00Z');
    const host = await booked('Block Links', '2027-06-25', 'lunch');
    const joiner = await newRequest({ name: 'Block Links Joiner' });
    await joinDirect(joiner, host);
    const links = await withTx(async (c) =>
      Promise.all([host, joiner].map((id) => issueManageToken(c, id, now))),
    );
    const [end] = await q<{ e: Date }>(`select locked_ends_at e from request where id = $1`, [host]);
    expect((await findToken(links[0]!))!.expires_at).toEqual(manageExpiry(end!.e, now));
    const res = await confirmBlock(
      {
        block: {
          startDate: '2027-06-21',
          endDate: '2027-06-27',
          kind: 'blocked',
          confirmBy: null,
          note: null,
        },
        bookings: [{ requestId: host }],
      },
      now,
    );
    expect(res).toMatchObject({ ok: true, moved: [host] });
    for (const raw of links) expect((await findToken(raw))!.expires_at).toEqual(manageExpiry(null, now));
    await cancel([host, joiner]);
    if (res.ok) await q(`delete from availability_block where id = $1`, [res.id]);
  });
});

const clearBlocks = () =>
  q(
    `delete from availability_block where start_date between '2027-05-31' and '2027-06-27' or id = any($1::uuid[])`,
    [blocks],
  );

beforeAll(clearBlocks);
afterAll(async () => {
  await clearBlocks();
  await q(`update offer set released_at = now() where released_at is null and taken_at is null
             and request_id in (select id from request where contact_name like 'Block %')`);
  await cancelMade();
  await pool().end();
});

const post = (route: (r: NextRequest) => Promise<Response>, path: string, body: unknown) =>
  route(
    new NextRequest(`${SITE}${path}`, {
      method: 'POST',
      headers: { origin: SITE, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const confirm = (body: unknown) => post(confirmRoute, '/api/admin/season/blocks/confirm', body);
const json = async <T>(res: Response) => (await res.json()) as T;

/** A locked booking on a slot, with a live event on "Time with Jon". */
async function booked(name: string, date: string, w: 'lunch' | 'evening'): Promise<string> {
  const id = await newRequest({ name });
  await lockDirect(id, { slotId: await slotId(date, w) });
  await q(`update request set google_event_id = $2, calendar_state = 'synced' where id = $1`, [
    id,
    `evt-${id}`,
  ]);
  return id;
}
const cancel = (ids: string[]) =>
  q(`update request set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[])`, [ids]);
const row = async (id: string) =>
  (
    await q<{
      status: string;
      locked_starts_at: Date | null;
      locked_slot_id: string | null;
      awaiting: boolean;
      google_event_id: string | null;
    }>(
      `select status, locked_starts_at, locked_slot_id, awaiting_jon_since is not null as awaiting, google_event_id
         from request where id = $1`,
      [id],
    )
  )[0]!;
const e5b = (id: string) =>
  q<{ event_key: string; status: string; vars: { openTimes: string; takeLink: unknown; dish: string } }>(
    `select event_key, status, vars from email_log where request_id = $1 and template = 'E5b'`,
    [id],
  );
const blockCount = async () =>
  Number(
    (
      await q<{ n: string }>(
        `select count(*) n from availability_block where start_date = $1 and end_date = $2`,
        [WEEK.startDate, WEEK.endDate],
      )
    )[0]!.n,
  );

/** The guest picker's windows for a week (engine clock before the season, as in admin-season.int.test.ts). */
const pickerWeek = async (weekStart: string) =>
  openWindows(
    engineInput(await loadEngineData(new Date('2027-03-10T18:00:00Z')), [], 'general', ['lunch', 'evening']),
  ).weeks.find((w) => w.weekStart === weekStart)!;

describe('T2.5.02 rule 3: joined guests follow their host (cascadeToJoined, #52)', () => {
  it.each([
    { offer: true, w: 'lunch' as const },
    { offer: false, w: 'evening' as const },
  ])(
    'host offer=$offer: 2 joined guests go to needs_new_time awaiting Jon, keep the range, one E5b each with no times or link, no calendar rows',
    async ({ offer, w }) => {
      const week = { startDate: '2027-06-21', endDate: '2027-06-27', kind: 'blocked' };
      const host = await booked('Block Host', '2027-06-25', w);
      const joiners = [
        await newRequest({ name: 'Block Joiner' }),
        await newRequest({ name: 'Block Joiner' }),
      ];
      for (const j of joiners) await joinDirect(j, host);
      const [hostRange] = await q<{ s: Date; e: Date }>(
        `select locked_starts_at s, locked_ends_at e from request where id = $1`,
        [host],
      );
      const choice = offer
        ? { requestId: host, slotIds: [await slotId('2027-06-17', 'lunch')] }
        : { requestId: host };

      const res = await confirm({ block: week, bookings: [choice] });
      expect(res.status).toBe(201);
      const body = await json<{ id: string; moved: string[] }>(res);
      blocks.push(body.id);
      expect(body.moved).toEqual([host]);

      expect(await row(host)).toMatchObject({
        status: 'needs_new_time',
        awaiting: !offer,
        google_event_id: null,
      });
      const hostMails = await e5b(host);
      expect(hostMails).toHaveLength(1);
      expect(hostMails[0]!.vars.takeLink === '').toBe(!offer);
      const [audit] = await q<{ id: string }>(
        `select id from audit_log where request_id = $1 and action = 'blocked_over' and actor = 'jon'`,
        [host],
      );

      for (const joiner of joiners) {
        const [j] = await q<{ status: string; awaiting: boolean; s: Date; e: Date; joined_to: string }>(
          `select status, awaiting_jon_since is not null awaiting, locked_starts_at s, locked_ends_at e,
                  joined_to_request_id joined_to
             from request where id = $1`,
          [joiner],
        );
        expect(j).toMatchObject({
          status: 'needs_new_time',
          awaiting: true,
          s: hostRange!.s,
          e: hostRange!.e,
          joined_to: host,
        });
        expect(await e5b(joiner)).toEqual([
          expect.objectContaining({
            event_key: audit!.id,
            vars: expect.objectContaining({ openTimes: E5B_PARTS.noTimes, takeLink: '' }),
          }),
        ]);
        expect(
          await q(
            `select 1 from audit_log where request_id = $1 and action = 'blocked_over' and actor = 'system'`,
            [joiner],
          ),
        ).toHaveLength(1);
      }
      // The host's calendar_delete drops them from the event: nothing of their own (no outbox row, no .ics;
      // E1/E2 are their intake mail).
      expect(await q(`select 1 from outbox where request_id = any($1::uuid[])`, [joiners])).toEqual([]);
      expect(
        await q(
          `select template from email_log where request_id = any($1::uuid[]) and template not in ('E1', 'E2', 'E5b')`,
          [joiners],
        ),
      ).toEqual([]);
      expect(
        await q(`select 1 from outbox where request_id = $1 and kind = 'calendar_delete'`, [host]),
      ).toHaveLength(1);
      // Out of the way of the .ics case below, which blocks this week too.
      await cancel([host, ...joiners]);
      await q(`delete from availability_block where id = $1`, [body.id]);
    },
  );
});

describe('T2.5.04: T2.5 AC3 as written', () => {
  it('blocking a week with 1 locked booking sends E5b after confirmation, the event is deleted, the week is gone from the picker', async () => {
    const week = { startDate: '2027-05-31', endDate: '2027-06-06', kind: 'blocked' };
    const id = await booked('Block One', '2027-06-03', 'lunch');
    const pre = await post(blocksRoute, '/api/admin/season/blocks', week);
    expect(pre.status).toBe(409); // the preview: nothing yet
    expect(await e5b(id)).toEqual([]);

    const res = await confirm({ block: week, bookings: [{ requestId: id }] });
    expect(res.status).toBe(201);
    blocks.push((await json<{ id: string }>(res)).id);
    expect(await e5b(id)).toEqual([expect.objectContaining({ status: 'sent' })]);
    expect(await row(id)).toMatchObject({ status: 'needs_new_time', google_event_id: null });
    // The booking's range is freed, so only the block keeps the week's windows off the picker (AC1).
    expect((await pickerWeek('2027-05-31')).windows).toEqual([]);
  });
});

describe('T2.5.02: confirm a block over locked bookings (T2.5 AC3)', () => {
  it('stale or wrong choices change nothing: the new list comes back (409), bad times are refused', async () => {
    const a = await booked('Block Stale', '2027-06-10', 'lunch');
    const pre = await post(blocksRoute, '/api/admin/season/blocks', WEEK);
    expect(pre.status).toBe(409);
    expect((await json<{ affected: { id: string }[] }>(pre)).affected.map((x) => x.id)).toEqual([a]);

    // Jon previewed an empty week, or named a booking that isn't there: 409 with what is really there.
    const other = { requestId: '5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b' };
    for (const bookings of [[], [other], [{ requestId: a }, other]]) {
      const res = await confirm({ block: WEEK, bookings });
      expect(res.status).toBe(409);
      const body = await json<{ code: string; affected: { id: string }[] }>(res);
      expect([body.code, body.affected.map((x) => x.id)]).toEqual(['locked_bookings', [a]]);
    }
    // An unknown slot (404), a time already gone (409), a range that doesn't exist in Vancouver (400).
    const unknown = { requestId: a, slotIds: ['5c1e9a0b-7d2f-4c3e-8a1b-2c3d4e5f6a7b'] };
    const past = { requestId: a, ranges: [{ date: '2026-01-05', start: '12:00', lengthMinutes: 60 }] };
    // 2026-03-08 is a spring-forward gap under tzdata 2026a and 2026c (BC has none from 2026-11-01 in 2026c);
    // the gap is refused (400) before the in-the-past check (409).
    const dstGap = { requestId: a, ranges: [{ date: '2026-03-08', start: '02:30', lengthMinutes: 60 }] };
    expect((await confirm({ block: WEEK, bookings: [unknown] })).status).toBe(404);
    expect((await confirm({ block: WEEK, bookings: [past] })).status).toBe(409);
    expect((await confirm({ block: WEEK, bookings: [dstGap] })).status).toBe(400);
    // ENG-18: a time outside the season (Thu Jul 8) is refused, as Suggest another time refuses it.
    const july = { requestId: a, ranges: [{ date: '2027-07-08', start: '12:00', lengthMinutes: 120 }] };
    const offSeason = await confirm({ block: WEEK, bookings: [july] });
    expect([offSeason.status, (await json<{ code: string }>(offSeason)).code]).toEqual([
      409,
      'out_of_season',
    ]);
    // Malformed: a duplicate booking, an unknown key, a bad block.
    expect((await confirm({ block: WEEK, bookings: [{ requestId: a }, { requestId: a }] })).status).toBe(400);
    expect((await confirm({ block: WEEK, bookings: [{ requestId: a, lead: 'x' }] })).status).toBe(400);
    expect((await confirm({ block: { ...WEEK, endDate: '2027-06-01' }, bookings: [] })).status).toBe(400);
    // Outside the season: refused before anything else.
    const outside = await confirm({
      block: { ...WEEK, startDate: '2027-07-05', endDate: '2027-07-06' },
      bookings: [],
    });
    expect([outside.status, (await json<{ code: string }>(outside)).code]).toEqual([400, 'out_of_season']);

    expect(await blockCount()).toBe(0);
    expect(await row(a)).toMatchObject({ status: 'locked', google_event_id: `evt-${a}` });
    expect(await e5b(a)).toEqual([]);
    await q(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [a]);
  });

  it("AC3: each booking moves to needs_new_time, its event is deleted, and E5b goes with Jon's times or none", async () => {
    const withTimes = await booked('Block Offered', '2027-06-10', 'evening');
    const noTimes = await booked('Block Waiting', '2027-06-11', 'lunch');
    // Lunches: the booking is a Long Lunch, never offered an evening (CR-05).
    const offered = [await slotId('2027-06-17', 'lunch'), await slotId('2027-06-18', 'lunch')];
    // A stale live offer on the booking (defence in depth): released, only Jon's new one stays live.
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', $2)`, [
      withTimes,
      [await slotId('2027-06-17', 'evening')],
    ]);
    const res = await confirm({
      block: WEEK,
      bookings: [{ requestId: noTimes }, { requestId: withTimes, slotIds: offered }],
    });
    expect(res.status).toBe(201);
    const body = await json<{ ok: true; id: string; moved: string[] }>(res);
    blocks.push(body.id);
    expect(body.moved.sort()).toEqual([withTimes, noTimes].sort());
    expect(await blockCount()).toBe(1);

    // The window frees at once; the event is gone (the calendar_delete ran after commit).
    for (const id of [withTimes, noTimes]) {
      expect(await row(id)).toMatchObject({
        status: 'needs_new_time',
        locked_starts_at: null,
        locked_slot_id: null,
        google_event_id: null,
      });
      expect(
        await q(
          `select done_at is not null as done from outbox where request_id = $1 and kind = 'calendar_delete'`,
          [id],
        ),
      ).toEqual([{ done: true }]);
    }
    // With times: a live suggested_times offer, the guest's turn (no wait on Jon), E5b with the times + one link.
    const live = await q<{ id: string; kind: string; slot_ids: string[] }>(
      `select id, kind, slot_ids from offer where request_id = $1 and released_at is null`,
      [withTimes],
    );
    expect(live).toHaveLength(1);
    const [offer] = live;
    expect([offer!.kind, [...offer!.slot_ids].sort()]).toEqual(['suggested_times', [...offered].sort()]);
    expect((await row(withTimes)).awaiting).toBe(false);
    const [mail] = await e5b(withTimes);
    expect(mail).toMatchObject({ event_key: offer!.id, status: 'sent' });
    expect(mail!.vars.openTimes).toMatch(/^These are still open:\n.+\n.+\nTap one and it’s yours\.$/);
    expect(mail!.vars.takeLink).toEqual({ link: 'take', offerId: offer!.id });
    const [audit] = await q<{ id: string; detail: unknown }>(
      `select id, detail from audit_log where request_id = $1 and action = 'blocked_over'`,
      [withTimes],
    );
    expect(audit!.detail).toEqual({
      from_status: 'locked',
      to_status: 'needs_new_time',
      offer_id: offer!.id,
    });

    // No times: no offer, it waits on Jon (Needs a reply), E5b says new times will follow, no link.
    expect(await q(`select 1 from offer where request_id = $1`, [noTimes])).toEqual([]);
    expect((await row(noTimes)).awaiting).toBe(true);
    const [plain] = await e5b(noTimes);
    const [plainAudit] = await q<{ id: string; detail: unknown }>(
      `select id, detail from audit_log where request_id = $1 and action = 'blocked_over'`,
      [noTimes],
    );
    expect(plain).toMatchObject({ event_key: plainAudit!.id, status: 'sent' });
    expect([plain!.vars.openTimes, plain!.vars.takeLink]).toEqual([E5B_PARTS.noTimes, '']);
    expect(plainAudit!.detail).toEqual({ from_status: 'locked', to_status: 'needs_new_time' });

    // Done once: the same confirm again finds nothing locked there (409 with an empty list), no second E5b.
    const again = await confirm({ block: WEEK, bookings: [{ requestId: noTimes }] });
    expect(again.status).toBe(409);
    expect((await json<{ affected: unknown[] }>(again)).affected).toEqual([]);
    expect(await e5b(noTimes)).toHaveLength(1);
  });

  it("T3.4.05: a booking the guest has as an .ics (not Google's invite) also gets the .ics CANCEL for its time", async () => {
    const ics = await booked('Block Ics', '2027-06-24', 'lunch');
    const google = await booked('Block Google', '2027-06-24', 'evening');
    await q(`update request set calendar_state = 'ics_sent', google_event_id = null where id = $1`, [ics]);
    const [locked] = await q<{ s: Date }>(`select locked_starts_at s from request where id = $1`, [ics]);
    const week = { startDate: '2027-06-21', endDate: '2027-06-27', kind: 'blocked' };
    const res = await confirm({ block: week, bookings: [{ requestId: ics }, { requestId: google }] });
    expect(res.status).toBe(201);
    blocks.push((await json<{ id: string }>(res)).id);
    const e4c = (id: string) =>
      q<{ method: string; startsAt: string }>(
        `select vars->>'method' as method, vars->>'startsAt' as "startsAt" from email_log
          where request_id = $1 and template = 'E4c'`,
        [id],
      );
    expect(await e4c(ics)).toEqual([{ method: 'CANCEL', startsAt: locked!.s.toISOString() }]);
    expect(await e4c(google)).toEqual([]);
    expect(await e5b(ics)).toHaveLength(1);
  });

  it('a week with nothing locked is just a block (away mode too)', async () => {
    const res = await confirm({
      block: { startDate: '2027-06-14', endDate: '2027-06-14', kind: 'away', confirmBy: '2027-06-01' },
      bookings: [],
    });
    expect(res.status).toBe(201);
    const body = await json<{ id: string; moved: string[] }>(res);
    blocks.push(body.id);
    expect(body.moved).toEqual([]);
  });
});

const blockRows = (start: string, end: string) =>
  q<{ id: string }>(`select id from availability_block where start_date = $1 and end_date = $2`, [
    start,
    end,
  ]);

describe('pr59 H1: a guest cancel that commits mid-confirm is not overwritten', () => {
  it('confirm waits on the row lock, then sees the cancel: 409 locked_bookings, still cancelled, no E5b, no block', async () => {
    const day = { startDate: '2027-06-04', endDate: '2027-06-04', kind: 'blocked' };
    const id = await booked('Block Race', '2027-06-04', 'lunch');
    const other = await pool().connect();
    try {
      await other.query('begin');
      await other.query(`update request set status = 'cancelled', cancelled_at = now() where id = $1`, [id]);
      const pending = confirm({ block: day, bookings: [{ requestId: id }] });
      // Wait until the confirm is blocked on the guest's row lock, then let the cancel commit.
      for (let i = 0; i < 100; i++) {
        const [w] = await q<{ n: number }>(
          `select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`,
        );
        if (w!.n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await other.query('commit');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(await json<{ code: string; affected: unknown[] }>(res)).toMatchObject({
        code: 'locked_bookings',
        affected: [],
      });
    } finally {
      other.release();
    }
    expect((await row(id)).status).toBe('cancelled');
    expect(await e5b(id)).toEqual([]);
    expect(await blockRows('2027-06-04', '2027-06-04')).toEqual([]);
  });
});

describe('pr59 M1: an offered time inside a block is refused (409 in_block)', () => {
  it('inside the block being added, or inside a block already there; nothing written', async () => {
    // 06-17 and 06-18: no other block in this file covers them.
    const day = { startDate: '2027-06-17', endDate: '2027-06-17', kind: 'blocked' };
    const id = await booked('Block InBlock', '2027-06-17', 'evening');
    const inNew = await confirm({
      block: day,
      bookings: [{ requestId: id, slotIds: [await slotId('2027-06-17', 'lunch')] }],
    });
    expect(inNew.status).toBe(409);
    expect((await json<{ code: string }>(inNew)).code).toBe('in_block');

    const other = await post(blocksRoute, '/api/admin/season/blocks', {
      startDate: '2027-06-18',
      endDate: '2027-06-18',
      kind: 'blocked',
    });
    expect(other.status).toBe(201);
    const otherId = (await json<{ id: string }>(other)).id;
    const inOld = await confirm({
      block: day,
      bookings: [{ requestId: id, ranges: [{ date: '2027-06-18', start: '12:00', lengthMinutes: 90 }] }],
    });
    expect(inOld.status).toBe(409);
    expect((await json<{ code: string }>(inOld)).code).toBe('in_block');

    // pr59-verify N1: every date a window touches counts, as at canLock, not just its start date.
    const refusedWith = async (ranges: { date: string; start: string; lengthMinutes: number }[]) => {
      const res = await confirm({ block: day, bookings: [{ requestId: id, ranges }] });
      return [res.status, (await json<{ code: string }>(res)).code];
    };
    // 23:00 the night before, into the new block
    expect(await refusedWith([{ date: '2027-06-16', start: '23:00', lengthMinutes: 120 }])).toEqual([
      409,
      'in_block',
    ]);
    // 72 h from a free day, ending inside the new block (and the one on 06-18)
    expect(await refusedWith([{ date: '2027-06-15', start: '00:30', lengthMinutes: 72 * 60 }])).toEqual([
      409,
      'in_block',
    ]);
    // 23:00 on a free day, into a block already there (06-20), clear of the new one
    const sunday = await post(blocksRoute, '/api/admin/season/blocks', {
      startDate: '2027-06-20',
      endDate: '2027-06-20',
      kind: 'blocked',
    });
    const sundayId = (await json<{ id: string }>(sunday)).id;
    expect(await refusedWith([{ date: '2027-06-19', start: '23:00', lengthMinutes: 120 }])).toEqual([
      409,
      'in_block',
    ]);

    expect((await row(id)).status).toBe('locked');
    expect(await e5b(id)).toEqual([]);
    expect(await blockRows('2027-06-17', '2027-06-17')).toEqual([]);
    await q(`delete from availability_block where id = any($1::uuid[])`, [[otherId, sundayId]]);
    await cancel([id]);
  });
});

describe('the block-confirm check is the engine block rule (blockedBy, as canLock and Suggest ask it)', () => {
  it('a range over midnight into a new single-window block is refused; the same night ending at its start is not', async () => {
    const lunch = { startDate: '2027-06-17', endDate: '2027-06-17', kind: 'blocked', window: 'lunch' };
    const id = await booked('Block Window Rule', '2027-06-17', 'lunch');
    const res = await confirm({
      block: lunch,
      bookings: [
        { requestId: id, ranges: [{ date: '2027-06-16', start: '23:00', lengthMinutes: 13 * 60 + 30 }] },
      ],
    });
    expect(res.status).toBe(409);
    expect((await json<{ code: string }>(res)).code).toBe('in_block');
    expect(await blockRows('2027-06-17', '2027-06-17')).toEqual([]);
    const clear = await confirm({
      block: lunch,
      bookings: [{ requestId: id, ranges: [{ date: '2027-06-16', start: '23:00', lengthMinutes: 13 * 60 }] }],
    });
    expect(clear.status).toBe(201);
    await q(`delete from availability_block where start_date = '2027-06-17'`);
    await cancel([id]);
  });
});

describe('pr59 L2: a double tap adds one block', () => {
  it('confirm with no bookings, and POST /blocks, return the same row the second time', async () => {
    const day = { startDate: '2027-06-01', endDate: '2027-06-01', kind: 'blocked' };
    const a = await confirm({ block: day, bookings: [] });
    const b = await confirm({ block: day, bookings: [] });
    const c = await post(blocksRoute, '/api/admin/season/blocks', day);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    const ids = [
      await json<{ id: string }>(a),
      await json<{ id: string }>(b),
      await json<{ id: string }>(c),
    ].map((x) => x.id);
    expect(new Set(ids).size).toBe(1);
    expect(await blockRows('2027-06-01', '2027-06-01')).toEqual([{ id: ids[0] }]);
    const audits = await q(
      `select 1 from audit_log where actor = 'jon' and action = 'block_added' and at > now() - interval '1 minute'`,
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe('pr59 L4: a booking already under way is left to finish', () => {
  it('not in the affected set: the block goes on around it, the booking stays locked, no E5b', async () => {
    const id = await booked('Block Underway', '2027-06-18', 'evening');
    const day = {
      startDate: '2027-06-18',
      endDate: '2027-06-18',
      kind: 'blocked' as const,
      confirmBy: null,
      note: null,
    };
    const midway = new Date('2027-06-19T03:00:00Z'); // the 02:00–05:00Z evening, an hour in
    const res = await confirmBlock({ block: day, bookings: [] }, midway);
    expect(res).toMatchObject({ ok: true, moved: [], underWay: [expect.objectContaining({ id })] });
    expect((await row(id)).status).toBe('locked');
    expect(await e5b(id)).toEqual([]);
    const early = await confirmBlock(
      { block: { ...day, startDate: '2027-06-17' }, bookings: [] },
      new Date('2027-06-18T12:00:00Z'),
    );
    expect(early).toMatchObject({ ok: false, status: 409, reason: 'locked_bookings' });
    await cancel([id]);
  });
});

describe('T2.5.05: the preview and POST /blocks name a booking already under way (decision 30, #21 (b))', () => {
  const day = (startDate: string, endDate = startDate) => ({
    startDate,
    endDate,
    kind: 'blocked' as const,
    confirmBy: null,
    note: null,
  });

  it('pr69 L1: a confirm naming a booking that started after the preview is refused (409), nothing moved', async () => {
    const id = await booked('Block Underway Late', '2027-06-24', 'evening');
    const starts = new Date('2027-06-25T02:00:00Z');
    // Previewed before it started: it's in `affected`, so Jon's confirm names it.
    expect(
      (await previewBlock('2027-06-24', '2027-06-24', new Date(starts.getTime() - 60_000))).affected,
    ).toEqual([expect.objectContaining({ id })]);
    const res = await confirmBlock(
      { block: day('2027-06-24'), bookings: [{ requestId: id }] },
      new Date(starts.getTime() + 60_000),
    );
    expect(res).toEqual({
      ok: false,
      status: 409,
      reason: 'locked_bookings',
      affected: [],
      underWay: [expect.objectContaining({ id })],
    });
    expect((await row(id)).status).toBe('locked');
    expect(await e5b(id)).toEqual([]);
    expect(await q(`select 1 from outbox where request_id = $1`, [id])).toEqual([]);
    expect(await blockRows('2027-06-24', '2027-06-24')).toEqual([]);
    await cancel([id]);
  });

  it('preview with one under-way booking returns it; block and confirm leave it untouched', async () => {
    const id = await booked('Block Underway Preview', '2027-06-24', 'evening');
    const midway = new Date('2027-06-25T03:00:00Z'); // the 02:00–05:00Z evening, an hour in
    expect(await previewBlock('2027-06-24', '2027-06-24', midway)).toEqual({
      affected: [],
      underWay: [
        {
          id,
          contactName: 'Block Underway Preview',
          dish: expect.any(String),
          startsAt: '2027-06-25T02:00:00.000Z',
          endsAt: '2027-06-25T05:00:00.000Z',
          joinedGuests: 0,
        },
      ],
    });
    // POST /blocks (the service; the route adds no clock of its own) goes on around it and names it.
    const added = await block(day('2027-06-24'), midway);
    expect(added).toMatchObject({ ok: true, underWay: [expect.objectContaining({ id })] });
    if (added.ok) blocks.push(added.id);
    const confirmed = await confirmBlock({ block: day('2027-06-24'), bookings: [] }, midway);
    expect(confirmed).toMatchObject({ ok: true, moved: [], underWay: [expect.objectContaining({ id })] });
    const after = await row(id);
    expect(after.status).toBe('locked');
    expect(after.locked_starts_at?.toISOString()).toBe('2027-06-25T02:00:00.000Z');
    expect(after.google_event_id).toBe(`evt-${id}`);
    expect(await e5b(id)).toEqual([]);
    expect(await q(`select 1 from outbox where request_id = $1 and kind = 'calendar_delete'`, [id])).toEqual(
      [],
    );
    await cancel([id]);
  });

  it('the edges: starting exactly now is under way, ending exactly now is Done; the range still bounds it', async () => {
    const id = await booked('Block Underway Edge', '2027-06-24', 'evening');
    const starts = new Date('2027-06-25T02:00:00Z');
    const ends = new Date('2027-06-25T05:00:00Z');
    expect((await previewBlock('2027-06-24', '2027-06-24', starts)).underWay.map((b) => b.id)).toEqual([id]);
    expect(await previewBlock('2027-06-24', '2027-06-24', ends)).toEqual({ affected: [], underWay: [] });
    // A minute before it starts it's ahead: moved by a block, not under way.
    const before = new Date(starts.getTime() - 60_000);
    expect(await previewBlock('2027-06-24', '2027-06-24', before)).toMatchObject({
      affected: [expect.objectContaining({ id })],
      underWay: [],
    });
    // Outside the dates: in neither list.
    expect(await previewBlock('2027-06-26', '2027-06-26', starts)).toEqual({ affected: [], underWay: [] });
    await cancel([id]);
  });

  it('a 409 over a booking still ahead carries the under-way ones too, through the routes', async () => {
    const now = new Date('2027-06-25T03:00:00Z');
    const going = await booked('Block Underway Going', '2027-06-24', 'evening');
    const ahead = await newRequest({ name: 'Block Underway Ahead' });
    await lockDirect(ahead, {
      startsAt: vancouverInstant('2027-06-26', '12:00'),
      endsAt: vancouverInstant('2027-06-26', '14:00'),
    });
    const range = day('2027-06-24', '2027-06-26');
    expect(await previewBlock(range.startDate, range.endDate, now)).toMatchObject({
      affected: [expect.objectContaining({ id: ahead })],
      underWay: [expect.objectContaining({ id: going })],
    });
    expect(await block(range, now)).toMatchObject({
      ok: false,
      status: 409,
      reason: 'locked_bookings',
      affected: [expect.objectContaining({ id: ahead })],
      underWay: [expect.objectContaining({ id: going })],
    });
    expect(await confirmBlock({ block: range, bookings: [] }, now)).toMatchObject({
      ok: false,
      status: 409,
      affected: [expect.objectContaining({ id: ahead })],
      underWay: [expect.objectContaining({ id: going })],
    });
    // The route's JSON carries both lists (real clock: nothing is under way yet, so underWay is []).
    const res = await post(blocksRoute, '/api/admin/season/blocks', range);
    expect(res.status).toBe(409);
    const body = await json<{ affected: { id: string }[]; underWay: unknown[] }>(res);
    expect(body.affected.map((a) => a.id)).toEqual([going, ahead]);
    expect(body.underWay).toEqual([]);
    const qs = `startDate=${range.startDate}&endDate=${range.endDate}`;
    const prev = await previewRoute(new NextRequest(`${SITE}/api/admin/season/blocks/preview?${qs}`));
    expect(await json(prev)).toEqual({
      ok: true,
      affected: [expect.objectContaining({ id: going }), expect.objectContaining({ id: ahead })],
      underWay: [],
    });
    expect((await row(going)).status).toBe('locked');
    expect(await blockRows('2027-06-24', '2027-06-26')).toEqual([]);
    await cancel([going, ahead]);
  });
});
