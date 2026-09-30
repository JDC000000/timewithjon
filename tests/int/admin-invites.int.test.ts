// T2.6 AC1–AC3 (+ T2.6.01/.02) against the test DB through /api/admin/invites/** and the real invite resolver.
// AC1's preview half (the live S2 hero preview) is UI (T2.6.U1). afterAll deletes every invite and request
// made here and puts the seeded general link back, so later files see the seed as it was.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { pool, q, withTx } from '@/lib/db';
import { INVITE_TEXT } from '@/content';
import { createRequestTx } from '@/features/requests/create';
import { RequestBody } from '@/features/requests/schema';
import { listInvites } from '@/features/admin/invites';
import { GET as listRoute, POST as createRoute } from '@/app/api/admin/invites/route';
import { POST as revokeRoute } from '@/app/api/admin/invites/[id]/revoke/route';
import { POST as rotateRoute } from '@/app/api/admin/invites/rotate-general/route';
import { GET as resolveRoute } from '@/app/api/invite/resolve/route';

vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const SEED_GENERAL = 'g3hx8q2v';
const madeInvites: string[] = [];

beforeAll(async () => {
  await q(`delete from rate_limit`); // the resolver's lookup limit shares one local bucket off Vercel
});
afterAll(async () => {
  await q(`delete from request where invite_id = any($1::uuid[])`, [madeInvites]);
  await q(`update invite set revoked_at = now() where kind = 'general' and revoked_at is null`);
  await q(`delete from invite where id = any($1::uuid[])`, [madeInvites]);
  await q(`update invite set revoked_at = null where token_secret = $1`, [SEED_GENERAL]);
  await q(`delete from rate_limit`);
  await pool().end();
});

const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`${SITE}${path}`, {
    method,
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
type Item = { id: string; link: string; text: string; slug: string; ourThings: string[]; revoked: boolean };

async function create(body: Record<string, unknown>) {
  const res = await createRoute(req('POST', '/api/admin/invites', body));
  const json = (await res.json()) as { invite?: Item; issues?: { path: string; code: string }[] };
  if (json.invite) madeInvites.push(json.invite.id);
  return { status: res.status, ...json };
}
const revoke = (id: string) =>
  revokeRoute(req('POST', `/x/${id}/revoke`), { params: Promise.resolve({ id }) });
const forOf = (link: string) => new URL(link).searchParams.get('for')!;
const resolve = (forParam: string, cookie?: string) =>
  resolveRoute(
    new NextRequest(`${SITE}/api/invite/resolve?for=${encodeURIComponent(forParam)}&next=%2F`, {
      headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile Safari', ...(cookie ? { cookie } : {}) },
    }),
  );
async function addRequest(inviteId: string, spam = false): Promise<string> {
  const body = RequestBody.parse({
    clientKey: randomUUID(),
    dish: 'the-long-lunch',
    name: 'Lister',
    email: `lister+${randomUUID().slice(0, 8)}@example.com`,
    crew: 2,
  });
  const { requestId } = await withTx((c) =>
    createRequestTx(c, {
      body,
      inviteId,
      isTest: true,
      spam,
      mode: 'slots',
      status: 'requested',
      countsToward: 'weekly_cap',
      bigCrew: false,
      dishName: 'The Long Lunch',
    }),
  );
  return requestId;
}
/** The resolver's verdict: a fresh invite cookie (works) or the stale flag (S16). */
async function verdict(link: string): Promise<'works' | 'stale'> {
  const res = await resolve(forOf(link));
  if (res.cookies.get('twj_invite')?.value) return 'works';
  expect(res.cookies.get('twj_stale')?.value).toBe('1');
  return 'stale';
}

describe('T2.6 AC1: "our things" are validated by Zod and by the DB check', () => {
  it.each([
    [['one two three four five'], 'four_words_max'],
    [['x'.repeat(41)], 'thing_too_long'],
    [['Tofino, again'], 'no_commas'],
    [['a', 'b', 'c', 'd'], 'three_max'],
  ])('the API refuses %j with %s and creates nothing', async (ourThings, code) => {
    const before = (await q(`select id from invite`)).length;
    const res = await create({ name: 'Refused', ourThings });
    expect(res.status).toBe(400);
    expect(res.issues).toEqual([expect.objectContaining({ code })]);
    expect((await q(`select id from invite`)).length).toBe(before);
  });

  it.each([[['one two three four five']], [['x'.repeat(41)]], [['Tofino, again']], [['a', 'b', 'c', 'd']]])(
    'the DB check refuses %j too',
    async (ourThings) => {
      await expect(
        q(
          `insert into invite (kind, token_secret, name_slug, our_things) values ('personal', 'zzzzzzzz', 'x', $1)`,
          [ourThings],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  it('blank inputs are dropped; 4-word, 40-character phrases are fine', async () => {
    const ok = await create({
      name: 'Dave',
      ourThings: ['  ', 'the Seymour lap again', '', 'y'.repeat(40)],
    });
    expect(ok.status).toBe(201);
    expect(ok.invite!.ourThings).toEqual(['the Seymour lap again', 'y'.repeat(40)]);
    const blank = await create({ name: 'Priya', ourThings: ['', ' '] });
    expect(blank.invite!.ourThings).toEqual([]);
    const stored = await q<{ our_things: string[] }>(`select our_things from invite where id = $1`, [
      blank.invite!.id,
    ]);
    expect(stored[0]!.our_things).toEqual([]);
  });
});

describe('T2.6.01/.02 create, copy link and copy text', () => {
  it('creates a personal invite with a derived slug, the link and the §6.7 text', async () => {
    const res = await create({
      name: "Zoë O'Brien",
      pickedDish: 'the-long-lunch',
      prefillEmail: 'zoe@example.com',
    });
    expect(res.status).toBe(201);
    const inv = res.invite!;
    expect(inv.slug).toBe('zoe-o-brien');
    expect(inv.link).toMatch(/^http:\/\/localhost:3000\/\?for=zoe-o-brien-[0-9a-hjkmnp-tv-z]{8}$/);
    expect(inv.text).toBe(
      `Zoë O'Brien. [Jon writes this line himself]\n${INVITE_TEXT.personalBody}\n${inv.link.slice('http://'.length)}`,
    );
    const row = (
      await q<{
        kind: string;
        prefill_name: string;
        hoped_for: boolean;
        picked_dish: string;
        is_test: boolean;
      }>(`select kind, prefill_name, hoped_for, picked_dish, is_test from invite where id = $1`, [inv.id])
    )[0];
    expect(row).toEqual({
      kind: 'personal',
      prefill_name: "Zoë O'Brien",
      hoped_for: true,
      picked_dish: 'the-long-lunch',
      is_test: false,
    });
    expect(await verdict(inv.link)).toBe('works');
  });

  it('derives a clean slug from any name', async () => {
    expect((await create({ name: 'Renée Ng' })).invite!.slug).toBe('renee-ng');
    expect((await create({ name: '🎉🎉' })).invite!.slug).toBe('friend');
    expect((await create({ name: 'Al', slug: 'big-al' })).invite!.slug).toBe('big-al');
  });

  it('refuses a dish that is not bookable or unknown, a bad slug, a bad email and unknown keys', async () => {
    for (const body of [
      { name: 'A', pickedDish: 'the-bluebird' },
      { name: 'A', pickedDish: 'the-nope' },
      { name: 'A', slug: 'Bad Slug' },
      { name: 'A', prefillEmail: 'not-an-email' },
      { name: '' },
      { name: 'A', jonLine: 'hi' },
      { name: 'Dave\u202Eevil' }, // a bidi override (L3)
      { name: 'Dave\nSmith' },
      { name: 'Dave\u200B' },
    ]) {
      expect((await create(body)).status).toBe(400);
    }
  });

  it('lists every invite with open counts, request status and a warning for a dish no longer bookable', async () => {
    const { invite } = await create({ name: 'Lister', slug: 'lister' });
    await resolve(forOf(invite!.link));
    await resolve(forOf(invite!.link));
    await addRequest(invite!.id);
    await addRequest(invite!.id, true); // a spam suspect: never counted
    const requestId = await addRequest(invite!.id);
    await q(
      `update request set status = 'locked', locked_starts_at = '2027-06-26T18:00:00Z',
              locked_ends_at = '2027-06-26T19:00:00Z' where id = $1`,
      [requestId],
    );
    const stale = (
      await q<{ id: string }>(
        `insert into invite (kind, token_secret, name_slug, picked_dish) values ('personal', 'zzzzzzz1', 'bb', 'the-bluebird') returning id`,
      )
    )[0]!.id;
    madeInvites.push(stale);

    const res = await listRoute(req('GET', '/api/admin/invites'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { invites } = (await res.json()) as {
      invites: (Item & { openCount: number; dishNotBookable: boolean; requests: unknown; kind: string })[];
    };
    expect(invites[0]!.kind).toBe('general'); // the active general link on top
    const mine = invites.find((i) => i.id === invite!.id)!;
    expect(mine.openCount).toBe(2);
    expect(mine.requests).toEqual({ count: 2, latest: { id: requestId, status: 'locked' } });
    expect(invites.find((i) => i.id === stale)!.dishNotBookable).toBe(true);
    expect(mine.dishNotBookable).toBe(false);
    const later = (await listInvites(new Date('2027-06-27T00:00:00Z'))).find((i) => i.id === invite!.id)!;
    expect(later.requests.latest!.status).toBe('done'); // lazy done (T2.8)
    expect(JSON.stringify(invites)).not.toMatch(/surprise_plan|sealed/i);

    // L2: a joined guest whose host is already done reads as done, exactly as the inbox (ENDED) says.
    const { invite: hostInvite } = await create({ name: 'Host', slug: 'host' });
    const hostReq = await addRequest(hostInvite!.id);
    await q(
      `update request set status = 'done', locked_starts_at = '2027-06-27T18:00:00Z',
              locked_ends_at = '2027-06-27T19:00:00Z' where id = $1`,
      [hostReq],
    );
    const { invite: joinerInvite } = await create({ name: 'Joiner', slug: 'joiner' });
    const joinerReq = await addRequest(joinerInvite!.id);
    await q(`update request set status = 'locked', joined_to_request_id = $2 where id = $1`, [
      joinerReq,
      hostReq,
    ]);
    const early = await listInvites(new Date('2027-06-01T00:00:00Z'));
    expect(early.find((i) => i.id === joinerInvite!.id)!.requests.latest).toEqual({
      id: joinerReq,
      status: 'done',
    });
  });
});

describe('T2.6 AC2: a revoked link shows S16 on its next request', () => {
  it('revokes once (idempotent), the link and an existing session both go stale', async () => {
    const { invite } = await create({ name: 'Revoked' });
    const first = await resolve(forOf(invite!.link));
    const cookie = `twj_invite=${first.cookies.get('twj_invite')!.value}`;
    const r1 = await revoke(invite!.id);
    expect(await r1.json()).toEqual({ ok: true, changed: true });
    const stamp = async () =>
      (await q<{ t: Date }>(`select revoked_at t from invite where id = $1`, [invite!.id]))[0]!.t.getTime();
    const firstStamp = await stamp();
    const r2 = await revoke(invite!.id);
    expect(await r2.json()).toEqual({ ok: true, changed: false });
    expect(await stamp()).toBe(firstStamp); // the first revocation time is kept
    expect(await verdict(invite!.link)).toBe('stale');
    // A guest who already had the cookie: the resolver clears it on the next request.
    const again = await resolve(forOf(invite!.link), cookie);
    expect(again.cookies.get('twj_stale')?.value).toBe('1');
    expect((await revoke(randomUUID())).status).toBe(404);
    expect((await revoke('nope')).status).toBe(404);
  });
});

describe('T2.6 AC3: after rotation the old general link shows S16 and the new one works', () => {
  it('rotates in one transaction, keeps the slug, and the text is the open line + the new link', async () => {
    const oldLink = `${SITE}/?for=friends-${SEED_GENERAL}`;
    expect(await verdict(oldLink)).toBe('works');
    const res = await rotateRoute(req('POST', '/api/admin/invites/rotate-general'));
    const { invite } = (await res.json()) as { invite: Item };
    madeInvites.push(invite.id);
    expect(invite.slug).toBe('friends');
    expect(invite.link).not.toContain(SEED_GENERAL);
    expect(invite.text).toBe(`${INVITE_TEXT.openBody}\n${invite.link.replace('http://', '')}`);
    expect(await verdict(oldLink)).toBe('stale');
    expect(await verdict(invite.link)).toBe('works');
  });

  it('two rotations at once both succeed and leave exactly one active general link', async () => {
    const results = await Promise.all([
      rotateRoute(req('POST', '/api/admin/invites/rotate-general')),
      rotateRoute(req('POST', '/api/admin/invites/rotate-general')),
    ]);
    for (const r of results) {
      expect(r.status).toBe(200);
      madeInvites.push(((await r.json()) as { invite: Item }).invite.id);
    }
    const active = await q(`select id from invite where kind = 'general' and revoked_at is null`);
    expect(active).toHaveLength(1);
  });

  it('with the general link revoked by hand, rotating creates a fresh one', async () => {
    const [active] = await q<{ id: string }>(
      `select id from invite where kind = 'general' and revoked_at is null`,
    );
    await revoke(active!.id);
    const res = await rotateRoute(req('POST', '/api/admin/invites/rotate-general'));
    const { invite } = (await res.json()) as { invite: Item };
    madeInvites.push(invite.id);
    expect(await verdict(invite.link)).toBe('works');
  });
});
