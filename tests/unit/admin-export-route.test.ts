// T3.10.U1: POST /api/admin/export. Staging/production answer the signed link as JSON (unchanged); the prototype,
// whose bucket is in memory, answers the finished zip itself as an attachment (capped). 409 while one is running;
// a non-admin or a foreign Origin is refused before any export starts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ADMIN, SITE } from '../fixtures/unit-env';
import type { ExportResult } from '@/features/export/run';

const h = vi.hoisted(() => ({
  mode: 'prototype' as 'prototype' | 'staging' | 'production',
  email: null as string | null,
  result: null as unknown,
}));
vi.mock('@/config/env', async (orig) => {
  const m = await orig<typeof import('@/config/env')>();
  return { ...m, getEnv: () => ({ ...m.getEnv(), APP_MODE: h.mode }) };
});
vi.mock('@/features/admin/supabase', () => ({ currentAuthEmail: vi.fn(async () => h.email) }));
vi.mock('@/lib/report', () => ({ report: vi.fn() }));
vi.mock('@/lib/adapters/photos', () => ({ photoStore: () => ({}) }));
vi.mock('@/lib/adapters/exports', () => ({ exportStore: () => ({}) }));
vi.mock('@/features/export/run', async (orig) => ({
  ...(await orig<typeof import('@/features/export/run')>()),
  runExport: vi.fn(async () => h.result),
}));

const { POST } = await import('@/app/api/admin/export/route');
const { runExport, exportObjectPath } = await import('@/features/export/run');
const { prototypeExportStore } = await import('@/lib/adapters/mock/export-store');
const { PROTOTYPE_ZIP_MAX_BYTES } = await import('@/features/export/prototype-zip');

const JOB = '6a4f8f0e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
const DONE: ExportResult = {
  ok: true,
  jobId: JOB,
  url: 'https://example.supabase.co/storage/v1/object/sign/exports/zips/x.zip?token=t',
  stories: 2,
  photos: 1,
  bytes: 4,
};
const ZIP = Buffer.from('PK\x03\x04 zip bytes');
const post = (origin = SITE) =>
  POST(
    new NextRequest(`${SITE}/api/admin/export`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: '{}',
    }),
  );

beforeEach(() => {
  h.mode = 'prototype';
  h.email = ADMIN;
  h.result = DONE;
  prototypeExportStore.objects.clear();
  prototypeExportStore.put(exportObjectPath(JOB), ZIP);
  vi.mocked(runExport).mockClear();
});

describe('POST /api/admin/export (T3.10.U1)', () => {
  it('prototype: the zip itself, as a no-store attachment named by its Vancouver date', async () => {
    vi.useFakeTimers({ now: new Date('2027-07-01T06:30:00Z'), toFake: ['Date'] }); // still Jun 30 in Vancouver
    try {
      const res = await post();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/zip');
      expect(res.headers.get('content-disposition')).toBe(
        'attachment; filename="time-with-jon-stories-2027-06-30.zip"',
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(ZIP);
    } finally {
      vi.useRealTimers();
    }
    expect(vi.mocked(runExport).mock.calls[0]![0]).toEqual({ consentedOnly: true, includeEmail: false });
  });

  it('prototype: a zip over the cap, or one missing from the bucket, is refused with the generic line', async () => {
    prototypeExportStore.objects.set(exportObjectPath(JOB), {
      bytes: Buffer.alloc(PROTOTYPE_ZIP_MAX_BYTES + 1),
      createdAt: new Date(),
    });
    const big = await post();
    expect(big.status).toBe(413);
    expect(big.headers.get('cache-control')).toBe('no-store');
    expect(await big.json()).toMatchObject({
      ok: false,
      code: 'export_too_large',
      message: expect.any(String),
    });

    prototypeExportStore.objects.clear();
    const gone = await post();
    expect(gone.status).toBe(500);
    expect(await gone.json()).toMatchObject({ ok: false, code: 'export_failed' });
  });

  it.each(['staging', 'production'] as const)(
    '%s: unchanged, the JSON result with the signed link',
    async (mode) => {
      h.mode = mode;
      const res = await post();
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/^application\/json/);
      expect(res.headers.get('content-disposition')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual(DONE);
    },
  );

  it.each(['prototype', 'production'] as const)(
    '%s: 409 export_running while one is running',
    async (mode) => {
      h.mode = mode;
      h.result = { ok: false, code: 'busy' };
      const res = await post();
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ ok: false, code: 'export_running' });
    },
  );

  it('refuses a non-admin (401) and a foreign Origin (403) before any export starts', async () => {
    h.email = 'someone@example.com';
    expect((await post()).status).toBe(401);
    h.email = null;
    expect((await post()).status).toBe(401);
    h.email = ADMIN;
    expect((await post('https://evil.example')).status).toBe(403);
    expect(runExport).not.toHaveBeenCalled();
  });
});
