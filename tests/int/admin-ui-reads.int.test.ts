// U5 (Q2, additive reads for A2/A3): the inbox card and the request detail carry the fields the screens draw
// (counts, invite kind, cancel/close, bounce, RSVP, join host, each time's reason and week), against the real test
// DB. Reads only; never the sealed plan (the static guard covers the SQL; the canary here covers the output).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pool, q } from '@/lib/db';
import { listRequests } from '@/features/admin/inbox';
import { getRequestDetail } from '@/features/admin/detail';
import { OPEN_TIMES_LIMIT, requestOptions, STANDBY_WEEKS } from '@/features/admin/options';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));

const CANARY = 'SEALED-PLAN-CANARY-U5';
const mine: string[] = [];
let guestId = '';
let inviteId = '';
let personalInviteId: string | null = null;

async function makeRequest(cols: Record<string, unknown>): Promise<string> {
  const base: Record<string, unknown> = {
    is_test: true,
    client_key: randomUUID(),
    guest_id: guestId,
    invite_id: inviteId,
    contact_name: 'UI Read Test',
    contact_email: 'ui-read@example.com',
    dish: 'the-long-lunch',
    mode: 'slots',
    counts_toward: 'weekly_cap',
    ...cols,
  };
  const keys = Object.keys(base);
  const [row] = await q<{ id: string }>(
    `insert into request (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    keys.map((k) => base[k]),
  );
  mine.push(row!.id);
  return row!.id;
}

const cardIn = async (tab: Parameters<typeof listRequests>[0], id: string) =>
  (await listRequests(tab)).cards.find((c) => c.id === id);

beforeAll(async () => {
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general' limit 1`))[0]!.id;
  personalInviteId =
    (await q<{ id: string }>(`select id from invite where kind = 'personal' limit 1`))[0]?.id ?? null;
  guestId = (
    await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `ui-read+${randomUUID().slice(0, 8)}@example.com`,
    ])
  )[0]!.id;
});

afterAll(async () => {
  await q(`delete from request where id = any($1::uuid[])`, [mine]);
  await q(`delete from guest where id = $1`, [guestId]);
  await pool().end();
});

describe('InboxCard: the A2 row fields', () => {
  it('counts picked times, dates and a pitch’s words; never the plan', async () => {
    const slots = await q<{ id: string }>(
      `select id from slot where window_kind = 'lunch' order by starts_at limit 3`,
    );
    const withTimes = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      surprise_plan_sealed: CANARY,
    });
    for (const s of slots) {
      await q(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [withTimes, s.id]);
    }
    const dated = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      mode: 'dates',
      dish: 'the-shore-ride',
      date_prefs: JSON.stringify({ dates: ['2027-05-08', '2027-05-16'], window_text: null }),
    });
    const pitch = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      mode: 'dates',
      dish: 'pitch-me',
      date_prefs: JSON.stringify({ dates: [], window_text: 'sometime in June' }),
    });
    const junk = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      mode: 'dates',
      date_prefs: JSON.stringify({ dates: 'not a list', window_text: '' }),
    });
    const cards = (await listRequests('needs_reply')).cards;
    const by = (id: string) => cards.find((c) => c.id === id)!;
    expect(by(withTimes)).toMatchObject({
      timesCount: 3,
      datesCount: 0,
      windowText: null,
      inviteKind: 'general',
    });
    expect(by(dated)).toMatchObject({ timesCount: 0, datesCount: 2, windowText: null });
    expect(by(pitch)).toMatchObject({ datesCount: 0, windowText: 'sometime in June' });
    expect(by(junk)).toMatchObject({ datesCount: 0, windowText: null });
    expect(JSON.stringify(cards)).not.toContain(CANARY);
  });

  it('a cancel says who and when; a close in person says so; counts_toward is read', async () => {
    const at = new Date('2027-03-03T17:00:00Z');
    const byGuest = await makeRequest({ status: 'cancelled', cancelled_at: at, cancelled_by: 'guest' });
    const closed = await makeRequest({
      status: 'cancelled',
      cancelled_at: at,
      cancelled_by: 'jon',
      closed_in_person: true,
    });
    expect(await cardIn('cancelled', byGuest)).toMatchObject({
      cancelledBy: 'guest',
      cancelledAt: at.toISOString(),
      closedInPerson: false,
      countsToward: 'weekly_cap',
    });
    expect(await cardIn('cancelled', closed)).toMatchObject({ cancelledBy: 'jon', closedInPerson: true });
  });

  it('the bounce and the RSVP flags reach the card', async () => {
    const id = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      contact_problem: 'bounced',
      guest_rsvp: 'no',
    });
    expect(await cardIn('needs_reply', id)).toMatchObject({ contactProblem: 'bounced', guestRsvp: 'no' });
  });
});

describe('RequestDetail: the A3 fields', () => {
  it('invite kind, flags, cancel fields and the join host', async () => {
    const host = await makeRequest({ status: 'cancelled', cancelled_by: 'jon', cancelled_at: new Date() });
    const id = await makeRequest({
      status: 'requested',
      awaiting_jon_since: new Date(),
      contact_problem: 'complained',
      guest_rsvp: 'maybe',
      counts_toward: 'big_day',
      surprise_plan_sealed: CANARY,
      ...(personalInviteId ? { invite_id: personalInviteId } : {}),
    });
    const d = await getRequestDetail(id);
    expect(d).toMatchObject({
      inviteKind: personalInviteId ? 'personal' : 'general',
      contactProblem: 'complained',
      guestRsvp: 'maybe',
      countsToward: 'big_day',
      cancelledAt: null,
      cancelledBy: null,
      closedInPerson: false,
      joinedToRequestId: null,
    });
    expect(JSON.stringify(d)).not.toContain(CANARY);
    const c = await getRequestDetail(host);
    expect(c).toMatchObject({ cancelledBy: 'jon', closedInPerson: false });
  });

  it('each picked time says why it’s gone, and its week’s count and cap', async () => {
    const slots = await q<{ id: string; date: string }>(
      `select id, date::text from slot where window_kind = 'lunch' and starts_at > now() order by starts_at limit 2`,
    );
    expect(slots).toHaveLength(2);
    const id = await makeRequest({ status: 'requested', awaiting_jon_since: new Date() });
    await q(`insert into request_slot_choice (request_id, slot_id) values ($1, $2), ($1, $3)`, [
      id,
      slots[0]!.id,
      slots[1]!.id,
    ]);
    const [block] = await q<{ id: string }>(
      `insert into availability_block (start_date, end_date, kind) values ($1, $1, 'blocked') returning id`,
      [slots[1]!.date],
    );
    try {
      const d = (await getRequestDetail(id))!;
      const t = Object.fromEntries(d.times.map((x) => [x.slotId, x]));
      expect(t[slots[1]!.id]).toMatchObject({ state: 'gone', why: 'blocked' });
      const open = t[slots[0]!.id]!;
      expect(open.state === 'open' ? open.why : 'n/a').toBe(open.state === 'open' ? null : 'n/a');
      for (const x of d.times) {
        expect(x.week.start <= x.date).toBe(true);
        expect(x.week.cap).toBeGreaterThanOrEqual(0);
        expect(x.week.count).toBeGreaterThanOrEqual(0);
        expect(x.state === 'open').toBe(x.why === null);
      }
    } finally {
      await q(`delete from availability_block where id = $1`, [block!.id]);
    }
  });
});

describe('requestOptions: what the A3 sheets offer', () => {
  it('open times skip their own picks, are open by the engine and capped; weeks start at their pick', async () => {
    const [pick] = await q<{ id: string; date: string }>(
      `select id, date::text from slot where window_kind = 'lunch' and starts_at > now() order by starts_at limit 1`,
    );
    const id = await makeRequest({ status: 'requested', awaiting_jon_since: new Date() });
    await q(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [id, pick!.id]);
    const o = (await requestOptions(id))!;
    expect(o.openTimes.length).toBeLessThanOrEqual(OPEN_TIMES_LIMIT);
    expect(o.openTimes.map((t) => t.slotId)).not.toContain(pick!.id);
    const starts = o.openTimes.map((t) => t.startsAt);
    expect([...starts].sort()).toEqual(starts);
    for (const t of o.openTimes) expect(new Date(t.startsAt).getTime()).toBeGreaterThan(Date.now());
    expect(o.weeks.length).toBeLessThanOrEqual(STANDBY_WEEKS);
    expect(o.weeks[0]!.firstDate <= pick!.date && pick!.date <= o.weeks[0]!.lastDate).toBe(true);
    expect(await requestOptions(randomUUID())).toBeNull();
  });

  it('join hosts: a locked booking whose time overlaps one of their picks, never itself or a cancelled one', async () => {
    const [slot] = await q<{ id: string; starts_at: Date; ends_at: Date }>(
      `select id, starts_at, ends_at from slot where starts_at > now() + interval '30 days'
        and not exists (select 1 from request r where r.status = 'locked'
                         and tstzrange(r.locked_starts_at, r.locked_ends_at) && tstzrange(slot.starts_at, slot.ends_at))
        order by starts_at limit 1`,
    );
    const host = await makeRequest({
      status: 'locked',
      contact_name: 'Host Priya',
      locked_slot_id: slot!.id,
      locked_starts_at: slot!.starts_at,
      locked_ends_at: slot!.ends_at,
    });
    await makeRequest({ status: 'cancelled', cancelled_by: 'guest', cancelled_at: new Date() });
    const joiner = await makeRequest({ status: 'requested', awaiting_jon_since: new Date() });
    await q(`insert into request_slot_choice (request_id, slot_id) values ($1, $2)`, [joiner, slot!.id]);
    const o = (await requestOptions(joiner))!;
    expect(o.joinHosts).toEqual([
      {
        hostId: host,
        name: 'Host Priya',
        startsAt: slot!.starts_at.toISOString(),
        endsAt: slot!.ends_at.toISOString(),
      },
    ]);
    expect((await requestOptions(host))!.joinHosts).toEqual([]);
  });

  it("QA r2 M3: a date dish's stand-by weeks start at the guest's own dates, open by the engine's date rules", async () => {
    // Season time (booking open): the weeks' state is the engine's, not 'closed'. Jun 5 2027 is a Saturday.
    const now = new Date('2027-03-15T18:00:00Z');
    const id = await makeRequest({
      status: 'requested',
      awaiting_jon_since: now,
      mode: 'dates',
      dish: 'the-grind',
      counts_toward: 'big_day',
      date_prefs: JSON.stringify({ dates: ['2027-06-05', '2027-06-19'], window_text: null }),
    });
    const o = (await requestOptions(id, now))!;
    expect(o.weeks.map((w) => w.weekStart)).toEqual(['2027-05-31', '2027-06-14', '2027-06-21']);
    // The Grind takes Thu to Sun: the rows read "Jun 3–6", and a free week is open, never "full" for lack of slots.
    expect(o.weeks[0]).toMatchObject({ firstDate: '2027-06-03', lastDate: '2027-06-06', state: 'open' });
    expect(o.weeks[1]).toMatchObject({ firstDate: '2027-06-17', lastDate: '2027-06-20' });
    expect(o.openTimes).toEqual([]); // a date dish has no time slots to suggest
  });
});
