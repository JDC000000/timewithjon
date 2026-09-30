// T2.2.07 (TSD T2.2 AC2, AC4–AC6; §9 sealed-plan row, runtime half) against the real test DB, through the real
// GET /api/admin/requests[/id] handlers. Only the Supabase session is faked. The tab rules are checked as
// invariants over EVERY request in the database, so rows other tests leave behind are covered too.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q, withTx } from '@/lib/db';
import { applyScenario, SCENARIO_EMAIL } from '@/features/dev/scenarios';
import { currentAuthEmail } from '@/features/admin/supabase';
import { INBOX_TABS, type InboxTab } from '@/features/admin/inbox';
import { GET as list } from '@/app/api/admin/requests/route';
import { GET as detail } from '@/app/api/admin/requests/[id]/route';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({ adminAuthClient: vi.fn(), currentAuthEmail: vi.fn() }));

const SITE = 'http://localhost:3000';
const CANARY = 'SEALED-PLAN-CANARY';
const get = (url: string) => new NextRequest(`${SITE}${url}`);
const getTab = (tab: string) => list(get(`/api/admin/requests?tab=${tab}`));
const getDetail = (id: string) =>
  detail(get(`/api/admin/requests/${id}`), { params: Promise.resolve({ id }) });

const mine: string[] = [];
let guestId = '';
const guests: string[] = [];
let inviteId = '';
let surpriseId = '';

async function makeRequest(cols: Record<string, unknown>): Promise<string> {
  const base: Record<string, unknown> = {
    is_test: true,
    client_key: randomUUID(),
    guest_id: guestId,
    invite_id: inviteId,
    contact_name: 'Inbox Test',
    contact_email: 'inbox-test@example.com',
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

/** A random 2-hour window on a random day of the given year: no clash with other tests' locked rows. */
function lockRange(year: number): { locked_starts_at: Date; locked_ends_at: Date } {
  const start = new Date(
    Date.UTC(year, 0, 1) + Math.floor(Math.random() * 360) * 86_400_000 + 3_600_000 * 20,
  );
  start.setUTCMinutes(Math.floor(Math.random() * 60));
  return { locked_starts_at: start, locked_ends_at: new Date(start.getTime() + 7_200_000) };
}

beforeAll(async () => {
  vi.mocked(currentAuthEmail).mockResolvedValue('jon@example.com');
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general' limit 1`))[0]!.id;
  guestId = (
    await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `inbox+${randomUUID().slice(0, 8)}@example.com`,
    ])
  )[0]!.id;
  await withTx((c) => applyScenario(c, 'surprise-me'));
  surpriseId = (
    await q<{ id: string }>(`select id from request where contact_email = $1 and dish = 'surprise-me'`, [
      SCENARIO_EMAIL,
    ])
  )[0]!.id;

  const now = new Date();
  await makeRequest({ status: 'requested', awaiting_jon_since: now });
  await makeRequest({ status: 'requested', awaiting_jon_since: now, spam_suspect: true });
  await makeRequest({ status: 'needs_new_time', awaiting_jon_since: now });
  await makeRequest({ status: 'needs_new_time' });
  await makeRequest({ status: 'needs_new_time', spam_suspect: true });
  await makeRequest({ status: 'locked', ...lockRange(now.getUTCFullYear() + 5) });
  await makeRequest({ status: 'locked', ...lockRange(2020) }); // ended: lazy done (T2.8)
  await makeRequest({ status: 'done', ...lockRange(2019) });
  await makeRequest({ status: 'cancelled', cancelled_at: now, cancelled_by: 'guest' });
  await makeRequest({ status: 'requested', awaiting_jon_since: now, surprise_plan_sealed: '   ' });
  await makeRequest({ status: 'standby' }); // no wait on Jon: only the Stand-by tab holds it (pr27-verify V3)
});

afterAll(async () => {
  await q(`delete from request where id = any($1::uuid[])`, [mine]);
  await q(`delete from guest where id = any($1::uuid[])`, [[guestId, ...guests]]);
  await withTx((c) => applyScenario(c, 'empty'));
  await pool().end();
});

async function allTabs(): Promise<Record<InboxTab, { text: string; ids: string[] }>> {
  const out = {} as Record<InboxTab, { text: string; ids: string[] }>;
  for (const tab of INBOX_TABS) {
    const res = await getTab(tab);
    expect(res.status, tab).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    const body = JSON.parse(text) as { tab: string; cards: { id: string }[]; meter: { count: number } };
    expect(body.tab).toBe(tab);
    expect(typeof body.meter.count).toBe('number');
    out[tab] = { text, ids: body.cards.map((c) => c.id) };
  }
  return out;
}

describe('GET /api/admin/requests (T2.2 AC4–AC6)', () => {
  it('holds the tab rules for every request in the database', async () => {
    const tabs = await allTabs();
    const tabsOf = (id: string) => INBOX_TABS.filter((t) => tabs[t].ids.includes(id));
    const rows = await q<{ id: string; status: string; spam_suspect: boolean; awaiting: boolean }>(
      `select id, status, spam_suspect, awaiting_jon_since is not null as awaiting from request`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(mine.length + 1);
    for (const r of rows) {
      const where = tabsOf(r.id);
      if (r.spam_suspect)
        expect(where, `spam ${r.id}`).toEqual(['check']); // AC4
      else if (r.awaiting) expect(where, `awaiting ${r.id}`).toContain('needs_reply'); // AC5
      if (r.status === 'needs_new_time') expect(where, `needs_new_time ${r.id}`).toHaveLength(1); // AC6
      if (!r.spam_suspect && !r.awaiting) expect(where.length, `orphan ${r.id}`).toBeGreaterThan(0); // no request is lost
    }
  });

  it('puts each of this test’s requests in the tab it belongs to', async () => {
    const tabs = await allTabs();
    const where = mine.map((id) => INBOX_TABS.filter((t) => tabs[t].ids.includes(id)));
    expect(where).toEqual([
      ['needs_reply'],
      ['check'],
      ['needs_reply'],
      ['waiting'],
      ['check'],
      ['locked'],
      ['done'],
      ['done'],
      ['cancelled'],
      ['needs_reply'],
      ['standby'],
    ]);
  });

  it('never sends the sealed plan in any tab', async () => {
    const tabs = await allTabs();
    expect(tabs.needs_reply.ids).toContain(surpriseId);
    for (const tab of INBOX_TABS) expect(tabs[tab].text, tab).not.toContain(CANARY);
  });

  it('counts Big Days locked in or done, not joined ones, against the target (T2.2.04)', async () => {
    const meter = async () =>
      ((await (await getTab('locked')).json()) as { meter: { count: number; target: number } }).meter;
    const before = await meter();
    const [s] = await q<{ target: number }>(`select bigday_target as target from settings where id`);
    expect(before.target).toBe(s!.target);
    // Another guest's requests, so the detail test's "other requests" count stays this guest's.
    const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `bigday+${randomUUID().slice(0, 8)}@example.com`,
    ]);
    guests.push(g!.id);
    const big = { counts_toward: 'big_day', guest_id: g!.id };
    const host = await makeRequest({ ...big, status: 'locked', ...lockRange(2032) });
    await makeRequest({ ...big, status: 'done', ...lockRange(2018) });
    await makeRequest({ ...big, status: 'locked', joined_to_request_id: host });
    await makeRequest({ ...big, status: 'requested' });
    await makeRequest({ ...big, status: 'cancelled', cancelled_by: 'jon' });
    expect(await meter()).toEqual({ count: before.count + 2, target: before.target });
  });

  it('a joined request ends with its host (AD-8), even before the tick materialises it', async () => {
    // Another guest's requests, so the detail test's "other requests" count stays this guest's.
    const [g] = await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `joined+${randomUUID().slice(0, 8)}@example.com`,
    ]);
    guests.push(g!.id);
    const host = await makeRequest({ guest_id: g!.id, status: 'locked', ...lockRange(2021) });
    const joined = await makeRequest({ guest_id: g!.id, status: 'locked', joined_to_request_id: host });
    const future = await makeRequest({ guest_id: g!.id, status: 'locked', ...lockRange(2034) });
    const joinedLive = await makeRequest({ guest_id: g!.id, status: 'locked', joined_to_request_id: future });
    const tabs = await allTabs();
    const tabsOf = (id: string) => INBOX_TABS.filter((t) => tabs[t].ids.includes(id));
    expect([host, joined, joinedLive].map(tabsOf)).toEqual([['done'], ['done'], ['locked']]);
    await q(`update request set status = 'done' where id = $1`, [future]); // the host done by the tick
    const again = await allTabs();
    expect(INBOX_TABS.filter((t) => again[t].ids.includes(joinedLive))).toEqual(['done']);
  });

  it('caps every tab at the latest 300 and says so (no unbounded list)', async () => {
    const ids = await q<{ id: string }>(
      `insert into request (is_test, client_key, guest_id, invite_id, contact_name, contact_email, dish, mode,
                            counts_toward, status, cancelled_at, cancelled_by)
       select true, gen_random_uuid(), $1, $2, 'Bulk', 'bulk@example.com', 'the-long-lunch', 'slots', 'weekly_cap',
              'cancelled', now(), 'jon'
         from generate_series(1, 301) returning id`,
      [guestId, inviteId],
    );
    try {
      const body = (await (await getTab('cancelled')).json()) as { cards: unknown[]; truncated: boolean };
      expect(body.cards).toHaveLength(300);
      expect(body.truncated).toBe(true);
      const small = (await (await getTab('waiting')).json()) as { truncated: boolean };
      expect(small.truncated).toBe(false);
    } finally {
      await q(`delete from request where id = any($1::uuid[])`, [ids.map((r) => r.id)]);
    }
  });

  it('refuses an unknown or repeated tab, and defaults to Needs a reply', async () => {
    expect((await getTab('decided')).status).toBe(400);
    expect((await list(get('/api/admin/requests?tab=done&tab=check'))).status).toBe(400);
    const res = await list(get('/api/admin/requests'));
    expect(((await res.json()) as { tab: string }).tab).toBe('needs_reply');
  });
});

const cardNoTimesLeft = async (id: string) => {
  const body = (await (await getTab('needs_reply')).json()) as {
    cards: { id: string; noTimesLeft: boolean }[];
  };
  return body.cards.find((c) => c.id === id)?.noTimesLeft;
};

describe('GET /api/admin/requests/[id] (T2.2 AC1, AC2)', () => {
  it('says "Sealed plan on file" without the plan', async () => {
    const res = await getDetail(surpriseId);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const text = await res.text();
    expect(text).not.toContain(CANARY);
    const { request } = JSON.parse(text) as { request: Record<string, unknown> };
    expect(request.hasSealedPlan).toBe(true);
    expect(request.calendarState).toBe('none'); // pr28 review L5: admin can see a calendar failure
    expect(request.needToKnow).toBe('Thursday evening, Lonsdale, bring a jacket');
    const blank = (await (await getDetail(mine[9]!)).json()) as { request: { hasSealedPlan: boolean } };
    expect(blank.request.hasSealedPlan).toBe(false); // a blank plan is no plan
  });

  it('marks each chosen time open or gone, and counts the guest’s other live requests', async () => {
    const slots = await q<{ id: string; date: string }>(
      `select id, date::text from slot where window_kind = 'lunch' order by starts_at limit 2`,
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
      const body = (await (await getDetail(id)).json()) as {
        request: {
          times: { slotId: string; state: string }[];
          noTimesLeft: boolean;
          otherRequestsCount: number;
        };
      };
      const state = Object.fromEntries(body.request.times.map((t) => [t.slotId, t.state]));
      expect(state[slots[1]!.id]).toBe('gone'); // AC2: a blocked day's time has gone
      expect(state[slots[0]!.id]).toBe('open'); // … and one still open stays open
      expect(Object.keys(state)).toHaveLength(2);
      expect(body.request.noTimesLeft).toBe(false);
      // The 11 requests beforeAll made share this guest; the cancelled one doesn't count.
      expect(body.request.otherRequestsCount).toBe(10);
      expect(await cardNoTimesLeft(id)).toBe(false);

      // Block the other day too: no time is left, on the detail AND on the inbox card.
      const [block0] = await q<{ id: string }>(
        `insert into availability_block (start_date, end_date, kind) values ($1, $1, 'blocked') returning id`,
        [slots[0]!.date],
      );
      try {
        const after = (await (await getDetail(id)).json()) as {
          request: { times: { state: string }[]; noTimesLeft: boolean };
        };
        expect(after.request.times.map((t) => t.state)).toEqual(['gone', 'gone']);
        expect(after.request.noTimesLeft).toBe(true);
        expect(await cardNoTimesLeft(id)).toBe(true);
      } finally {
        await q(`delete from availability_block where id = $1`, [block0!.id]);
      }
    } finally {
      await q(`delete from availability_block where id = $1`, [block!.id]);
    }
  });

  it('404s an unknown or malformed id', async () => {
    expect((await getDetail(randomUUID())).status).toBe(404);
    expect((await getDetail('not-a-uuid')).status).toBe(404);
  });
});
