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
    expect(await verifyTurnstile('tok', '1.2.3.4', 'request')).toBe(true);
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
    expect(await verifyTurnstile('bad', '1.2.3.4', 'request')).toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it('outside prototype: our own host and this form’s action pass; another host or another form’s action is refused', async () => {
    for (const mode of ['staging', 'production'] as const) {
      env.mode = mode;
      reportMessage.mockClear();
      // The real user: solved on our site, on this form.
      fetchMock.mockResolvedValue(answer({ success: true, hostname: 'localhost', action: 'request' }));
      expect(await verifyTurnstile('tok', '1.2.3.4', 'request'), mode).toBe(true);
      // Solved on the story page, replayed on the booking form.
      fetchMock.mockResolvedValue(answer({ success: true, hostname: 'localhost', action: 'story' }));
      expect(await verifyTurnstile('tok', '1.2.3.4', 'request'), mode).toBe(false);
      fetchMock.mockResolvedValue(answer({ success: true, hostname: 'localhost' })); // no action at all
      expect(await verifyTurnstile('tok', '1.2.3.4', 'request'), mode).toBe(false);
      // Solved on another site (B009), or no hostname at all.
      fetchMock.mockResolvedValue(answer({ success: true, hostname: 'evil.test', action: 'request' }));
      expect(await verifyTurnstile('tok', '1.2.3.4', 'request'), mode).toBe(false);
      fetchMock.mockResolvedValue(answer({ success: true, action: 'request' }));
      expect(await verifyTurnstile('tok', '1.2.3.4', 'request'), mode).toBe(false);
      expect(reportMessage, mode).toHaveBeenCalledTimes(4); // each mismatch shows (a config slip is visible)
    }
  });

  it('prototype runs Cloudflare’s test keys: another host and no action still pass', async () => {
    fetchMock.mockResolvedValue(answer({ success: true, hostname: 'example.com' }));
    expect(await verifyTurnstile('tok', '1.2.3.4', 'admin_sign_in')).toBe(true);
  });

  it('refuses a missing token without calling siteverify', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4', 'request')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open and reports when siteverify is unreachable (AC4)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await verifyTurnstile('tok', '1.2.3.4', 'request')).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.any(TypeError), { area: 'turnstile' });
  });

  it('fails open and reports on a siteverify 5xx (AC4)', async () => {
    fetchMock.mockResolvedValue(answer({}, 503));
    expect(await verifyTurnstile('tok', '1.2.3.4', 'request')).toBe(true);
    expect(report).toHaveBeenCalledOnce();
  });

  it('fails open with an alert when the secret is not configured', async () => {
    env.secret = undefined;
    expect(await verifyTurnstile('tok', '1.2.3.4', 'request')).toBe(true);
    expect(reportMessage).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
