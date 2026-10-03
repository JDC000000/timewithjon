// S19 story-page writes: the first save creates the story (a photo sign never does), the general invite's first save
// needs the Turnstile check, an invite has a daily limit on new stories and a personal invite a total, and a story
// with no words and no photo stays out of Jon's list and counts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  }),
}));
const ts = vi.hoisted(() => ({ verify: vi.fn(async () => true) }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: ts.verify }));

import { ERRORS } from '@/content';
import { POST as storyPageRoute } from '@/app/api/story-page/route';
import { POST as photoSign } from '@/app/api/photos/sign/route';
import { adminCounts } from '@/features/admin/settings';
import { listStories } from '@/features/admin/stories';
import { STORY_COOKIE } from '@/features/invites/capability';
import { INVITE_COOKIE } from '@/features/invites/session';
import { signCookie } from '@/features/invites/tokens';
import { STORY_PAGE_MAX_PER_INVITE } from '@/features/photos/limits';
import { getEnv } from '@/config/env';
import { pool, q } from '@/lib/db';
import { LIMITS } from '@/lib/ratelimit';

const SITE = 'http://localhost:3000';
const tag = `int-sp-limits-${randomUUID().slice(0, 8)}`;
let personalId = '';
let generalId = '';

const secret = () =>
  Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstvwxyz23456789'[Math.floor(Math.random() * 30)]).join('');
const useInvite = (id: string) =>
  jar.set(INVITE_COOKIE, signCookie('invite', id, 3600, getEnv().SESSION_SIGNING_SECRET));
const post = (path: string, body: unknown) =>
  new NextRequest(`${SITE}${path}`, {
    method: 'POST',
    headers: { origin: SITE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
/** One save the way a script would send it after clearing its cookies: no twj_story. */
async function freshSave(body: Record<string, unknown>) {
  jar.delete(STORY_COOKIE);
  const res = await storyPageRoute(post('/api/story-page', body));
  // keep the twj_story the answer issued, as a browser would
  const issued = res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${STORY_COOKIE}=`))
    ?.split(';')[0]!
    .slice(STORY_COOKIE.length + 1);
  if (issued) jar.set(STORY_COOKIE, issued);
  return res;
}
const storiesOf = (inviteId: string) =>
  q<{ id: string; body: string | null }>(
    `select id, body from story where source = 'story_page' and invite_id = $1 order by created_at`,
    [inviteId],
  );
const clearLimits = () =>
  q(`delete from rate_limit where scope in ('storySave', 'storyPageNew', 'photoSign')`);

beforeAll(async () => {
  personalId = (
    await q<{ id: string }>(
      `insert into invite (kind, token_secret, name_slug, display_name, is_test)
       values ('personal', $1, $2, 'x', true) returning id`,
      [secret(), `${tag}-${secret()}`],
    )
  )[0]!.id;
  generalId = (
    await q<{ id: string }>(`select id from invite where kind = 'general' and revoked_at is null`)
  )[0]!.id;
});
beforeEach(async () => {
  jar.clear();
  ts.verify.mockClear();
  ts.verify.mockResolvedValue(true);
  await clearLimits();
});
afterAll(async () => {
  await q(`delete from story where invite_id = $1`, [personalId]);
  await q(`delete from story where invite_id = $1 and (body like $2 or body is null)`, [
    generalId,
    `${tag}%`,
  ]);
  await q(`delete from invite where id = $1`, [personalId]);
  await clearLimits();
  await pool().end();
});

describe('story-page first save', () => {
  it('a sign with no twj_story creates no story (403), however often it is called', async () => {
    useInvite(personalId);
    for (let i = 0; i < 5; i++) {
      const res = await photoSign(post('/api/photos/sign?for=story_page', {}));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'capability_expired' });
    }
    expect(await storiesOf(personalId)).toEqual([]);
  });

  it('a personal invite starts at most its total, however often the cookie is dropped', async () => {
    useInvite(personalId);
    const max = STORY_PAGE_MAX_PER_INVITE.personal!;
    const answers: number[] = [];
    for (let i = 0; i < max + 4; i++) answers.push((await freshSave({ body: `${tag} p${i}` })).status);
    expect(answers.slice(0, max)).toEqual(Array(max).fill(200));
    expect(answers.slice(max)).toEqual(Array(4).fill(429));
    const refused = await freshSave({ body: `${tag} over` });
    expect(await refused.json()).toMatchObject({ code: 'rate_limited', message: ERRORS.rateLimited });
    expect(await storiesOf(personalId)).toHaveLength(max);
    // a personal invite's first save needs no Turnstile check
    expect(ts.verify).not.toHaveBeenCalled();
  });

  it('a later save with twj_story updates the same story and is not counted as new', async () => {
    useInvite(personalId);
    await q(`delete from story where invite_id = $1`, [personalId]);
    const first = await freshSave({ consent: false });
    expect(first.status).toBe(200);
    for (let i = 0; i < 5; i++)
      expect((await storyPageRoute(post('/api/story-page', { body: `${tag} edit${i}` }))).status).toBe(200);
    expect(await storiesOf(personalId)).toEqual([{ id: expect.any(String), body: `${tag} edit4` }]);
    // now the sign has a story to name
    const signed = await photoSign(post('/api/photos/sign?for=story_page', {}));
    expect(signed.status).toBe(200);
  });

  it("the general invite's first save needs the Turnstile check; a refused one saves nothing", async () => {
    useInvite(generalId);
    ts.verify.mockResolvedValue(false);
    const res = await freshSave({ body: `${tag} g-bot`, turnstileToken: 'bad' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'bot_check', message: ERRORS.botCheck });
    expect(ts.verify).toHaveBeenCalledWith('bad', expect.any(String));
    expect(await q(`select 1 from story where body = $1`, [`${tag} g-bot`])).toEqual([]);

    ts.verify.mockResolvedValue(true);
    expect((await freshSave({ body: `${tag} g-ok`, turnstileToken: 'good' })).status).toBe(200);
    ts.verify.mockClear();
    // the follow-up save rides twj_story: no new check
    expect((await storyPageRoute(post('/api/story-page', { body: `${tag} g-ok2` }))).status).toBe(200);
    expect(ts.verify).not.toHaveBeenCalled();
  });

  it('the general invite has a daily limit on new stories', async () => {
    useInvite(generalId);
    const { limit } = LIMITS.storyPageNew;
    const answers: number[] = [];
    for (let i = 0; i < limit + 3; i++)
      answers.push((await freshSave({ body: `${tag} day${i}`, turnstileToken: 't' })).status);
    expect(answers.filter((s) => s === 200)).toHaveLength(limit);
    expect(answers.slice(limit)).toEqual([429, 429, 429]);
    const made = await q(`select 1 from story where invite_id = $1 and body like $2`, [
      generalId,
      `${tag} day%`,
    ]);
    expect(made).toHaveLength(limit);
  });
});

describe("Jon's list and counts", () => {
  it('a story with no words and no photo is hidden from the list and the counts until it has some', async () => {
    useInvite(personalId);
    await q(`delete from story where invite_id = $1`, [personalId]);
    const before = (await adminCounts()).stories;
    expect((await freshSave({ consent: true })).status).toBe(200);
    const id = (await storiesOf(personalId))[0]!.id;
    expect((await listStories()).stories.map((s) => s.id)).not.toContain(id);
    expect((await adminCounts()).stories).toEqual(before);

    await q(`update story set body = '   ' where id = $1`, [id]);
    expect((await listStories()).stories.map((s) => s.id)).not.toContain(id);

    await q(`update story set body = $2 where id = $1`, [id, `${tag} words`]);
    expect((await listStories()).stories.map((s) => s.id)).toContain(id);
    expect((await adminCounts()).stories.total).toBe(before.total + 1);
  });
});
