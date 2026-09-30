// tests/unit/ui/admin-shell.dom.test.tsx (U1): src/app/admin/(app)/layout.tsx. Flag off -> 404; not an admin ->
// /admin/sign-in; an admin -> the pack a2 shell with main#main, both navs and the Needs a reply badge.
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  off: null as null | Response,
  admin: { email: 'jon@example.com' } as { email: string } | Response,
  cards: [{}, {}, {}] as unknown[],
  listThrows: false,
  listed: 0,
  banner: null as null | { problem: string },
  bannerThrows: false,
  bannerRead: 0,
  configured: true,
}));
// T3.3.U1 (lane U6): the shell's Google banner; like the badge, never read before the checks pass.
vi.mock('@/features/calendar/alerts', () => ({
  googleBanner: async () => {
    m.bannerRead++;
    if (m.bannerThrows) throw new Error('db down');
    return m.banner;
  },
}));
vi.mock('@/lib/adapters/google/oauth', () => ({ googleConfigured: () => m.configured }));
vi.mock('@/features/admin/auth', () => ({
  adminFeatureOff: () => m.off,
  requireAdmin: async () => m.admin,
}));
vi.mock('@/features/admin/inbox', () => ({
  listRequests: async () => {
    m.listed++;
    if (m.listThrows) throw new Error('db down');
    return { cards: m.cards, truncated: false };
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/season',
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { default: AdminShell } = await import('@/app/admin/(app)/layout');

beforeEach(() => {
  m.listed = 0;
  m.bannerRead = 0;
});

afterEach(() => {
  cleanup();
  m.off = null;
  m.admin = { email: 'jon@example.com' };
  m.listThrows = false;
  m.banner = null;
  m.bannerThrows = false;
  m.configured = true;
});

describe('AdminShell', () => {
  it('flag off: 404', async () => {
    m.off = NextResponse.json({}, { status: 404 });
    await expect(AdminShell({ children: null })).rejects.toThrow('NOT_FOUND');
    expect(m.listed).toBe(0); // the badge query never runs before the checks (pr73-review F1)
    expect(m.bannerRead).toBe(0); // nor the Google banner's (T3.3.U1)
  });

  it('not signed in / not on the allowlist: to the sign-in page', async () => {
    m.admin = NextResponse.json({}, { status: 401 });
    await expect(AdminShell({ children: null })).rejects.toThrow('REDIRECT /admin/sign-in');
    expect(m.listed).toBe(0);
    expect(m.bannerRead).toBe(0);
  });

  it('an admin: the shell, main#main around the page, the badge, the current section', async () => {
    render(await AdminShell({ children: <p>Page body</p> }));
    expect(m.listed).toBe(1);
    const main = screen.getByRole('main');
    expect(main.id).toBe('main');
    expect(within(main).getByText('Page body')).toBeTruthy();
    const navs = screen.getAllByRole('navigation', { name: 'Admin' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getByRole('link', { name: /^Requests\s?3\s?need a reply$/ })).toBeTruthy();
      expect(within(nav).getByRole('link', { name: 'Season' }).getAttribute('aria-current')).toBe('page');
    }
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/admin/settings');
    expect(navs[0]!.textContent).toContain('Signed in as jon@example.com');
  });

  it('the count cannot be read: the shell still renders, no badge', async () => {
    m.listThrows = true;
    render(await AdminShell({ children: null }));
    expect(screen.getAllByRole('link', { name: 'Requests' })).toHaveLength(2);
  });

  describe('the Google banner (T3.3.U1, wireframe 09 A7d)', () => {
    it('Google fine (or never connected): read once, no banner', async () => {
      render(await AdminShell({ children: null }));
      expect(m.bannerRead).toBe(1);
      expect(screen.queryByRole('note')).toBeNull();
    });
    it('Google needs Jon: the banner above the page, with Connect Google', async () => {
      m.banner = { problem: 'not_connected' };
      render(await AdminShell({ children: <p>Page body</p> }));
      const note = within(screen.getByRole('main')).getByRole('note');
      expect(note.textContent).toContain('Google isn’t connected. Locks will send .ics until you reconnect.');
      expect(within(note).getByRole('link', { name: 'Connect Google' }).getAttribute('href')).toBe(
        '/api/admin/google/connect',
      );
    });
    it('no OAuth client: the banner without the link; unreadable: no banner, the shell still renders', async () => {
      m.banner = { problem: 'broken' };
      m.configured = false;
      render(await AdminShell({ children: null }));
      expect(within(screen.getByRole('note')).queryByRole('link')).toBeNull();
      cleanup();
      m.bannerThrows = true;
      render(await AdminShell({ children: <p>Page body</p> }));
      expect(screen.queryByRole('note')).toBeNull();
      expect(screen.getByText('Page body')).toBeTruthy();
    });
  });
});
