// T3.2.01 / T3.2 AC7: the Resend adapter against a scripted fetch. Nothing leaves the machine.
import { describe, expect, it, vi } from 'vitest';
import { MailerHttpError, MailerQuotaError } from '@/lib/adapters/errors';
import {
  ATTEMPT_TIMEOUT_MS,
  createResendMailer,
  RESEND_URL,
  RETRY_DELAYS_MS,
} from '@/lib/adapters/resend/mailer';
import type { OutgoingEmail } from '@/lib/adapters/types';

const EMAIL: OutgoingEmail = {
  template: 'E4',
  to: 'dave@example.com',
  from: 'Jon <jon@timewithjon.com>',
  replyTo: 'jon.personal@example.com',
  subject: 'Locked in',
  text: 'See you then.\n',
  idempotencyKey: '7b0c4c1e-1111-4222-8333-944455556666', // gitleaks:allow (test fixture)
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setup(...answers: (Response | Error)[]) {
  const fetch = vi.fn(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn(async () => {});
  const mailer = createResendMailer({
    apiKey: 're_test_key',
    fetch: fetch as typeof globalThis.fetch,
    sleep,
  });
  return { fetch, sleep, mailer };
}

describe('ResendMailer', () => {
  it('posts one email with the key, the idempotency key and Reply-To, and returns Resend’s id', async () => {
    const { fetch, mailer } = setup(json(200, { id: 're_123' }));
    await expect(mailer.send({ ...EMAIL, html: '<p>x</p>' })).resolves.toEqual({ id: 're_123' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer re_test_key',
      'Idempotency-Key': EMAIL.idempotencyKey,
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      from: EMAIL.from,
      to: [EMAIL.to],
      reply_to: EMAIL.replyTo,
      subject: EMAIL.subject,
      text: EMAIL.text,
      html: '<p>x</p>',
    });
  });

  it('maps attachments (the .ics fallback) and extra headers', async () => {
    const { fetch, mailer } = setup(json(200, { id: 're_1' }));
    await mailer.send({
      ...EMAIL,
      headers: { 'X-Entity-Ref-ID': 'r1' },
      attachments: [{ filename: 'invite.ics', content: 'QkVHSU4=', contentType: 'text/calendar' }],
    });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.attachments).toEqual([
      { filename: 'invite.ics', content: 'QkVHSU4=', content_type: 'text/calendar' },
    ]);
    expect(body.headers).toEqual({ 'X-Entity-Ref-ID': 'r1' });
    expect(body).not.toHaveProperty('html');
  });

  it('retries a 5xx, a network error and the 429 rate limit (3 quick retries), with the same key', async () => {
    const { fetch, sleep, mailer } = setup(
      json(500, { name: 'internal_server_error' }),
      new TypeError('fetch failed'),
      json(429, { name: 'rate_limit_exceeded' }),
      json(200, { id: 're_ok' }),
    );
    await expect(mailer.send(EMAIL)).resolves.toEqual({ id: 're_ok' });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => (c as unknown as [number])[0])).toEqual([...RETRY_DELAYS_MS]);
    const keys = fetch.mock.calls.map(
      (c) =>
        ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)['Idempotency-Key'],
    );
    expect(new Set(keys)).toEqual(new Set([EMAIL.idempotencyKey]));
  });

  it('gives up after 3 retries with the last error', async () => {
    const { fetch, mailer } = setup(json(502, {}), json(503, {}), json(500, {}), json(504, {}));
    const err = await mailer.send(EMAIL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerHttpError);
    expect((err as MailerHttpError).status).toBe(504);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each(['daily_quota_exceeded', 'monthly_quota_exceeded'])(
    'AC7: a 429 %s is never retried: MailerQuotaError',
    async (name) => {
      const { fetch, sleep, mailer } = setup(json(429, { statusCode: 429, name, message: 'quota' }));
      await expect(mailer.send(EMAIL)).rejects.toBeInstanceOf(MailerQuotaError);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    },
  );

  it('a 4xx (a bad address, a bad key) is not retried', async () => {
    const { fetch, mailer } = setup(json(422, { name: 'validation_error' }));
    const err = await mailer.send(EMAIL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerHttpError);
    expect((err as MailerHttpError).status).toBe(422);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a 409 (an earlier try with this key still in flight) is retried; the replay returns the id', async () => {
    const { fetch, mailer } = setup(
      json(409, { name: 'concurrent_idempotent_requests' }),
      json(200, { id: 're_orig' }),
    );
    await expect(mailer.send(EMAIL)).resolves.toEqual({ id: 're_orig' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('each attempt has its own 10 s timeout; a timeout is retried like a network error', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const { fetch, mailer } = setup(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      json(200, { id: 're_9' }),
    );
    await expect(mailer.send(EMAIL)).resolves.toEqual({ id: 're_9' });
    expect(timeout).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(ATTEMPT_TIMEOUT_MS);
    expect(ATTEMPT_TIMEOUT_MS).toBe(10_000);
    const signals = (fetch.mock.calls as unknown as [string, RequestInit][]).map(([, i]) => i.signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[0]).not.toBe(signals[1]);
    timeout.mockRestore();
  });

  it('a 429 with no readable body is the rate limit (retried), never the quota', async () => {
    const { fetch, mailer } = setup(new Response('busy', { status: 429 }), json(200, { id: 're_2' }));
    await expect(mailer.send(EMAIL)).resolves.toEqual({ id: 're_2' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('an error never carries the API key or the recipient', async () => {
    const { mailer } = setup(json(401, { name: 'invalid_api_key' }));
    const err = (await mailer.send(EMAIL).catch((e: unknown) => e)) as Error;
    expect(`${err.name} ${err.message}`).not.toMatch(/re_test_key|dave@/);
  });
});
