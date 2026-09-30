// T3.6.08 staging check of the REAL Supabase Storage adapter (skipped unless STAGING_SUPABASE_URL is set; never
// in CI). Writes only under incoming/check-* and final/check-*, and removes it all. Run it with:
//   STAGING_SUPABASE_URL=… STAGING_SUPABASE_KEY=… (staging service-role key, from your secret store) \
//   pnpm -s vitest run -c vitest.int.config.ts tests/int/photo-store.staging.int.test.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { png } from '../fixtures/images';

const STAGING_URL = process.env.STAGING_SUPABASE_URL;
const STAGING_KEY = process.env.STAGING_SUPABASE_KEY;
vi.mock('@/config/env', async (orig) => {
  const real = await orig<typeof import('@/config/env')>();
  return {
    ...real,
    getEnv: () => ({ ...real.getEnv(), SUPABASE_URL: STAGING_URL, SUPABASE_SERVICE_ROLE_KEY: STAGING_KEY }),
  };
});
const { supabasePhotoStore } = await import('@/lib/adapters/supabase-storage');

describe.skipIf(!STAGING_URL || !STAGING_KEY)('supabasePhotoStore on staging', () => {
  // Built lazily: describe bodies run even when skipped, and without credentials the client refuses to exist.
  let store: ReturnType<typeof supabasePhotoStore>;
  beforeAll(() => {
    store = supabasePhotoStore();
  });
  const id = randomUUID();
  const incoming = `incoming/check-${id}`;
  const final = `final/check-${id}.jpg`;
  afterAll(async () => {
    await store.remove([incoming, final]);
  });

  it('signs an upload the browser can PUT to, then downloads the same bytes', async () => {
    const signed = await store.createSignedUploadUrl(incoming);
    expect(signed?.signedUrl).toContain(incoming);
    const bytes = await png(64, 48);
    const put = await fetch(signed!.signedUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: new Uint8Array(bytes),
    });
    expect(put.ok).toBe(true);
    expect(await store.download(incoming)).toEqual(bytes);
  });
  it('lists the raw file as older than a future cutoff, not a past one', async () => {
    expect(await store.listCreatedBefore('incoming', new Date(Date.now() + 60_000))).toContain(incoming);
    expect(await store.listCreatedBefore('incoming', new Date(Date.now() - 3_600_000))).not.toContain(
      incoming,
    );
  });
  it('uploads a final JPEG and signs a 10-minute read URL for it', async () => {
    await store.upload(final, await png(10, 10), 'image/jpeg');
    const urls = await store.createSignedUrls([final], 600);
    const res = await fetch(urls[final]!);
    expect(res.status).toBe(200);
  });
  it('a missing object downloads as null; remove makes it missing', async () => {
    await store.remove([incoming]);
    expect(await store.download(incoming)).toBeNull();
    expect(await store.download(`incoming/check-${randomUUID()}`)).toBeNull();
  });
});
