// T1.4 AC1, AC2, AC3, AC5, AC6 — the resolver route against the test DB.
import { afterAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/invite/resolve/route';
import { pool, q } from '@/lib/db';
import { todayCount } from '../fixtures/event-count';

const call = (forParam: string, opts: { ua?: string; ip?: string; next?: string; cookie?: string } = {}) =>
  GET(
    new NextRequest(
      `http://localhost:3000/api/invite/resolve?for=${encodeURIComponent(forParam)}&next=${encodeURIComponent(opts.next ?? '/')}`,
      {
        headers: {
          'user-agent': opts.ua ?? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari',
          'x-real-ip': opts.ip ?? '10.0.0.1',
          ...(opts.cookie ? { cookie: opts.cookie } : {}),
        },
      },
    ),
  );
afterAll(async () => {
  await pool().end();
});

describe('T1.4 invite resolve', () => {
  it('AC1 valid token sets twj_invite and 303s to a URL with no ?for=', async () => {
    const opened = await todayCount('invite_opened');
    const res = await call('dave-k7q2m9xp', { next: '/?utm=x' });
    expect(res.status).toBe(303);
    expect(await todayCount('invite_opened')).toBe(opened + 1); // T3.11
    expect(res.headers.get('location')).toBe('http://localhost:3000/?utm=x');
    expect(res.cookies.get('twj_invite')?.value).toMatch(/\./);
  });
  it('AC3 right name, wrong secret: nothing personal, stale flag', async () => {
    const res = await call('dave-zzzzzzzz');
    expect(res.cookies.get('twj_invite')?.value ?? '').toBe('');
    expect(res.cookies.get('twj_stale')?.value).toBe('1');
  });
  it('AC2 a revoked token shows the stale state', async () => {
    await q(`update invite set revoked_at = now() where token_secret = 'p4r8t2wz'`);
    const res = await call('priya-p4r8t2wz');
    expect(res.cookies.get('twj_stale')?.value).toBe('1');
    await q(`update invite set revoked_at = null where token_secret = 'p4r8t2wz'`);
  });
  it('AC6 a preview-bot user agent does not change open_count', async () => {
    const before = (
      await q<{ open_count: number }>(`select open_count from invite where token_secret = 'k7q2m9xp'`)
    )[0]!.open_count;
    const opened = await todayCount('invite_opened');
    await call('dave-k7q2m9xp', { ua: 'facebookexternalhit/1.1', ip: '10.0.0.2' });
    expect(await todayCount('invite_opened')).toBe(opened); // T3.11: bots count nothing
    const after = (
      await q<{ open_count: number }>(`select open_count from invite where token_secret = 'k7q2m9xp'`)
    )[0]!.open_count;
    expect(after).toBe(before);
  });
  it('M1 a backslash next= cannot redirect off-site', async () => {
    const res = await call('dave-k7q2m9xp', { next: '/\\evil.example', ip: '10.0.0.3' });
    expect(res.headers.get('location')).toBe('http://localhost:3000/');
  });
  it('L2 a bad link keeps a valid existing session (no logout, no stale flag)', async () => {
    const first = await call('dave-k7q2m9xp', { ip: '10.0.0.4' });
    const session = first.cookies.get('twj_invite')!.value;
    const res = await call('dave-zzzzzzzz', { ip: '10.0.0.4', cookie: `twj_invite=${session}` });
    expect(res.status).toBe(303);
    expect(res.cookies.get('twj_invite')).toBeUndefined(); // untouched: not deleted, not re-set
    expect(res.cookies.get('twj_stale')).toBeUndefined();
  });
  it('M2 a client-set x-real-ip / x-forwarded-for never becomes a rate-limit key (off Vercel: one shared bucket)', async () => {
    await call('dave-k7q2m9xp', { ip: '198.51.100.7' });
    const keys = (
      await q<{ key: string }>(`select distinct key from rate_limit where scope = 'inviteLookup'`)
    ).map((r) => r.key);
    expect(keys).toEqual(['local']);
  });
  it('AC5 the 31st lookup in a minute gets 429, whatever IP header the client sends', async () => {
    // L9: pre-fill 30 hits in this minute AND the next, so the assertion can't straddle a minute boundary.
    await q(
      `insert into rate_limit (scope, key, window_start, count)
       select 'inviteLookup', 'local', date_bin('60 seconds', now(), timestamptz 'epoch') + m * interval '1 minute', 30
         from generate_series(0, 1) m
       on conflict (scope, key, window_start) do update set count = 30`,
    );
    expect((await call('dave-k7q2m9xp', { ip: '10.9.9.9' })).status).toBe(429); // a "fresh" spoofed IP doesn't help
    await q(`delete from rate_limit where scope = 'inviteLookup' and key = 'local'`); // later suites share the bucket
  });
});
