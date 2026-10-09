// EML-11: an admin page that refuses a signed-out visit sends it to sign-in with ?next=<the page> (from the
// header src/proxy.ts sets), and never with an unsafe one.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const h = vi.hoisted(() => ({ path: null as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(h.path === null ? {} : { 'x-twj-admin-path': h.path }),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { notAllowed } from './guard';

const ID = '11111111-1111-4111-8111-111111111111';
const signedOut = new Response(null, { status: 401 });

describe('notAllowed (EML-11)', () => {
  beforeEach(() => {
    h.path = null;
  });
  it('carries the page asked for', async () => {
    h.path = `/admin/requests/${ID}`;
    await expect(notAllowed(signedOut)).rejects.toThrow(
      `REDIRECT /admin/sign-in?next=%2Fadmin%2Frequests%2F${ID}`,
    );
  });
  it('the inbox, no header or an unsafe one: plain sign-in', async () => {
    for (const path of ['/admin', null, '//evil.example', 'https://evil.example/admin']) {
      h.path = path;
      await expect(notAllowed(signedOut)).rejects.toThrow(/^REDIRECT \/admin\/sign-in$/);
    }
  });
  it('flag off: not found', async () => {
    await expect(notAllowed(new Response(null, { status: 404 }))).rejects.toThrow('NOT_FOUND');
  });
});
