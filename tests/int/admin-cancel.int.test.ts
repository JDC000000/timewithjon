// T2.9.03 (TSD T2.9 AC3, §6 "Any non-final → cancelled", "Joined requests" rules 2 and 4): Jon's Cancel for the
// guest through POST /api/admin/requests/[id]/cancel against the test DB. Only the Supabase session is faked;
// the calendar and mailer are the prototype mocks. The guest's own cancel (E11 + E12) is in manage.int.test.ts.
// QA r2 M5: Jon's cancel sends the guest E17 (his own words), never the self-cancel E11.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as cancelRoute } from '@/app/api/admin/requests/[id]/cancel/route';
import { openWindows } from '@/features/availability/openWindows';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { createRequestTx } from '@/features/requests/create';
import { lockRequest } from '@/features/requests/lock';
import { RequestBody } from '@/features/requests/schema';
import { mockCalendar } from '@/lib/adapters/mock/calendar';
import { pool, q, withTx } from '@/lib/db';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const NOW = new Date('2027-03-15T18:00:00Z');
const DAYS = ['2027-04-29', '2027-04-30'];
const made: string[] = [];
let generalId = '';

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // Leftovers from an earlier run, or another file's bookings on these days.
  await q(
    `update request set status = 'cancelled', cancelled_at = now()
      where status in ('locked', 'done') and (locked_starts_at at time zone 'America/Vancouver')::date = any($1::date[])`,
    [DAYS],
  );
  generalId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
});
beforeEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  vi.useRealTimers();
  await q(`update request set status = 'cancelled', cancelled_at = now() where id = any($1::uuid[])`, [made]);
  await pool().end();
});

const slotId = async (date: string, w: 'lunch' | 'evening') =>
  (await q<{ id: string }>(`select id from slot where date = $1 and window_kind = $2`, [date, w]))[0]!.id;
async function newRequest(slotIds: string[]) {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Dave Guest',
    email: `dave+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
    slotIds,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId: generalId,
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
async function lockedRequest(date: string, w: 'lunch' | 'evening' = 'lunch') {
  const slot = await slotId(date, w);
  const id = await newRequest([slot]);
  expect((await lockRequest({ requestId: id, target: { slotId: slot }, mode: 'lock', now: NOW })).ok).toBe(
    true,
  );
  return { id, slot };
}
async function joinTo(hostId: string) {
  const id = await newRequest([]);
  await q(
    `update request set status = 'locked', joined_to_request_id = $2, counts_toward = 'none' where id = $1`,
    [id, hostId],
  );
  return id;
}
const row = async (id: string) =>
  (
    await q<{ status: string; cancelled_by: string | null; awaiting: boolean; calendar_state: string }>(
      `select status, cancelled_by, awaiting_jon_since is not null as awaiting, calendar_state
         from request where id = $1`,
      [id],
    )
  )[0]!;
/** The emails a cancel can cause (the intake E1/E2 and the lock's E4 left out), with where they went. */
const emails = async (id: string) =>
  q<{ template: string; to_email: string; status: string }>(
    `select template, to_email::text, status from email_log
      where request_id = $1 and template not in ('E1', 'E2', 'E4') order by template`,
    [id],
  );
const isOpen = async (slot: string) => {
  const out = openWindows(engineInput(await loadEngineData(NOW), [], 'general', ['lunch', 'evening']));
  return out.weeks.some((w) => w.windows.some((x) => x.slotId === slot));
};
const cancel = (id: string, origin = SITE) =>
  cancelRoute(
    new NextRequest(`${SITE}/api/admin/requests/${id}/cancel`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    }),
    { params: Promise.resolve({ id }) },
  );
const guestEmail = async (id: string) =>
  (await q<{ e: string }>(`select contact_email::text as e from request where id = $1`, [id]))[0]!.e;

describe('Cancel for the guest (T2.9.03, AC3)', () => {
  it('AC3: frees the window, deletes the event, releases offers, sends E17 once (never E11) and no E12', async () => {
    const remove = vi.spyOn(mockCalendar, 'remove');
    const { id, slot } = await lockedRequest('2027-04-29');
    const eventId = (
      await q<{ g: string }>(`select google_event_id as g from request where id = $1`, [id])
    )[0]!.g;
    await q(`insert into offer (request_id, kind, slot_ids) values ($1, 'suggested_times', '{}')`, [id]);
    expect(await isOpen(slot)).toBe(false);

    const res = await cancel(id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true, already: false });
    expect(await row(id)).toEqual({
      status: 'cancelled',
      cancelled_by: 'jon',
      awaiting: false,
      calendar_state: 'none',
    });
    expect(remove).toHaveBeenCalledWith(eventId);
    expect(await isOpen(slot)).toBe(true);
    expect(await q(`select 1 from offer where request_id = $1 and released_at is null`, [id])).toEqual([]);
    expect(await emails(id)).toEqual([{ template: 'E17', to_email: await guestEmail(id), status: 'sent' }]);
    expect(
      await q(`select actor::text from audit_log where request_id = $1 and action = 'request_cancelled'`, [
        id,
      ]),
    ).toEqual([{ actor: 'jon' }]);

    // Idempotent: a second tap sends nothing more.
    expect(await (await cancel(id)).json()).toEqual({ ok: true, already: true });
    expect((await emails(id)).map((e) => e.template)).toEqual(['E17']);
  });

  it('a request with no time yet: cancelled with E17 only, no calendar row', async () => {
    const id = await newRequest([await slotId('2027-04-30', 'lunch')]);
    expect((await cancel(id)).status).toBe(200);
    expect((await row(id)).status).toBe('cancelled');
    expect((await emails(id)).map((e) => e.template)).toEqual(['E17']);
    expect(await q(`select 1 from outbox where request_id = $1`, [id])).toEqual([]);
  });

  it('rule 2: a joined guest leaves the host locked; only their attendee goes', async () => {
    const patch = vi.spyOn(mockCalendar, 'patch');
    const remove = vi.spyOn(mockCalendar, 'remove');
    const { id: host } = await lockedRequest('2027-04-30');
    const joined = await joinTo(host);
    expect((await cancel(joined)).status).toBe(200);
    expect((await row(host)).status).toBe('locked');
    expect(await row(joined)).toMatchObject({ status: 'cancelled', cancelled_by: 'jon' });
    expect(remove).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1].attendees).toEqual([await guestEmail(host)]);
    expect((await emails(joined)).map((e) => e.template)).toEqual(['E17']);
    await cancel(host); // frees the day for the next test
  });

  it('rule 4: cancelling the host sends its joined guest to needs a new time with E5j, never cancelled', async () => {
    const { id: host } = await lockedRequest('2027-04-30', 'evening');
    const joined = await joinTo(host);
    expect((await cancel(host)).status).toBe(200);
    expect((await emails(host)).map((e) => e.template)).toEqual(['E17']);
    expect(await row(joined)).toMatchObject({ status: 'needs_new_time', awaiting: true, cancelled_by: null });
    expect((await emails(joined)).map((e) => e.template)).toEqual(['E5j']);
  });

  it('refuses an ended booking (409), an unknown or malformed id (404) and a cross-site call (403)', async () => {
    const { id } = await lockedRequest('2027-04-29', 'evening');
    vi.setSystemTime(new Date('2027-05-01T00:00:00Z'));
    try {
      const ended = await cancel(id);
      expect(ended.status).toBe(409);
      expect(((await ended.json()) as { code: string }).code).toBe('already_done');
    } finally {
      vi.setSystemTime(NOW);
    }
    expect((await cancel(randomUUID())).status).toBe(404);
    expect((await cancel('nope')).status).toBe(404);
    expect((await cancel(id, 'https://evil.example')).status).toBe(403);
    expect((await row(id)).status).toBe('locked');
    expect(await emails(id)).toEqual([]);
    await cancel(id);
  });
});
