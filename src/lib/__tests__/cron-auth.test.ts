// AD-8: the job endpoints answer only a caller holding CRON_SECRET in the x-cron-secret header (as pg_cron sends it).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SITE } from '../../../tests/fixtures/unit-env';
import { hasCronSecret } from '@/lib/cron-auth';

const call = (secret?: string, extra: Record<string, string> = {}) =>
  new NextRequest(`${SITE}/api/jobs/media`, {
    method: 'POST',
    headers: { ...(secret === undefined ? {} : { 'x-cron-secret': secret }), ...extra },
  });
const SECRET = 'c'.repeat(32); // tests/fixtures/unit-env.ts

describe('hasCronSecret', () => {
  afterEach(() => vi.resetModules());
  it('accepts the x-cron-secret header', () => expect(hasCronSecret(call(SECRET))).toBe(true));
  it.each([undefined, '', `Bearer ${SECRET}`, `${SECRET}x`, 'c'.repeat(31)])('refuses %j', (h) =>
    expect(hasCronSecret(call(h))).toBe(false),
  );
  it('ignores a Bearer authorization header (the old shape)', () =>
    expect(hasCronSecret(call(undefined, { authorization: `Bearer ${SECRET}` }))).toBe(false));
});

describe('hasCronSecret with no CRON_SECRET configured', () => {
  it('refuses even an empty header (fail closed)', async () => {
    vi.resetModules();
    vi.doMock('@/config/env', () => ({ getEnv: () => ({ CRON_SECRET: '' }) }));
    const { hasCronSecret: check } = await import('@/lib/cron-auth');
    expect(check(call(''))).toBe(false);
    expect(check(call(undefined))).toBe(false);
    vi.doUnmock('@/config/env');
  });
});
