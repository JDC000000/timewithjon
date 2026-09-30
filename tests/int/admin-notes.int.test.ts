// T2.8.01 (TSD T2.8 AC1: notes persist) and T2.8.02 (AC2: a past booking shows as Done with no tick running),
// through the real /api/admin/requests[/id] handlers against the test DB. Only the Supabase session is faked.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { currentAuthEmail } from '@/features/admin/supabase';
import { NOTE_MAX } from '@/features/admin/notes';
import { GET as list } from '@/app/api/admin/requests/route';
import { getRequestDetail } from '@/features/admin/detail';
import { listRequests } from '@/features/admin/inbox';
import { GET as detail, PATCH as patch } from '@/app/api/admin/requests/[id]/route';

vi.mock('@/lib/report', () => ({ report: vi.fn(), reportMessage: vi.fn() }));
vi.mock('@/features/admin/supabase', () => ({ adminAuthClient: vi.fn(), currentAuthEmail: vi.fn() }));

const SITE = 'http://localhost:3000';
const CANARY = 'SEALED-PLAN-CANARY-T28';
const mine: string[] = [];
let guestId = '';
let inviteId = '';

const getDetail = async (id: string) => {
  const res = await detail(new NextRequest(`${SITE}/api/admin/requests/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { request: { status: string; before60Note: unknown; jonNote: unknown } })
    .request;
};
const patchNotes = (id: string, body: unknown, origin = SITE) =>
  patch(
    new NextRequest(`${SITE}/api/admin/requests/${id}`, {
      method: 'PATCH',
      headers: { origin, 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
const tabIds = async (tab: string) => {
  const res = await list(new NextRequest(`${SITE}/api/admin/requests?tab=${tab}`));
  return ((await res.json()) as { cards: { id: string }[] }).cards.map((c) => c.id);
};

async function makeRequest(cols: Record<string, unknown>): Promise<string> {
  const base: Record<string, unknown> = {
    is_test: true,
    client_key: randomUUID(),
    guest_id: guestId,
    invite_id: inviteId,
    contact_name: 'Notes Test',
    contact_email: 'notes-test@example.com',
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

/** A 2-hour booking ending `endsAgoMs` before now (negative = in the future), at a random minute. */
function endingAgo(endsAgoMs: number): { locked_starts_at: Date; locked_ends_at: Date } {
  const end = new Date(Date.now() - endsAgoMs - Math.floor(Math.random() * 600_000));
  return { locked_starts_at: new Date(end.getTime() - 7_200_000), locked_ends_at: end };
}

beforeAll(async () => {
  vi.mocked(currentAuthEmail).mockResolvedValue('jon@example.com');
  inviteId = (await q<{ id: string }>(`select id from invite where kind = 'general' limit 1`))[0]!.id;
  guestId = (
    await q<{ id: string }>(`insert into guest (email) values ($1) returning id`, [
      `notes+${randomUUID().slice(0, 8)}@example.com`,
    ])
  )[0]!.id;
});

afterAll(async () => {
  await q(`delete from request where id = any($1::uuid[])`, [mine]);
  await q(`delete from guest where id = $1`, [guestId]);
  await pool().end();
});

describe('PATCH /api/admin/requests/[id] notes (T2.8.01, AC1)', () => {
  it('saves each note on its own, reads them back, and leaves the wait on Jon alone', async () => {
    const since = new Date('2027-01-05T10:00:00Z');
    const id = await makeRequest({
      status: 'requested',
      awaiting_jon_since: since,
      surprise_plan_sealed: CANARY,
    });

    const first = await patchNotes(id, { jonNote: 'Bring the good coffee.' });
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const text = await first.text();
    expect(text).not.toContain(CANARY);
    expect(JSON.parse(text)).toEqual({
      ok: true,
      notes: { before60Note: null, jonNote: 'Bring the good coffee.' },
    });

    // The other autosave doesn't overwrite the first.
    expect((await patchNotes(id, { before60Note: 'Sailed with him in 2003.' })).status).toBe(200);
    const d = await getDetail(id);
    expect(d).toMatchObject({ before60Note: 'Sailed with him in 2003.', jonNote: 'Bring the good coffee.' });

    // Both together; the longest note is kept whole.
    const long = 'x'.repeat(NOTE_MAX);
    expect((await patchNotes(id, { before60Note: 'again', jonNote: long })).status).toBe(200);
    const [row] = await q<{
      before60_note: string;
      jon_note: string;
      awaiting_jon_since: Date;
      status: string;
    }>(`select before60_note, jon_note, awaiting_jon_since, status from request where id = $1`, [id]);
    expect(row).toEqual({
      before60_note: 'again',
      jon_note: long,
      awaiting_jon_since: since,
      status: 'requested',
    });
    expect(await tabIds('needs_reply')).toContain(id);
  });

  it('clears a note with null or blank text', async () => {
    const id = await makeRequest({ status: 'requested', before60_note: 'a', jon_note: 'b' });
    const res = await patchNotes(id, { before60Note: null, jonNote: ' \n\t ' });
    expect(((await res.json()) as { notes: unknown }).notes).toEqual({ before60Note: null, jonNote: null });
    expect(await q(`select before60_note, jon_note from request where id = $1`, [id])).toEqual([
      { before60_note: null, jon_note: null },
    ]);
    // Anything else is kept exactly as typed: an autosave mid-word must not eat the space just typed.
    const typed = await patchNotes(id, { jonNote: 'Bring the ' });
    expect(((await typed.json()) as { notes: { jonNote: string } }).notes.jonNote).toBe('Bring the ');
  });

  it('refuses a bad body (400), an unknown or malformed id (404) and a cross-site write (403)', async () => {
    const id = await makeRequest({ status: 'requested', jon_note: 'keep' });
    for (const body of [
      {},
      { jonNote: 5 },
      { jonNote: 'x'.repeat(NOTE_MAX + 1) },
      { jonNote: 'a\u0000b' }, // pr45 R1: Postgres refuses NUL in text (22021): a 400, never a 500
      { before60Note: 'bell\u0007' },
      { note: 'guest note' },
      { jonNote: 'x', status: 'done' },
      { before60Note: undefined },
      'not json',
      [],
    ]) {
      expect((await patchNotes(id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await patchNotes(randomUUID(), { jonNote: 'x' })).status).toBe(404);
    expect((await patchNotes('nope', { jonNote: 'x' })).status).toBe(404);
    expect((await patchNotes(id, { jonNote: 'x' }, 'https://evil.example')).status).toBe(403);
    expect(await q(`select jon_note from request where id = $1`, [id])).toEqual([{ jon_note: 'keep' }]);
  });
});

describe('a past booking is Done with no tick (T2.8.02, AC2)', () => {
  it('shows under Done (not Locked in) in the inbox and the detail while the row still says locked', async () => {
    const past = await makeRequest({ status: 'locked', ...endingAgo(60_000) });
    const future = await makeRequest({ status: 'locked', ...endingAgo(-3 * 86_400_000) });
    const joined = await makeRequest({ status: 'locked', joined_to_request_id: past });

    const [done, locked] = [await tabIds('done'), await tabIds('locked')];
    expect([past, joined].every((id) => done.includes(id) && !locked.includes(id))).toBe(true);
    expect(locked.includes(future) && !done.includes(future)).toBe(true);
    expect((await getDetail(past)).status).toBe('done');
    expect((await getDetail(joined)).status).toBe('done'); // a joined request ends with its host (AD-8)
    expect((await getDetail(future)).status).toBe('locked');
    // Nothing was materialised: the tick never ran.
    expect(
      await q(`select status from request where id = any($1::uuid[]) order by status`, [
        [past, joined, future],
      ]),
    ).toEqual([{ status: 'locked' }, { status: 'locked' }, { status: 'locked' }]);
  });

  it('keeps a cancelled booking with a past end cancelled (pr45 R2)', async () => {
    // Cancelling leaves locked_ends_at set, so only the status guard keeps it out of Done.
    const cancelled = await makeRequest({ status: 'cancelled', ...endingAgo(60_000) });
    expect((await getDetail(cancelled)).status).toBe('cancelled');
    expect(await tabIds('done')).not.toContain(cancelled);
    expect(await tabIds('locked')).not.toContain(cancelled);
    expect(await tabIds('cancelled')).toContain(cancelled);
  });

  it('reads a booking as done at exactly its end, like the tick (pr45 R3: END <= now)', async () => {
    const at = await makeRequest({ status: 'locked', ...endingAgo(-86_400_000) });
    const [{ end }] = (await q<{ end: Date }>(`select locked_ends_at as end from request where id = $1`, [
      at,
    ])) as [{ end: Date }];
    const justBefore = new Date(end.getTime() - 1);
    expect((await getRequestDetail(at, end))?.status).toBe('done');
    expect((await getRequestDetail(at, justBefore))?.status).toBe('locked');
    const ids = async (tab: 'done' | 'locked', now: Date) =>
      (await listRequests(tab, now)).cards.map((c) => c.id);
    expect(await ids('done', end)).toContain(at);
    expect(await ids('locked', end)).not.toContain(at);
    expect(await ids('locked', justBefore)).toContain(at);
  });
});
