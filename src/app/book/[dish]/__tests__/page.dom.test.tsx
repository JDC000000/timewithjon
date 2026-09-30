// pr76 F1: the invite gate on /book/[dish] (T1.5.U1). The REAL getInviteSession runs (cookie signature + invite
// lookup); only the cookie jar, the invite row, the env secret and the availability loader are stubbed. Without a
// valid invite the page never loads availability and no time (aria-pressed tile, slot id) reaches the HTML.
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS, FLOW } from '@/content';
import { OLD_HAUNT, PITCH, SURPRISE } from '@/content/ui/booking';
import type { EngineOutput } from '@/features/availability/types';
import type { Invite } from '@/features/invites/repo';
import { signCookie } from '@/features/invites/tokens';

const h = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  invite: null as Invite | null,
  engine: null as EngineOutput | null,
  load: vi.fn(),
  SECRET: 'test-session-secret-000000000000000000000',
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (h.cookies.has(n) ? { name: n, value: h.cookies.get(n) } : undefined),
  }),
}));
vi.mock('@/config/env', () => ({ getEnv: () => ({ SESSION_SIGNING_SECRET: h.SECRET }) }));
vi.mock('@/features/invites/repo', () => ({
  findInviteById: async (id: string) => (h.invite?.id === id ? h.invite : null),
}));
vi.mock('../_lib/load', () => ({
  loadDishAvailability: (...a: unknown[]) => {
    h.load(...a);
    return Promise.resolve({ engine: h.engine, season: { start: '2027-04-01', end: '2027-06-30' } });
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
const { default: BookPage, generateMetadata } = await import('../page');

const INVITE: Invite = {
  id: '6f2c1a52-0000-4000-8000-000000000001',
  kind: 'general',
  is_test: true,
  name_slug: 'friends',
  display_name: null,
  our_things: [],
  picked_dish: null,
  prefill_name: null,
  prefill_email: null,
  revoked_at: null,
};
const SLOT = 'slot-2027-04-22-lunch';
const OPEN: EngineOutput = {
  weeks: [
    {
      weekStart: '2027-04-19',
      state: 'open',
      windows: [{ slotId: SLOT, date: '2027-04-22', window: 'lunch', label: '' }],
    },
  ],
  unavailableDates: [],
};
const html = async (dish = 'the-long-lunch', search: Record<string, string | string[]> = {}) =>
  renderToString(
    await BookPage({ params: Promise.resolve({ dish }), searchParams: Promise.resolve(search) }),
  );
const title = async (dish: string, search: Record<string, string> = {}) =>
  (await generateMetadata({ params: Promise.resolve({ dish }), searchParams: Promise.resolve(search) }))
    .title as { absolute: string } | undefined;
const text = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");

beforeEach(() => {
  h.cookies.clear();
  h.invite = INVITE;
  h.engine = OPEN;
  h.load.mockClear();
});

describe('/book/[dish] invite gate (pr76 F1)', () => {
  it('no invite cookie: the no-invite line only, availability never loaded', async () => {
    const out = await html();
    expect(h.load).not.toHaveBeenCalled();
    expect(text(out)).toContain(ERRORS.noInvite);
    expect(out).not.toContain('aria-pressed');
    expect(out).not.toContain(SLOT);
  });

  it('a forged cookie (bad signature) counts as no invite', async () => {
    h.cookies.set('twj_invite', `${INVITE.id}.9999999999.forged-mac`);
    const out = await html();
    expect(h.load).not.toHaveBeenCalled();
    expect(text(out)).toContain(ERRORS.noInvite);
    expect(out).not.toContain('aria-pressed');
  });

  it('a stale link (revoked invite, or the stale marker): the stale line only', async () => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
    h.invite = { ...INVITE, revoked_at: new Date('2026-09-01T00:00:00Z') };
    const revoked = await html();
    h.cookies.clear();
    h.cookies.set('twj_stale', '1');
    const marker = await html();
    expect(h.load).not.toHaveBeenCalled();
    for (const out of [revoked, marker]) {
      expect(text(out)).toContain(ERRORS.stale);
      expect(out).not.toContain('aria-pressed');
      expect(out).not.toContain(SLOT);
    }
  });

  it('an unknown or unbookable dish is a 404 before any lookup', async () => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
    await expect(html('nope')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(h.load).not.toHaveBeenCalled();
  });

  it('a valid invite: loads once with the invite kind and renders the tiles', async () => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
    const out = await html();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.load.mock.calls[0]?.[1]).toBe('general');
    expect(out).toContain('aria-pressed="false"');
  });

  it('before release: only the opens line, no tiles', async () => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
    h.engine = { ...OPEN, opensAt: '2099-03-01T08:00:00.000Z' };
    const out = await html();
    expect(out).not.toContain('aria-pressed');
    expect(out).not.toContain(SLOT);
    expect(text(out)).toMatch(/Booking opens/);
  });

  it('nothing left to pick (no months): the spoken-for run line only (pr76 F4)', async () => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
    h.engine = { weeks: [], unavailableDates: [] };
    const out = await html();
    expect(out).not.toContain('role="tablist"');
    expect(text(out)).toContain(FLOW.spokenForRun);
  });
});

describe('/book/[dish] routes each flow (T1.6)', () => {
  beforeEach(() => {
    h.cookies.set('twj_invite', signCookie('invite', INVITE.id, 3600, h.SECRET));
  });

  it('a dates dish: the S7 month grid, no time tiles', async () => {
    const out = await html('the-shore-ride');
    expect(text(out)).toContain(FLOW.datesTitle);
    expect(out).toContain('class="cal"');
    expect(out).toContain('aria-label="8, Saturday May 8"');
    expect(out).not.toContain('role="tablist"');
    expect((await title('the-shore-ride'))?.absolute).toBe('Pick dates · The Shore Ride · Time with Jon');
  });

  it('the Long Distance asks for a time zone; other dates dishes do not', async () => {
    expect(await html('the-long-distance')).toContain('id="f-tz"');
    expect(await html('the-encore')).not.toContain('id="f-tz"');
  });

  it('Surprise Me: the picker plus the plan, its own heading and title', async () => {
    const out = await html('surprise-me');
    expect(text(out)).toContain(SURPRISE.heading);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('id="f-need"');
    expect((await title('surprise-me'))?.absolute).toBe(SURPRISE.pageTitle);
  });

  it('Pitch Me: the idea and when, no grid and no tiles', async () => {
    const out = await html('pitch-me');
    expect(text(out)).toContain(PITCH.heading);
    expect(out).toContain('id="f-idea"');
    expect(out).not.toContain('class="cal"');
    expect(out).not.toContain('role="tablist"');
    expect((await title('pitch-me'))?.absolute).toBe(PITCH.pageTitle);
  });

  it('the Old Haunt: Thu/Fri times with the weekend link; ?when=weekend is the weekend grid with the way back', async () => {
    const times = await html('the-old-haunt');
    expect(times).toContain('role="tablist"');
    expect(times).toContain('href="/book/the-old-haunt?when=weekend"');
    expect(text(times)).toContain(OLD_HAUNT.toWeekend);
    const weekend = await html('the-old-haunt', { when: 'weekend' });
    expect(weekend).toContain('class="cal"');
    expect(weekend).toContain('aria-label="6, Thursday May 6, weekends only"');
    expect(text(weekend)).toContain(OLD_HAUNT.toTimes);
    expect(weekend).toContain('href="/book/the-old-haunt"');
    expect((await title('the-old-haunt', { when: 'weekend' }))?.absolute).toBe(
      'Pick dates · The Old Haunt · Time with Jon',
    );
    expect((await title('the-old-haunt'))?.absolute).toBe('When works? · The Old Haunt · Time with Jon');
  });

  it('pr80-review F3: only ?when=weekend opens the grid; anything else is the Thu/Fri times', async () => {
    for (const when of ['junk', '', ['weekend', 'x']]) {
      const out = await html('the-old-haunt', { when });
      expect(out).toContain('role="tablist"');
      expect(out).not.toContain('class="cal"');
    }
  });

  it('the Old Haunt with no Thu/Fri times left: the weekend grid, no way back to nothing', async () => {
    h.engine = { weeks: [], unavailableDates: [] };
    const out = await html('the-old-haunt');
    expect(out).toContain('class="cal"');
    expect(text(out)).not.toContain(OLD_HAUNT.toTimes);
  });

  it('?when=weekend means nothing to other dishes', async () => {
    const out = await html('the-long-lunch', { when: 'weekend' });
    expect(out).toContain('role="tablist"');
    expect(out).not.toContain('class="cal"');
    expect((await title('the-long-lunch', { when: 'weekend' }))?.absolute).toBe(
      'When works? · The Long Lunch · Time with Jon',
    );
  });
});
