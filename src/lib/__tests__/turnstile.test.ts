// T3.8 AC1/AC4 (server side): a refused token is refused; a siteverify outage fails OPEN and alerts Sentry.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../tests/fixtures/unit-env';

const report = vi.hoisted(() => vi.fn());
const reportMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/report', () => ({ report, reportMessage }));
const env = vi.hoisted(() => ({
  secret: 'turnstile-secret' as string | undefined,
  mode: 'prototype' as 'prototype' | 'staging' | 'production',
}));
vi.mock('@/config/env', async (orig) => {
  const real = await orig<typeof import('@/config/env')>();
  return {
    ...real,
    getEnv: () => ({ ...real.getEnv(), TURNSTILE_SECRET_KEY: env.secret, APP_MODE: env.mode }),
  };
});
const { verifyTurnstile } = await import('@/lib/turnstile');

const fetchMock = vi.fn();
beforeEach(() => {
  env.secret = 'turnstile-secret';
  env.mode = 'prototype';
  report.mockClear();
  reportMessage.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('verifyTurnstile', () => {
  it('accepts a token siteverify accepts, sending the secret, token and IP', async () => {
    fetchMock.mockResolvedValue(answer({ success: true }));
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: 'turnstile-secret',
      response: 'tok',
      remoteip: '1.2.3.4',
    });
  });

  it('refuses a token siteverify refuses (AC1), with no alert', async () => {
    fetchMock.mockResolvedValue(answer({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyTurnstile('bad', '1.2.3.4')).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it('staging does not check the hostname (test keys answer another host)', async () => {
    env.mode = 'staging';
    fetchMock.mockResolvedValue(answer({ success: true, hostname: 'example.com' }));
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
  });

  it('in production, refuses a solve from another hostname and accepts our own (B009)', async () => {
    env.mode = 'production';
    fetchMock.mockResolvedValue(answer({ success: true, hostname: 'evil.test' }));
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(false);
    expect(reportMessage).toHaveBeenCalledOnce();
    fetchMock.mockResolvedValue(answer({ success: true })); // no hostname at all
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(false);
    fetchMock.mockResolvedValue(answer({ success: true, hostname: 'localhost' })); // NEXT_PUBLIC_SITE_URL's host
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
  });

  it('refuses a missing token without calling siteverify', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open and reports when siteverify is unreachable (AC4)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.any(TypeError), { area: 'turnstile' });
  });

  it('fails open and reports on a siteverify 5xx (AC4)', async () => {
    fetchMock.mockResolvedValue(answer({}, 503));
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
    expect(report).toHaveBeenCalledOnce();
  });

  it('fails open with an alert when the secret is not configured', async () => {
    env.secret = undefined;
    expect(await verifyTurnstile('tok', '1.2.3.4')).toBe(true);
    expect(reportMessage).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
