// T3.12.02 (TSD T3.12 AC1–AC2) against a real prototype server: a story saves with source `story_page` and its
// photo calls ride the twj_story capability; without an invite → 403. QA r2 H1: only a save marked `edit` (the same
// page view) updates the capability's story; a fresh page view's save starts a new one. (The prototype stores no photo bytes,
// §5.5, so sign answers { mock: true }; the 2-photo save through the real pipeline is in stories.int.test.ts.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ERRORS } from '@/content';
import { pool, q } from '@/lib/db';

const BASE = process.env.ROUTE_BASE_URL ?? 'http://127.0.0.1:3200';
const tag = `route-story-page-${randomUUID().slice(0, 8)}`;
let invite = '';

async function post(path: string, body: unknown, cookie?: string) {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}
const cookieOf = (res: Response, name: string) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];
const storiesTagged = () =>
  q<{ id: string; source: string; consent: boolean; consent_source: string | null; spam_suspect: boolean }>(
    `select id, source, consent, consent_source, spam_suspect from story where body like $1 order by created_at`,
    [`${tag}%`],
  );

beforeAll(async () => {
  await q(`delete from rate_limit`);
  const res = await fetch(`${BASE}/?for=friends-g3hx8q2v`, { redirect: 'manual' });
  invite = cookieOf(res, 'twj_invite')!;
  expect(invite).toBeTruthy();
});
afterAll(async () => {
  await q(`delete from story where body like $1`, [`${tag}%`]);
  await q(`delete from rate_limit`);
  await pool().end();
});

describe('POST /api/story-page (T3.12)', () => {
  it('AC2: no invite → 403 invite_required, nothing saved', async () => {
    const res = await post('/api/story-page', { body: `${tag} no invite`, consent: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, code: 'invite_required', message: ERRORS.noInvite });
    expect(await storiesTagged()).toEqual([]);
  });

  it('AC1: saves source story_page; an edit updates the SAME story, a fresh save a new one; photos ride twj_story', async () => {
    const first = await post(
      '/api/story-page',
      { body: `${tag} first`, consent: false, storyId: randomUUID() },
      invite,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const story = cookieOf(first, 'twj_story')!;
    expect(story).toBeTruthy();
    const second = await post(
      '/api/story-page',
      { body: `${tag} second`, consent: true, edit: true },
      `${invite}; ${story}`,
    );
    expect(second.status).toBe(200);
    // pr43 F3: twj_story is issued once per story; an edit never slides its 2 hours
    expect(cookieOf(second, 'twj_story')).toBeUndefined();
    const rows = await storiesTagged();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'story_page', consent: true, consent_source: 'tickbox' });

    // QA r2 H1: a fresh page view, cookie still set, no `edit`: a NEW story with its own twj_story.
    const fresh = await post(
      '/api/story-page',
      { body: `${tag} fresh`, consent: false },
      `${invite}; ${story}`,
    );
    expect(fresh.status).toBe(200);
    expect(cookieOf(fresh, 'twj_story')).toBeTruthy();
    expect(cookieOf(fresh, 'twj_story')).not.toBe(story);
    expect((await storiesTagged()).map((r) => r.id)).toEqual([rows[0]!.id, expect.any(String)]);

    const both = `${invite}; ${story}`;
    const signed = await post('/api/photos/sign?for=story_page', {}, both);
    expect(signed.status).toBe(200);
    expect(await signed.json()).toEqual({ mock: true });
    // the After-Send default needs twj_req, and story_page needs twj_story: each capability is its own key
    expect((await post('/api/photos/sign', {}, both)).status).toBe(403);
    // A sign with the invite but no twj_story yet creates nothing (the page's first save creates the story), and
    // neither does finalise (403).
    const before = (await q(`select 1 from story where source = 'story_page'`)).length;
    const firstSign = await post('/api/photos/sign?for=story_page', {}, invite);
    expect(firstSign.status).toBe(403);
    expect(cookieOf(firstSign, 'twj_story')).toBeUndefined();
    expect((await q(`select 1 from story where source = 'story_page'`)).length).toBe(before);
    const finInviteOnly = await post(
      '/api/photos/finalise?for=story_page',
      { photoUploadId: randomUUID() },
      invite,
    );
    expect(finInviteOnly.status).toBe(403);
    // pr43 F5: the target is the query, never the body
    expect((await post('/api/photos/sign', { for: 'story_page' }, both)).status).toBe(403);
    const fin = await post('/api/photos/finalise?for=story_page', { photoUploadId: randomUUID() });
    expect(fin.status).toBe(403);
    // the story's own photo with a valid twj_story but no invite → 403 invite_required (pr43 F3, T3.12 AC2)
    const noInvite = await post('/api/photos/sign?for=story_page', {}, story);
    expect(noInvite.status).toBe(403);
    expect(noInvite.headers.get('cache-control')).toBe('no-store'); // pr43 N4: error answers too
    expect(await noInvite.json()).toMatchObject({ code: 'invite_required' });
    const finNoInvite = await post(
      '/api/photos/finalise?for=story_page',
      { photoUploadId: randomUUID() },
      story,
    );
    expect(await finNoInvite.json()).toMatchObject({ code: 'invite_required' });
    // with both, finalise reaches the body: an unknown upload → 404 (the story is the caller's)
    const finBoth = await post('/api/photos/finalise?for=story_page', { photoUploadId: randomUUID() }, both);
    expect(finBoth.status).toBe(404);
  });

  it('AD-9: a filled honeypot (even oversize) gets the same 200 and is stored as spam_suspect', async () => {
    const res = await post(
      '/api/story-page',
      { body: `${tag} spam`, consent: true, hp: 'x'.repeat(300) },
      invite,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const spam = (await storiesTagged()).find((s) => s.spam_suspect);
    expect(spam?.source).toBe('story_page');
  });

  it('a bad Origin → 403 before anything is saved', async () => {
    const res = await fetch(`${BASE}/api/story-page`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: invite },
      body: JSON.stringify({ body: `${tag} evil` }),
    });
    expect(res.status).toBe(403);
    expect(await q(`select 1 from story where body = $1`, [`${tag} evil`])).toEqual([]);
  });

  it('QA4 L9: a name with a bidi override (U+202E) is refused, as invite names are; nothing saved', async () => {
    const res = await post(
      '/api/story-page',
      { name: 'Sam \u202eLTR', body: `${tag} bidi`, consent: false, clientKey: randomUUID() },
      invite,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: 'invalid', message: ERRORS.generic });
    expect(await q(`select 1 from story where body = $1`, [`${tag} bidi`])).toEqual([]);
  });
});
