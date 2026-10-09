// EML-11: "Open the request" while signed out comes back to that request after sign-in, and only ever to a
// same-origin admin page: an outside site, a protocol-relative "//host" or a backslash trick is refused.
// Regression register: evals/bugs/admin-next-empty-segment.json
import { describe, expect, it } from 'vitest';
import { safeAdminNext, signInHref } from '@/features/admin/next-path';

const ID = '11111111-1111-4111-8111-111111111111';

describe('safeAdminNext (EML-11)', () => {
  it('keeps an admin page, with its query', () => {
    expect(safeAdminNext(`/admin/requests/${ID}`)).toBe(`/admin/requests/${ID}`);
    expect(safeAdminNext('/admin/stories?tab=new')).toBe('/admin/stories?tab=new');
    expect(safeAdminNext('/admin')).toBe('/admin');
  });

  it.each([
    'https://evil.example/admin',
    '//evil.example/admin',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/%2F%2Fevil.example',
    'javascript:alert(1)',
    'http:/admin',
    '/admin/../menu',
    '/adminx',
    '/menu',
    '/admin/sign-in',
    '/admin/sign-in?next=/admin',
    '/admin/auth/callback?token_hash=x',
    '/admin//sign-in',
    '/admin//sign-in?next=/admin',
    '/admin///auth/callback',
    '/admin//requests',
    '/admin/%2Fsign-in',
    '/admin/%2fauth/callback',
    '/admin/requests%5C..%5Csign-in',
    '/admin\n/requests',
    ' /admin',
    '',
    `/admin/${'x'.repeat(600)}`,
  ])('refuses %j', (raw) => {
    expect(safeAdminNext(raw)).toBeNull();
  });

  it('refuses a non-string (a repeated ?next=)', () => {
    expect(safeAdminNext(['/admin/stories', '//evil.example'])).toBeNull();
    expect(safeAdminNext(undefined)).toBeNull();
  });
});

describe('signInHref (EML-11)', () => {
  it('carries a safe page as ?next=, encoded; the inbox and anything unsafe carry nothing', () => {
    expect(signInHref(`/admin/requests/${ID}`)).toBe(`/admin/sign-in?next=%2Fadmin%2Frequests%2F${ID}`);
    expect(signInHref('/admin')).toBe('/admin/sign-in');
    expect(signInHref('//evil.example')).toBe('/admin/sign-in');
    expect(signInHref(null)).toBe('/admin/sign-in');
  });

  it('keeps the code step next to it', () => {
    expect(signInHref('/admin/stories', { step: 'code' })).toBe(
      '/admin/sign-in?step=code&next=%2Fadmin%2Fstories',
    );
    expect(signInHref('https://evil.example', { step: 'code' })).toBe('/admin/sign-in?step=code');
  });
});
