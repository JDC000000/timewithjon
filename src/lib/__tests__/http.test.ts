// M1: next= accepts only same-origin relative paths.
import { describe, expect, it } from 'vitest';
import { clientIpFrom, LOCAL_IP_BUCKET, safeRedirectTarget } from '@/lib/http';

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
