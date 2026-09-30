// T3.13.01: Svix verification (the published Svix test vector) and Resend's last_event mapping.
import { describe, expect, it, vi } from 'vitest';
import { svixSign, TOLERANCE_S, verifySvix } from '@/lib/adapters/resend/webhook';
import { createResendStatusSource, mapLastEvent, RESEND_EMAILS_URL } from '@/lib/adapters/resend/status';
import { MailerHttpError } from '@/lib/adapters/errors';

// From Svix's docs; the same signature the `svix` package produces for these inputs.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'; // gitleaks:allow (test fixture)
const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
const TS = '1614265330';
const BODY = '{"test": 2432232314}';
const SIG = 'g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
const NOW = Number(TS) * 1000;
const h = (signature: string | null, id: string | null = ID, timestamp: string | null = TS) => ({
  id,
  timestamp,
  signature,
});

describe('verifySvix', () => {
  it('matches the published vector', () => {
    expect(svixSign(SECRET, ID, TS, BODY)).toBe(SIG);
    expect(verifySvix(SECRET, h(`v1,${SIG}`), BODY, NOW)).toBe(true);
  });
  it('accepts any matching v1 entry in a space-separated list (key rotation)', () => {
    expect(verifySvix(SECRET, h(`v1,AAAA v1,${SIG}`), BODY, NOW)).toBe(true);
    expect(verifySvix(SECRET, h(`v1a,${SIG}`), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v2,${SIG}`), BODY, NOW)).toBe(false);
  });
  it('refuses a changed body, id or timestamp, a wrong secret, and missing headers', () => {
    expect(verifySvix(SECRET, h(`v1,${SIG}`), BODY + ' ', NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v1,${SIG}`, 'msg_other'), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v1,${SIG}`, ID, String(Number(TS) + 1)), BODY, NOW + 1000)).toBe(false);
    expect(verifySvix('whsec_' + Buffer.from('other').toString('base64'), h(`v1,${SIG}`), BODY, NOW)).toBe(
      false,
    );
    expect(verifySvix(SECRET, h(null), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v1,${SIG}`, null), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v1,${SIG}`, ID, null), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(`v1,${SIG}`, ID, '1614265330.5'), BODY, NOW)).toBe(false);
  });
  it('pr34 L2: refuses a svix-id over 200 chars or with odd characters, even when signed', () => {
    const sign = (id: string) => `v1,${svixSign(SECRET, id, TS, BODY)}`;
    expect(verifySvix(SECRET, h(sign('m'.repeat(200)), 'm'.repeat(200)), BODY, NOW)).toBe(true);
    expect(verifySvix(SECRET, h(sign('m'.repeat(201)), 'm'.repeat(201)), BODY, NOW)).toBe(false);
    expect(verifySvix(SECRET, h(sign('msg_1 x'), 'msg_1 x'), BODY, NOW)).toBe(false);
  });
  it('a validly signed but non-numeric timestamp never skips the replay window (NaN)', () => {
    for (const ts of ['abc', '', '1e9', ' 1614265330']) {
      expect(verifySvix(SECRET, h(`v1,${svixSign(SECRET, ID, ts, BODY)}`, ID, ts), BODY, NOW)).toBe(false);
    }
  });
  it('allows 5 minutes either way, not more (replay window)', () => {
    const ok = (skewS: number) => verifySvix(SECRET, h(`v1,${SIG}`), BODY, NOW + skewS * 1000);
    expect(ok(TOLERANCE_S)).toBe(true);
    expect(ok(-TOLERANCE_S)).toBe(true);
    expect(ok(TOLERANCE_S + 1)).toBe(false);
    expect(ok(-TOLERANCE_S - 1)).toBe(false);
  });
});

describe('Resend delivery status', () => {
  it('maps last_event', () => {
    expect(mapLastEvent('bounced')).toBe('bounced');
    expect(mapLastEvent('complained')).toBe('complained');
    for (const e of ['delivered', 'opened', 'clicked']) expect(mapLastEvent(e)).toBe('delivered');
    for (const e of ['sent', 'queued', 'delivery_delayed', undefined, 7])
      expect(mapLastEvent(e)).toBe('pending');
  });
  it('GETs /emails/{id} with the key; 404 is pending; other errors throw', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ last_event: 'bounced' }), { status: 200 }));
    const src = createResendStatusSource('re_key', f as unknown as typeof fetch);
    expect(await src.status('abc/../x', 'a@b.c')).toBe('bounced');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${RESEND_EMAILS_URL}/abc%2F..%2Fx`);
    expect(init.headers).toEqual({ Authorization: 'Bearer re_key' });
    expect(init.signal).toBeInstanceOf(AbortSignal); // pr34 M2: never an unbounded GET
    f.mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await src.status('x', 'a@b.c')).toBe('pending');
    f.mockResolvedValueOnce(new Response('', { status: 401 }));
    await expect(src.status('x', 'a@b.c')).rejects.toBeInstanceOf(MailerHttpError);
  });
});
