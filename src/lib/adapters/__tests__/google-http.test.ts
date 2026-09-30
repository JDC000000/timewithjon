// T3.3/T3.14: the Google fetch wrapper: timeouts on every call, short reason codes only, auth-failure detection.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_MAX_ATTEMPTS,
  GOOGLE_TIMEOUT_MS,
  GoogleApiError,
  googleFetch,
  isGoogleAuthFailure,
  isGoogleConfigError,
  isGoogleRetryable,
  withGoogleDeadline,
} from '../google/http';

const answer = (status: number, body?: unknown) =>
  vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
  );
afterEach(() => vi.unstubAllGlobals());

describe('googleFetch', () => {
  it('sends a bearer token, JSON or a form, and a 15 s abort signal', async () => {
    const f = answer(200, { id: 'x' });
    vi.stubGlobal('fetch', f);
    expect(await googleFetch('https://g/a', { op: 't', accessToken: 'tok', json: { a: 1 } })).toEqual({
      id: 'x',
    });
    await googleFetch('https://g/b', { op: 't', form: { k: 'v w' } });
    await googleFetch('https://g/c', { op: 't', method: 'DELETE' });
    const [a, b, c] = f.mock.calls.map((call) => call[1]);
    expect(a?.method).toBe('POST');
    expect(new Headers(a?.headers).get('authorization')).toBe('Bearer tok');
    expect(new Headers(a?.headers).get('content-type')).toBe('application/json');
    expect(a?.body).toBe('{"a":1}');
    expect(new Headers(b?.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(b?.body).toBe('k=v+w');
    expect(c?.method).toBe('DELETE');
    expect(new Headers(c?.headers).has('authorization')).toBe(false);
    expect(a?.signal).toBeInstanceOf(AbortSignal);
    expect(GOOGLE_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
  });

  it('returns undefined for an empty 204', async () => {
    vi.stubGlobal('fetch', answer(204));
    expect(await googleFetch('https://g', { op: 't', method: 'DELETE' })).toBeUndefined();
  });

  it.each([
    [{ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 'invalid_grant'],
    [{ error: { code: 404, errors: [{ reason: 'notFound' }], message: 'Not Found' } }, 'notFound'],
    [{ error: { code: 403, status: 'PERMISSION_DENIED' } }, 'PERMISSION_DENIED'],
    ['<html>oops</html>', ''],
    [undefined, ''],
  ])('keeps only the reason code of %j', async (body, reason) => {
    vi.stubGlobal('fetch', answer(400, body));
    const e = await googleFetch('https://g', { op: 'events_insert' }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GoogleApiError);
    expect(e).toMatchObject({ status: 400, reason, op: 'events_insert', name: 'GoogleApiError' });
    expect((e as Error).message).not.toMatch(/expired|revoked|Not Found|html/);
  });

  it('caps the reason code at 40 characters', async () => {
    vi.stubGlobal('fetch', answer(400, { error: 'x'.repeat(100) }));
    await expect(googleFetch('https://g', { op: 't' })).rejects.toMatchObject({ reason: 'x'.repeat(40) });
  });

  it('isGoogleAuthFailure: 401 or invalid_grant only', () => {
    expect(isGoogleAuthFailure(new GoogleApiError(401, '', 'x'))).toBe(true);
    expect(isGoogleAuthFailure(new GoogleApiError(400, 'invalid_grant', 'x'))).toBe(true);
    expect(isGoogleAuthFailure(new GoogleApiError(403, 'forbidden', 'x'))).toBe(false);
    expect(isGoogleAuthFailure(new Error('invalid_grant'))).toBe(false);
  });

  it('pr35 F6: invalid_client is a config error, never a dead grant (no E14 "reconnect")', () => {
    for (const status of [400, 401]) {
      const e = new GoogleApiError(status, 'invalid_client', 'token_refresh');
      expect(isGoogleAuthFailure(e)).toBe(false);
      expect(isGoogleConfigError(e)).toBe(true);
    }
    expect(isGoogleConfigError(new GoogleApiError(401, 'unauthorized_client', 'x'))).toBe(true);
    expect(isGoogleConfigError(new GoogleApiError(401, '', 'x'))).toBe(false);
    expect(isGoogleConfigError(new Error('invalid_client'))).toBe(false);
  });

  it('isGoogleRetryable: 5xx, 429, a 403 rate limit, timeouts and network errors; not other 4xx', () => {
    const api = (s: number, r = '') => new GoogleApiError(s, r, 'x');
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    const abort = Object.assign(new Error('a'), { name: 'AbortError' });
    for (const e of [
      api(500),
      api(503),
      api(429),
      api(403, 'rateLimitExceeded'),
      api(403, 'userRateLimitExceeded'),
    ])
      expect(isGoogleRetryable(e)).toBe(true);
    for (const e of [timeout, abort, new TypeError('fetch failed')]) expect(isGoogleRetryable(e)).toBe(true);
    for (const e of [api(400), api(401), api(403, 'forbidden'), api(404), api(409), new Error('x'), 'x'])
      expect(isGoogleRetryable(e)).toBe(false);
  });

  it('retries a 503 once, honouring Retry-After, then returns the good answer', async () => {
    const f = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response('{}', { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response('{"id":"x"}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await googleFetch('https://g', { op: 't' })).toEqual({ id: 'x' });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('gives up after GOOGLE_MAX_ATTEMPTS (2) on a 429 and throws the GoogleApiError', async () => {
    const f = vi.fn(async () => new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', { status: 429 }));
    vi.stubGlobal('fetch', f);
    await expect(googleFetch('https://g', { op: 'fb' })).rejects.toMatchObject({
      name: 'GoogleApiError',
      status: 429,
      reason: 'RESOURCE_EXHAUSTED',
    });
    expect(GOOGLE_MAX_ATTEMPTS).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('never retries a definite 4xx or a timeout', async () => {
    const f = answer(404, { error: { errors: [{ reason: 'notFound' }] } });
    vi.stubGlobal('fetch', f);
    await expect(googleFetch('https://g', { op: 't' })).rejects.toMatchObject({ status: 404 });
    expect(f).toHaveBeenCalledTimes(1);
    const t = vi.fn(async () => {
      throw Object.assign(new Error('late'), { name: 'TimeoutError' });
    });
    vi.stubGlobal('fetch', t);
    await expect(googleFetch('https://g', { op: 't' })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(t).toHaveBeenCalledTimes(1);
  });
});

describe('withGoogleDeadline (pr57 F2)', () => {
  it('past the hard stop: no call is made; the error is a retryable TimeoutError', async () => {
    const f = answer(200, {});
    vi.stubGlobal('fetch', f);
    const e = await withGoogleDeadline(Date.now() - 1, () => googleFetch('https://g', { op: 't' })).catch(
      (x: unknown) => x,
    );
    expect(e).toMatchObject({ name: 'TimeoutError' });
    expect(isGoogleRetryable(e)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("each call's abort timeout shrinks to the time left (15 s outside a deadline)", async () => {
    const f = answer(200, {});
    vi.stubGlobal('fetch', f);
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await withGoogleDeadline(Date.now() + 5_000, () => googleFetch('https://g', { op: 't' }));
    expect(spy.mock.calls[0]![0]).toBeGreaterThan(4_000);
    expect(spy.mock.calls[0]![0]).toBeLessThanOrEqual(5_000);
    await googleFetch('https://g', { op: 't' });
    expect(spy.mock.calls[1]![0]).toBe(GOOGLE_TIMEOUT_MS);
    spy.mockRestore();
  });

  it('skips the in-request retry when its wait would pass the hard stop', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 503, headers: { 'retry-after': '2' } }));
    vi.stubGlobal('fetch', f);
    await expect(
      withGoogleDeadline(Date.now() + 1_000, () => googleFetch('https://g', { op: 't' })),
    ).rejects.toMatchObject({ name: 'GoogleApiError', status: 503 });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
