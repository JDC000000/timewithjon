// T3.7.02–.04 (TSD T3.7 AC2–AC3) and T3.12.01–.02 (AC1) against the real schema with the in-memory bucket:
// Jon's "Add emailed story" through /api/admin/stories/**, up to 5 photos queued for /api/jobs/media, nothing
// sent; the story page's save (one story per capability) and its 2 photos through the T3.6 pipeline.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { pool, q } from '@/lib/db';
import { POST as emailInRoute } from '@/app/api/admin/stories/email-in/route';
import { POST as adminSignRoute } from '@/app/api/admin/stories/[id]/photos/sign/route';
import { POST as adminFinaliseRoute } from '@/app/api/admin/stories/[id]/photos/finalise/route';
import { createStoryPageStory, ownStoryPageStory, saveStoryPageStory } from '@/features/photos/story-page';
import { signPhotoUpload } from '@/features/photos/sign';
import { finalisePhotoUpload } from '@/features/photos/finalise';
import { runMediaJob } from '@/features/jobs/media';
import { createMemoryBackup, createMemoryStore, type MemoryStore } from '@/lib/adapters/mock/object-store';
import { hasMetadata, jpegWithGps } from '../fixtures/images';

const mem = vi.hoisted(() => ({ store: null as unknown as MemoryStore }));
vi.mock('@/lib/adapters/photos', async (orig) => ({
  ...(await orig<typeof import('@/lib/adapters/photos')>()),
  photoStore: () => mem.store,
}));
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => 'jon@example.com') }));

const SITE = 'http://localhost:3000';
const tag = `int-stories-${randomUUID().slice(0, 8)}`;
type TestInvite = Parameters<typeof saveStoryPageStory>[1];
/** A new story_page story (createStoryPageStory is the only way one is made). */
const createStory = async (...a: Parameters<typeof createStoryPageStory>) =>
  (await createStoryPageStory(...a))!;
const INVITE: TestInvite = {
  id: '',
  kind: 'personal',
  display_name: 'Pia',
  prefill_name: null,
  prefill_email: 'pia@example.com',
};
const OTHER: TestInvite = { ...INVITE, id: '', display_name: 'Tom', prefill_email: null };
const secret = () =>
  Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstvwxyz23456789'[Math.floor(Math.random() * 30)]).join('');
async function makeInvite(isTest: boolean): Promise<string> {
  const rows = await q<{ id: string }>(
    `insert into invite (kind, token_secret, name_slug, display_name, is_test)
     values ('personal', $1, $2, 'x', $3) returning id`,
    [secret(), `${tag}-${secret()}`, isTest],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  INVITE.id = await makeInvite(true);
  OTHER.id = await makeInvite(false);
});

beforeEach(async () => {
  mem.store = createMemoryStore();
  await q(`delete from outbox where kind in ('r2_copy', 'attachment_finalise')`);
});
afterAll(async () => {
  await q(`delete from story where body like $1`, [`${tag}%`]);
  await q(`delete from invite where name_slug like $1`, [`${tag}%`]);
  await q(`delete from outbox where kind in ('r2_copy', 'attachment_finalise')`);
  await pool().end();
});

const post = (path: string, body: unknown, origin = SITE) =>
  new NextRequest(`${SITE}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const emailed = (over: Record<string, unknown> = {}) => ({
  fromName: 'Aunt Ro',
  fromEmail: 'ro@example.com',
  body: `${tag} the time Jon fell in the lake`,
  consent: true,
  ...over,
});
async function addEmailed(over: Record<string, unknown> = {}): Promise<string> {
  const res = await emailInRoute(post('/api/admin/stories/email-in', emailed(over)));
  expect(res.status).toBe(201);
  return ((await res.json()) as { storyId: string }).storyId;
}
const sign = (id: string) => adminSignRoute(post(`/api/admin/stories/${id}/photos/sign`, {}), params(id));
const finalise = (id: string, photoUploadId: string) =>
  adminFinaliseRoute(post(`/api/admin/stories/${id}/photos/finalise`, { photoUploadId }), params(id));
const storyRow = async (id: string) =>
  (
    await q<{ source: string; consent: boolean; consent_source: string | null; consent_needs_jon: boolean }>(
      `select source, consent, consent_source, consent_needs_jon from story where id = $1`,
      [id],
    )
  )[0];

describe('T3.7.02 POST /api/admin/stories/email-in', () => {
  it('ticked: source email_in, consent_source jon, not "needs Jon"; never cached', async () => {
    const res = await emailInRoute(post('/api/admin/stories/email-in', emailed()));
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const { storyId } = (await res.json()) as { storyId: string };
    expect(await storyRow(storyId)).toEqual({
      source: 'email_in',
      consent: true,
      consent_source: 'jon',
      consent_needs_jon: false,
    });
  });
  it('unticked: no consent yet, so it waits under "needs Jon"', async () => {
    expect(await storyRow(await addEmailed({ consent: false }))).toEqual({
      source: 'email_in',
      consent: false,
      consent_source: null,
      consent_needs_jon: true,
    });
  });
  it.each([
    ['no name', { fromName: ' ' }],
    ['a bad address', { fromEmail: 'not-an-email' }],
    ['an empty story', { body: '   ' }],
    ['a story over 5000', { body: 'x'.repeat(5001) }],
  ])('%s → 400, nothing saved', async (_, over) => {
    const before = await q(`select 1 from story where body like $1`, [`${tag}%`]);
    const res = await emailInRoute(post('/api/admin/stories/email-in', emailed(over)));
    expect(res.status).toBe(400);
    expect(await q(`select 1 from story where body like $1`, [`${tag}%`])).toHaveLength(before.length);
  });
  it('a cross-site write → 403 (requireAdmin checks Origin)', async () => {
    const res = await emailInRoute(post('/api/admin/stories/email-in', emailed(), 'https://evil.example'));
    expect(res.status).toBe(403);
  });
  it('AC3: adding a story sends nothing (no email_log row, no outbox row)', async () => {
    const [mail] = await q<{ n: number }>(`select count(*)::int as n from email_log`);
    const [box] = await q<{ n: number }>(`select count(*)::int as n from outbox`);
    await addEmailed();
    expect((await q<{ n: number }>(`select count(*)::int as n from email_log`))[0]!.n).toBe(mail!.n);
    expect((await q<{ n: number }>(`select count(*)::int as n from outbox`))[0]!.n).toBe(box!.n);
  });
});

describe('pr82 F5: POST /api/admin/stories/email-in is idempotent on the Idempotency-Key header', () => {
  const keyed = (key: string, over: Record<string, unknown> = {}) => {
    const req = post('/api/admin/stories/email-in', emailed(over));
    req.headers.set('idempotency-key', key);
    return emailInRoute(req);
  };
  const withKey = async (key: string) =>
    (await q<{ n: number }>(`select count(*)::int as n from story where idempotency_key = $1`, [key]))[0]!.n;

  it('a replay of the same payload (lost 201, retried) answers the same 201 body with the first story: one row', async () => {
    const key = randomUUID();
    const first = await keyed(key);
    const again = await keyed(key);
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.headers.get('cache-control')).toContain('no-store');
    const body = await first.json();
    expect(await again.json()).toEqual(body);
    expect(await withKey(key)).toBe(1);
  });

  it('pr83 M1: the same key with an edited payload -> 409, nothing changes; a new key then adds it', async () => {
    const key = randomUUID();
    const { storyId } = (await (await keyed(key)).json()) as { storyId: string };
    for (const edit of [
      { body: `${tag} edited before the retry` },
      { consent: false },
      { fromName: 'Aunt Rosa' },
    ]) {
      const res = await keyed(key, edit);
      expect(res.status, JSON.stringify(edit)).toBe(409);
      expect(res.headers.get('cache-control')).toContain('no-store');
      expect(((await res.json()) as { code: string }).code).toBe('key_reused');
    }
    expect(await withKey(key)).toBe(1);
    const [row] = await q<{ body: string; consent: boolean; from_name: string }>(
      `select body, consent, from_name from story where id = $1`,
      [storyId],
    );
    expect(row).toEqual({
      body: `${tag} the time Jon fell in the lake`,
      consent: true,
      from_name: 'Aunt Ro',
    });
    expect((await keyed(randomUUID(), { body: `${tag} edited before the retry` })).status).toBe(201);
  });

  it('pr83 M1: the email is bound case-insensitively (it is stored as citext)', async () => {
    const key = randomUUID();
    expect((await keyed(key)).status).toBe(201);
    expect((await keyed(key, { fromEmail: 'RO@example.com' })).status).toBe(201);
    expect(await withKey(key)).toBe(1);
  });

  it('pr83 M1: two different payloads racing on one key: one 201, one 409, one row', async () => {
    const key = randomUUID();
    const res = await Promise.all([keyed(key), keyed(key, { body: `${tag} the other one` })]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await withKey(key)).toBe(1);
  });

  it('a concurrent double submit with one key makes one row; every answer is 201 with its id', async () => {
    const key = randomUUID();
    const res = await Promise.all(Array.from({ length: 6 }, () => keyed(key)));
    expect(res.map((r) => r.status)).toEqual(Array(6).fill(201));
    const ids = new Set(
      await Promise.all(res.map(async (r) => ((await r.json()) as { storyId: string }).storyId)),
    );
    expect(ids.size).toBe(1);
    expect(await withKey(key)).toBe(1);
  });

  it('a different key (the next story) makes a second row; no key keeps the old behaviour', async () => {
    const a = await keyed(randomUUID());
    const b = await keyed(randomUUID());
    const [ida, idb] = await Promise.all(
      [a, b].map(async (r) => ((await r.json()) as { storyId: string }).storyId),
    );
    expect(ida).not.toBe(idb);
    const plain = await Promise.all([addEmailed(), addEmailed()]);
    expect(plain[0]).not.toBe(plain[1]);
  });

  it('the key is scoped per source: a story_page story with the same key is not answered', async () => {
    const key = randomUUID();
    const [other] = await q<{ id: string }>(
      `insert into story (source, from_name, body, idempotency_key, idempotency_payload_hash)
       values ('story_page', 'Pia', $1, $2, repeat('a', 64)) returning id`,
      [`${tag} a story-page story`, key],
    );
    const res = await keyed(key);
    expect(res.status).toBe(201);
    const { storyId } = (await res.json()) as { storyId: string };
    expect(storyId).not.toBe(other!.id);
    expect((await storyRow(storyId))?.source).toBe('email_in');
    expect(await withKey(key)).toBe(2);
    expect((await keyed(key)).status).toBe(201);
    expect(await withKey(key)).toBe(2);
  });

  it('a malformed key -> 400 and nothing is written (never a silent un-keyed insert)', async () => {
    const [before] = await q<{ n: number }>(`select count(*)::int as n from story`);
    for (const bad of ['short', 'x'.repeat(129), `${'a'.repeat(20)} b`, `${'a'.repeat(20)};drop`]) {
      const res = await keyed(bad);
      expect(res.status, bad).toBe(400);
      expect(res.headers.get('cache-control')).toContain('no-store');
    }
    expect((await q<{ n: number }>(`select count(*)::int as n from story`))[0]!.n).toBe(before!.n);
  });

  it('the database refuses a malformed key or hash, and a key without its hash (or the reverse)', async () => {
    const ins = (key: string | null, hash: string | null) =>
      q(
        `insert into story (source, body, idempotency_key, idempotency_payload_hash) values ('email_in', $1, $2, $3)`,
        [`${tag} x`, key, hash],
      );
    const h = 'a'.repeat(64);
    await expect(ins('bad key', h)).rejects.toThrow(/story_idempotency_key_format/);
    await expect(ins(randomUUID(), 'A'.repeat(64))).rejects.toThrow(/story_idempotency_payload_hash_format/);
    await expect(ins(randomUUID(), null)).rejects.toThrow(/story_idempotency_pair/);
    await expect(ins(null, h)).rejects.toThrow(/story_idempotency_pair/);
  });
});

describe('T3.7.03 photos for an emailed story', () => {
  it('up to 5 places; the 6th → 409; never cached', async () => {
    const id = await addEmailed();
    for (let i = 1; i <= 5; i++) {
      const res = await sign(id);
      expect(res.status, `photo ${i}`).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    const sixth = await sign(id);
    expect(sixth.status).toBe(409);
    expect(await sixth.json()).toMatchObject({ code: 'too_many_photos' });
  });
  it("a guest's story, an unknown id or a non-uuid → 404 (photos only on Jon's emailed stories)", async () => {
    const guest = await createStory(INVITE, { body: `${tag} guest`, consent: true });
    for (const id of [guest, randomUUID(), 'nope']) expect((await sign(id)).status, id).toBe(404);
  });
  it('AC2: finalise queues once (202), the media job re-encodes (no EXIF), then it answers the photo (200)', async () => {
    const id = await addEmailed();
    const s = (await (await sign(id)).json()) as { uploadId: string; path: string };
    mem.store.put(s.path, await jpegWithGps(), 'image/jpeg');
    expect((await finalise(id, s.uploadId)).status).toBe(202);
    expect((await finalise(id, s.uploadId)).status).toBe(202); // a double tap queues nothing more
    const jobs = await q(
      `select 1 from outbox where kind = 'attachment_finalise' and payload->>'photoUploadId' = $1`,
      [s.uploadId],
    );
    expect(jobs).toHaveLength(1);
    await runMediaJob({ store: mem.store, backup: createMemoryBackup() }, 5_000, 0);
    const [p] = await q<{ id: string; storage_path: string }>(
      `select id, storage_path from photo where story_id = $1`,
      [id],
    );
    expect(await hasMetadata(mem.store.objects.get(p!.storage_path)!.bytes)).toBe(false);
    const again = await finalise(id, s.uploadId);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, photoId: p!.id });
  });
  it("another story's upload, or a bad body → refused, nothing queued", async () => {
    const a = await addEmailed();
    const b = await addEmailed();
    const s = (await (await sign(a)).json()) as { uploadId: string };
    expect((await finalise(b, s.uploadId)).status).toBe(404);
    expect((await finalise(a, 'nope')).status).toBe(400);
    expect(await q(`select 1 from outbox where kind = 'attachment_finalise'`)).toEqual([]);
  });
  it('a spent job (max attempts) does not block a re-queue after a re-upload', async () => {
    const id = await addEmailed();
    const s = (await (await sign(id)).json()) as { uploadId: string };
    expect((await finalise(id, s.uploadId)).status).toBe(202);
    await q(`update outbox set attempts = 99 where kind = 'attachment_finalise'`);
    expect((await finalise(id, s.uploadId)).status).toBe(202);
    expect(await q(`select 1 from outbox where kind = 'attachment_finalise'`)).toHaveLength(2);
  });
});

describe('T3.12.01 the story page (no booking)', () => {
  it('first save creates a story_page story; the capability id updates the same one (sticky spam)', async () => {
    const id = await createStory(INVITE, { body: `${tag} sp`, consent: false, spam: true });
    const again = await saveStoryPageStory(id, INVITE, { body: `${tag} sp2`, consent: true, name: 'Pia C' });
    expect(again).toBe(id);
    const [s] = await q(
      `select source, from_name, from_email::text, body, consent, consent_source, spam_suspect, request_id
         from story where id = $1`,
      [id],
    );
    expect(s).toEqual({
      source: 'story_page',
      from_name: 'Pia C',
      from_email: 'pia@example.com',
      body: `${tag} sp2`,
      consent: true,
      consent_source: 'tickbox',
      spam_suspect: true,
      request_id: null,
    });
  });
  it('pr43 F1: a story saved through an is_test invite is reachable through invite.is_test (purge, export)', async () => {
    const id = await createStory(INVITE, { body: `${tag} test-invite`, consent: true });
    const other = await createStory(OTHER, { body: `${tag} real-invite`, consent: true });
    const viaTest = await q<{ id: string }>(
      `select s.id from story s join invite i on i.id = s.invite_id where i.is_test and s.body like $1`,
      [`${tag}%`],
    );
    expect(viaTest.map((r) => r.id)).toContain(id);
    expect(viaTest.map((r) => r.id)).not.toContain(other);
  });
  it('pr43 N2: story.invite_id is a real FK, and deleting the invite only unlinks its stories', async () => {
    await expect(
      q(`insert into story (source, invite_id, body) values ('story_page', $1, $2)`, [
        randomUUID(),
        `${tag} fk`,
      ]),
    ).rejects.toMatchObject({ code: '23503' });
    const gone: TestInvite = { ...OTHER, id: await makeInvite(true) };
    const id = await createStory(gone, { body: `${tag} unlinked`, consent: false });
    await q(`delete from invite where id = $1`, [gone.id]);
    expect(await q(`select invite_id from story where id = $1`, [id])).toEqual([{ invite_id: null }]);
  });
  it('pr43 F3: twj_story counts only through the invite it was saved on (another invite: none, new story)', async () => {
    const id = await createStory(INVITE, { body: `${tag} mine`, consent: false });
    expect(await ownStoryPageStory(id, INVITE.id)).toBe(id);
    expect(await ownStoryPageStory(id, OTHER.id)).toBeNull();
    const before = (await q(`select 1 from story`)).length;
    const theirs = await saveStoryPageStory(id, OTHER, { body: `${tag} theirs`, consent: true });
    expect(theirs).toBeNull(); // never another invite's story, and never a new one from here
    expect(await q(`select body from story where id = $1`, [id])).toEqual([{ body: `${tag} mine` }]);
    expect((await q(`select 1 from story`)).length).toBe(before);
  });
  it('pr43 F4: no typed name → a personal label or the prefill, never a general invite label', async () => {
    const name = async (inv: TestInvite) => {
      const id = await createStory(inv, { body: `${tag} name`, consent: false });
      return (await q<{ from_name: string | null }>(`select from_name from story where id = $1`, [id]))[0]!
        .from_name;
    };
    expect(await name(INVITE)).toBe('Pia');
    expect(await name({ ...INVITE, kind: 'general', display_name: 'Friends' })).toBeNull();
    expect(await name({ ...INVITE, kind: 'general', display_name: 'Friends', prefill_name: 'Pia P' })).toBe(
      'Pia P',
    );
  });
  it('a capability for another kind of story never lets the page write to it, nor makes a new one', async () => {
    const emailedId = await addEmailed();
    const id = await saveStoryPageStory(emailedId, INVITE, { body: `${tag} sp3`, consent: false });
    expect(id).toBeNull();
    expect(await q(`select 1 from story where body = $1`, [`${tag} sp3`])).toEqual([]);
    expect((await storyRow(emailedId))!.source).toBe('email_in');
  });
  it('T3.12.02 AC1: a story + 2 photos save (EXIF stripped); a 3rd is refused', async () => {
    const id = await createStory(INVITE, { body: `${tag} photos`, consent: true });
    for (let i = 0; i < 2; i++) {
      const s = await signPhotoUpload(id, mem.store);
      if (!s.ok) throw new Error(s.code);
      mem.store.put(s.path, await jpegWithGps(), 'image/jpeg');
      expect((await finalisePhotoUpload(s.uploadId, id, mem.store)).ok).toBe(true);
    }
    expect(await signPhotoUpload(id, mem.store)).toEqual({ ok: false, code: 'too_many' });
    const photos = await q<{ storage_path: string }>(`select storage_path from photo where story_id = $1`, [
      id,
    ]);
    expect(photos).toHaveLength(2);
    for (const p of photos)
      expect(await hasMetadata(mem.store.objects.get(p.storage_path)!.bytes)).toBe(false);
  });
});
