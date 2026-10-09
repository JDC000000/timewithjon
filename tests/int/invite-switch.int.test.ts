// A link for another invite replaces the browser's session (both stay usable), but the booking form then fills in
// none of that invite's name or email: the visitor types their own, so their booking emails go to them. The guest of
// the invite is never refused: a first visit and the same link again keep the prefill. Seeded invites: priya (no
// email) and dave (name + email).
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/invite/resolve/route';
import { guestView } from '@/app/book/[dish]/_lib/flow-view';
import { pool, q } from '@/lib/db';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));
const { getInviteSession } = await import('@/features/invites/session');

/** Open a ?for= link in this "browser": send its cookies, keep what the answer sets or deletes. */
async function open(forParam: string) {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await GET(
    new NextRequest(
      `http://localhost:3000/api/invite/resolve?for=${forParam}&next=%2Fbook%2Fthe-long-lunch`,
      {
        headers: {
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari',
          ...(cookie ? { cookie } : {}),
        },
      },
    ),
  );
  expect(res.status).toBe(303);
  for (const c of res.cookies.getAll()) {
    if (c.value) jar.set(c.name, c.value);
    else jar.delete(c.name);
  }
  return res;
}
/** What the booking form gets for this browser (src/app/book/[dish]/page.tsx). */
async function form() {
  const s = await getInviteSession();
  if (s.state !== 'valid') throw new Error(`no valid session: ${s.state}`);
  return { slug: s.invite.name_slug, guest: guestView(s.invite, undefined, s.switched) };
}

beforeEach(async () => {
  jar.clear();
  await q(`delete from rate_limit where scope = 'inviteLookup'`);
});
afterAll(async () => {
  await q(`delete from rate_limit where scope = 'inviteLookup'`);
  await pool().end();
});

describe('a link for another invite', () => {
  it('a first visit keeps the invite’s prefill (the guest is never refused it)', async () => {
    await open('dave-k7q2m9xp');
    expect(jar.has('twj_switched')).toBe(false);
    expect(await form()).toEqual({
      slug: 'dave',
      guest: { name: 'Dave', email: 'dave@example.com', general: false },
    });
  });

  it('the same link again keeps it too', async () => {
    await open('dave-k7q2m9xp');
    await open('dave-k7q2m9xp');
    expect(jar.has('twj_switched')).toBe(false);
    expect((await form()).guest.email).toBe('dave@example.com');
  });

  it('cookie for invite A, then ?for=B: the session is B, and the form has no name or email from B', async () => {
    await open('priya-p4r8t2wz');
    await open('dave-k7q2m9xp');
    expect(jar.has('twj_switched')).toBe(true);
    expect(await form()).toEqual({ slug: 'dave', guest: { name: '', email: '', general: false } });
    // and it stays that way on the next page loads (the same link again included)
    await open('dave-k7q2m9xp');
    expect((await form()).guest).toEqual({ name: '', email: '', general: false });
  });

  it('a session whose invite was revoked is no session: the next link is a first visit', async () => {
    await open('priya-p4r8t2wz');
    await q(`update invite set revoked_at = now() where token_secret = 'p4r8t2wz'`);
    try {
      await open('dave-k7q2m9xp');
      expect(jar.has('twj_switched')).toBe(false);
      expect((await form()).guest.email).toBe('dave@example.com');
    } finally {
      await q(`update invite set revoked_at = null where token_secret = 'p4r8t2wz'`);
    }
  });

  it('the marker is signed: a hand-made twj_switched naming the invite does nothing', async () => {
    await open('dave-k7q2m9xp');
    const id = (await q<{ id: string }>(`select id from invite where token_secret = 'k7q2m9xp'`))[0]!.id;
    jar.set('twj_switched', `${id}.9999999999.AAAA`);
    expect((await form()).guest.email).toBe('dave@example.com');
  });
});
