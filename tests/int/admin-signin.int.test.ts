// T2.1.03/07/08/09 (TSD T2.1 AC1, AC7, AC8, AC9): the sign-in door, against the real test DB. Supabase is mocked,
// so nothing is ever sent. `after()` is captured, so a test can check the answer came before the work ran.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import { q } from '@/lib/db';
import { sendOtpEmail } from '@/features/admin/supabase';
import { sendAdminSignIn, SIGNIN_FAILED_KEY } from '@/features/admin/signin';
import { releaseSlot, takeSlot } from '@/features/email/budget';
import { POST } from '@/app/api/admin/auth/start/route';

const pending = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => void pending.push(task),
}));
vi.mock('@/features/admin/supabase', () => ({ sendOtpEmail: vi.fn() }));
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: vi.fn(async (token?: string) => token === 'ok') }));

const otp = vi.mocked(sendOtpEmail);
const ADMIN = 'jon@example.com'; // tests/setup-int.ts ADMIN_EMAILS
const SITE = 'http://localhost:3000';
const accepted = () => otp.mockResolvedValue({ error: null });

async function today() {
  const rows = await q<{ sent: number; signin: number }>(
    `select sent_count as sent, signin_count as signin from email_budget
     where utc_day = (now() at time zone 'utc')::date`,
  );
  return rows[0] ?? { sent: 0, signin: 0 };
}
async function flag() {
  const rows = await q<{ value: string }>('select value from system_status where key = $1', [
    SIGNIN_FAILED_KEY,
  ]);
  return rows[0]?.value ?? null;
}
async function setSentCount(n: number) {
  await q(
    `insert into email_budget (utc_day, sent_count) values ((now() at time zone 'utc')::date, $1)
     on conflict (utc_day) do update set sent_count = $1`,
    [n],
  );
}
const start = (email: string, turnstileToken = 'ok', origin = SITE) =>
  POST(
    new NextRequest(`${SITE}/api/admin/auth/start`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken }),
    }),
  );
async function runPending() {
  const tasks = pending.splice(0);
  await Promise.all(tasks.map((t) => t()));
}

beforeEach(async () => {
  pending.length = 0;
  otp.mockReset();
  await q('delete from email_budget');
  await q('delete from system_status where key = $1', [SIGNIN_FAILED_KEY]);
  await q(`delete from rate_limit where scope = 'adminSignInStart'`);
});

describe('the budget counter (T2.1.07)', () => {
  it('AC7: an accepted allowlisted sign-in adds exactly 1 to sent_count and signin_count', async () => {
    accepted();
    expect(await sendAdminSignIn(ADMIN)).toBe('sent');
    expect(await today()).toEqual({ sent: 1, signin: 1 });
    expect(otp).toHaveBeenCalledWith(ADMIN);
  });

  it('AC7: a refused sign-in (Supabase 429) is refunded and raises no flag', async () => {
    otp.mockResolvedValue({ error: new AuthApiError('wait 60 seconds', 429, 'over_email_send_rate_limit') });
    expect(await sendAdminSignIn(ADMIN)).toBe('refused');
    expect(await today()).toEqual({ sent: 0, signin: 0 });
    expect(await flag()).toBeNull();
  });

  it('AC7: a non-allowlisted address takes no slot and makes no call', async () => {
    expect(await sendAdminSignIn('stranger@example.com')).toBe('not_allowlisted');
    expect(await today()).toEqual({ sent: 0, signin: 0 });
    expect(otp).not.toHaveBeenCalled();
  });

  it.each([
    ['production', 8],
    ['staging', 2],
    ['prototype', 2],
  ] as const)(
    'AC8: 20 parallel sign-ins in %s make at most %i calls and count at most that',
    async (mode, cap) => {
      accepted();
      const outcomes = await Promise.all(Array.from({ length: 20 }, () => sendAdminSignIn(ADMIN, mode)));
      expect(outcomes.filter((o) => o === 'sent')).toHaveLength(cap);
      expect(otp).toHaveBeenCalledTimes(cap);
      expect(await today()).toEqual({ sent: cap, signin: cap });
      expect(await flag()).toBe('capped');
    },
  );

  it('at 95 sent today the sign-in still goes out, with no flag', async () => {
    accepted();
    await setSentCount(95);
    expect(await sendAdminSignIn(ADMIN)).toBe('sent');
    expect(await today()).toEqual({ sent: 96, signin: 1 });
    expect(await flag()).toBeNull();
  });

  it('F3: at 100 sent today the sign-in still goes out, and the quota flag is raised', async () => {
    accepted();
    await setSentCount(100);
    expect(await sendAdminSignIn(ADMIN)).toBe('sent');
    expect(otp).toHaveBeenCalledOnce();
    expect(await flag()).toBe('quota');
  });

  it('app slots are never capped, and a release never goes below zero', async () => {
    for (let i = 0; i < 12; i++) expect(await takeSlot('app', 'production')).not.toBeNull();
    const slot = await takeSlot('signin', 'prototype');
    await releaseSlot('signin', slot!.day);
    await releaseSlot('signin', slot!.day);
    expect(await today()).toEqual({ sent: 12, signin: 0 });
  });
});

describe('the failure flag (T2.1.09)', () => {
  it('AC9: an SMTP failure sets the flag and refunds the slot', async () => {
    otp.mockResolvedValue({
      error: new AuthApiError('Error sending magic link email', 500, 'unexpected_failure'),
    });
    expect(await sendAdminSignIn(ADMIN)).toBe('refused');
    expect(await flag()).toBe('smtp');
    expect(await today()).toEqual({ sent: 0, signin: 0 });
  });

  it('a network failure keeps the slot (the email may have gone) and sets the flag', async () => {
    otp.mockResolvedValue({ error: new AuthRetryableFetchError('fetch failed', 0) });
    expect(await sendAdminSignIn(ADMIN)).toBe('unknown');
    expect(await today()).toEqual({ sent: 1, signin: 1 });
    expect(await flag()).toBe('smtp');
  });
});

describe('POST /api/admin/auth/start (T2.1.03, T2.1.08)', () => {
  it('AC1/F12: the same 200 for every address, sent before the Supabase call resolves', async () => {
    let release!: () => void;
    otp.mockReturnValue(new Promise((resolve) => (release = () => resolve({ error: null }))));
    for (const email of [ADMIN, 'stranger@example.com']) {
      const res = await start(email);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(pending).toHaveLength(2);
    const work = runPending();
    await vi.waitFor(() => expect(otp).toHaveBeenCalledOnce());
    release();
    await work;
    expect(await today()).toEqual({ sent: 1, signin: 1 });
  });

  it('AC8: without a valid Turnstile token: 400, no slot, no call, for any address', async () => {
    for (const email of [ADMIN, 'stranger@example.com']) {
      expect((await start(email, 'bad')).status).toBe(400);
    }
    expect(pending).toHaveLength(0);
  });

  it('AC8: a 6th start from one IP within the hour gets the same 200 and does nothing', async () => {
    accepted();
    for (let i = 0; i < 5; i++) expect((await start(`guest${i}@example.com`)).status).toBe(200);
    expect(pending).toHaveLength(5);
    pending.length = 0;
    const res = await start(ADMIN);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(pending).toHaveLength(0);
    expect(otp).not.toHaveBeenCalled();
  });

  it('refuses a foreign Origin (403) and a malformed body (400) before any work', async () => {
    expect((await start(ADMIN, 'ok', 'https://evil.example')).status).toBe(403);
    expect((await start('not-an-email')).status).toBe(400);
    expect(pending).toHaveLength(0);
  });
});
