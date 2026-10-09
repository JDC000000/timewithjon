// M1: next= accepts only same-origin relative paths.
import { describe, expect, it } from 'vitest';
import {
  BODY_TOO_LARGE,
  clientIpFrom,
  LOCAL_IP_BUCKET,
  MAX_JSON_BYTES,
  readBytesAtMost,
  readJson,
  safeRedirectTarget,
} from '@/lib/http';
import { RequestBody } from '@/features/requests/schema';

const SITE = 'https://timewithjon.com';
const target = (next: string | null) => safeRedirectTarget(next, SITE).href;

describe('safeRedirectTarget', () => {
  it('keeps same-origin paths with their query', () => {
    expect(target('/menu?utm=x')).toBe('https://timewithjon.com/menu?utm=x');
  });
  it.each([
    ['backslash host', '/\\evil.example'],
    ['protocol-relative', '//evil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['scheme', 'javascript:alert(1)'],
    ['tab trick', '/\t/evil.example'],
    ['newline', '/\nevil'],
    ['empty', ''],
    ['missing', null],
  ])('sends %s to the home page', (_label, next) => {
    expect(target(next)).toBe('https://timewithjon.com/');
  });
});

describe('clientIpFrom (T4.2.01a M2)', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('off Vercel ignores every client-set IP header', () => {
    expect(clientIpFrom(h({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }), false)).toBe(
      LOCAL_IP_BUCKET,
    );
  });
  it('on Vercel uses the platform-set x-vercel-forwarded-for, else the rightmost x-forwarded-for hop', () => {
    expect(clientIpFrom(h({ 'x-vercel-forwarded-for': '203.0.113.5', 'x-real-ip': '1.2.3.4' }), true)).toBe(
      '203.0.113.5',
    );
    expect(clientIpFrom(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }), true)).toBe('203.0.113.9');
  });
  it('on Vercel never reads x-real-ip, and refuses a non-IP value', () => {
    expect(clientIpFrom(h({ 'x-real-ip': '1.2.3.4' }), true)).toBe('unknown');
    expect(clientIpFrom(h({ 'x-forwarded-for': 'evil, not-an-ip' }), true)).toBe('unknown');
  });
});

describe('clientIpFrom: IPv6 keys on the /64 (review L12)', () => {
  const key = (ip: string) => clientIpFrom(new Headers({ 'x-vercel-forwarded-for': ip }), true);
  it('two addresses in one /64 share a key, in any spelling', () => {
    expect(key('2001:db8:0:1::1')).toBe('2001:db8:0:1::/64');
    expect(key('2001:0DB8:0000:0001:ffff:ffff:ffff:ffff')).toBe('2001:db8:0:1::/64');
    expect(key('2001:db8:0:1:a:b:1.2.3.4')).toBe('2001:db8:0:1::/64');
    expect(key('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });
  it('the next /64 is a different key, and :: expands correctly', () => {
    expect(key('2001:db8:0:2::1')).toBe('2001:db8:0:2::/64');
    expect(key('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(key('::1')).toBe('0:0:0:0::/64');
    expect(key('1:2:3:4:5::')).toBe('1:2:3:4::/64');
  });
  it('an IPv4-mapped address keys as its IPv4, in every spelling (review L4)', () => {
    for (const mapped of [
      '::ffff:203.0.113.5',
      '::FFFF:cb00:7105',
      '0:0:0:0:0:ffff:203.0.113.5',
      '0000:0000:0000:0000:0000:ffff:cb00:7105',
    ]) {
      expect(key(mapped), mapped).toBe('203.0.113.5');
    }
    expect(key('::ffff:0:1')).toBe('0.0.0.1');
    // Not mapped: the ::ffff prefix elsewhere, or the IPv4-compatible (deprecated) form, stay IPv6 /64 keys.
    expect(key('1::ffff:cb00:7105')).toBe('1:0:0:0::/64');
    expect(key('::cb00:7105')).toBe('0:0:0:0::/64');
  });
});

describe('readJson / readBytesAtMost (a bounded body)', () => {
  const post = (body: BodyInit, headers: Record<string, string> = {}) =>
    new Request('https://timewithjon.com/api/x', {
      method: 'POST',
      body,
      headers,
      duplex: 'half',
    } as RequestInit);
  /** A body streamed in chunks with no Content-Length (as a chunked upload arrives). */
  const chunked = (bytes: number, chunk = 8192) => {
    let sent = 0;
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        if (sent >= bytes) return c.close();
        const n = Math.min(chunk, bytes - sent);
        sent += n;
        c.enqueue(new Uint8Array(n).fill(0x20));
      },
    });
    return { req: post(stream), pulls: () => pulls };
  };

  it('the largest real request (every field at its limit, 3-byte characters) is read and parses', async () => {
    const wide = (n: number) => '漢'.repeat(n); // 3 bytes each in UTF-8
    const body = {
      clientKey: '00000000-0000-4000-8000-000000000000',
      dish: 'the-long-lunch',
      name: wide(80),
      email: `${'a'.repeat(240)}@example.com`,
      phone: '1'.repeat(30),
      crew: 99,
      note: wide(1000),
      slotIds: Array.from({ length: 52 }, (_, i) => `${i}`.padStart(64, '0')),
      dates: ['2027-05-08', '2027-05-09'],
      windowText: wide(200),
      overnight: true,
      overnightNight: wide(60),
      guestTimeZone: 'America/Argentina/ComodRivadavia',
      pitchIdea: wide(2000),
      surpriseNeedToKnow: wide(2000),
      surprisePlan: wide(2000),
      hp: '',
      turnstileToken: 'x'.repeat(4096),
    };
    const text = JSON.stringify(body);
    expect(Buffer.byteLength(text)).toBeLessThan(MAX_JSON_BYTES);
    const read = await readJson(post(text, { 'content-type': 'application/json' }));
    expect(RequestBody.safeParse(read).success).toBe(true);
  });

  it('a declared body over the limit is refused before any read', async () => {
    const big = 'x'.repeat(100 * 1024);
    expect(await readJson(post(JSON.stringify({ note: big })))).toBe(BODY_TOO_LARGE);
  });

  it('a chunked body with no Content-Length is read only up to the limit, never whole', async () => {
    const { req, pulls } = chunked(4 * 1024 * 1024);
    expect(await readBytesAtMost(req, MAX_JSON_BYTES)).toBeNull();
    expect(pulls()).toBeLessThan(20); // stopped after ~64 KB, not 4 MB / 8 KB = 512 chunks
  });

  it('not JSON reads as null (the route’s schema refuses it), an empty body as null', async () => {
    expect(await readJson(post('{nope'))).toBeNull();
    expect(await readJson(post(''))).toBeNull();
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });
});
