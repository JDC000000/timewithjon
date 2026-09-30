// T2.5.U1 (+ T2.5.05 line): the A4b week pane under user-event (real event sequences; never element.focus()).
// One Open/Blocked choice per date (ruling Q1); a block over a locked booking asks in place (ruling Q3); FOC-04:
// arrival lands on the title, Keep it open / Block and tell land back on the date's choice.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { WeekEditor } from '../WeekEditor';
import type { WeekDetail } from '../week-model';
import { mockFetch, whole } from './fetch-mock';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const WEEK: WeekDetail = {
  weekStart: '2027-04-12',
  weekEnd: '2027-04-18',
  label: 'Apr 12',
  count: '1 of 2',
  heading: 'Apr 15–16',
  dates: [
    {
      date: '2027-04-15',
      label: 'Thu Apr 15',
      state: 'open',
      editable: true,
      blockId: null,
      windows: [
        { key: 's1', time: 'noon–2 pm', note: 'Open', booking: null },
        { key: 's2', time: '7 pm', note: 'Locked · Robin', booking: { id: 'r-robin', name: 'Robin' } },
      ],
    },
    {
      date: '2027-04-16',
      label: 'Fri Apr 16',
      state: 'blocked',
      editable: true,
      blockId: 'b-fri',
      windows: [
        { key: 's3', time: 'noon–2 pm', note: 'Blocked by you', booking: null },
        { key: 's4', time: '7 pm', note: 'Blocked by you', booking: null },
      ],
    },
  ],
  wholeWeek: { blocked: false, blockId: null, editable: true },
  allowThird: false,
  standby: [
    {
      id: 'r-chris',
      name: 'Chris',
      who: 'Chris · The Flat White',
      since: 'Mon Mar 1',
      offer: { slotId: 'slot-thu', label: 'Thu noon–2 pm' },
    },
  ],
};
const ROBIN = {
  id: 'r-robin',
  contactName: 'Robin',
  startsAt: '2027-04-16T02:00:00Z',
  endsAt: '2027-04-16T05:00:00Z',
};
const UNDER = {
  id: 'r-lee',
  contactName: 'Lee',
  startsAt: '2027-04-15T19:00:00Z',
  endsAt: '2027-04-15T21:00:00Z',
};

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  router.refresh.mockClear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
});

const thu = () => screen.getByRole('radiogroup', { name: 'Thu Apr 15' });
const fri = () => screen.getByRole('radiogroup', { name: 'Fri Apr 16' });

describe('WeekEditor', () => {
  it('lands on the week title and remembers the week for the list (FOC-04)', () => {
    mockFetch({});
    render(<WeekEditor week={WEEK} back={null} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Apr 15–16' }));
    expect(screen.getByText(whole('Week of Apr 12 · 1 of 2'))).toBeTruthy();
    expect(sessionStorage.getItem('twj-season-week')).toBe('2027-04-12');
  });

  it('shows each date once with its windows, and the locked booking with its link', () => {
    mockFetch({});
    render(<WeekEditor week={WEEK} back={null} />);
    expect(within(thu()).getByRole('radio', { name: 'Open' })).toHaveProperty('checked', true);
    expect(within(fri()).getByRole('radio', { name: 'Blocked' })).toHaveProperty('checked', true);
    expect(screen.getByText(whole('noon–2 pm · Open'))).toBeTruthy();
    expect(screen.getAllByText(whole('noon–2 pm · Blocked by you'))).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Open\s*Robin’s booking$/ }).getAttribute('href')).toBe(
      '/admin/requests/r-robin',
    );
  });

  it('blocks a date with nothing locked straight away', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [], underWay: [] } },
      'POST /api/admin/season/blocks': { status: 201, json: { ok: true, id: 'b1', underWay: [] } },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST']);
    expect(calls[0]!.url).toBe('/api/admin/season/blocks/preview?startDate=2027-04-15&endDate=2027-04-15');
    expect(calls[1]!.body).toEqual({
      confirmBy: null,
      startDate: '2027-04-15',
      endDate: '2027-04-15',
      kind: 'blocked',
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(within(thu()).getByRole('radio', { name: 'Blocked' })).toHaveProperty('checked', true);
    expect(screen.getAllByText(whole('noon–2 pm · Blocked by you'))).toHaveLength(2);
  });

  it('a block over a locked booking asks first; Keep it open changes nothing and lands on Open', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [ROBIN], underWay: [UNDER] } },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    const ask = screen.getByRole('group', { name: 'Block anyway?' });
    expect(document.activeElement).toBe(within(ask).getByRole('heading', { name: 'Block anyway?' }));
    expect(ask.textContent).toContain(
      'Thu Apr 15 · 7 pm is locked for Robin. I’ll send them “Something came up that week” and some new times soon.',
    );
    expect(ask.textContent).toContain('1 booking is under way and will finish as planned.');
    await user.click(within(ask).getByRole('button', { name: 'Keep it open' }));
    expect(screen.queryByRole('group', { name: 'Block anyway?' })).toBeNull();
    const open = within(thu()).getByRole('radio', { name: 'Open' });
    expect(open).toHaveProperty('checked', true);
    expect(document.activeElement).toBe(open);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('Block and tell Robin confirms with no offered times and lands on Blocked', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [ROBIN], underWay: [] } },
      'POST /api/admin/season/blocks/confirm': {
        status: 201,
        json: { ok: true, id: 'b2', moved: [], underWay: [] },
      },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    await user.click(screen.getByRole('button', { name: 'Block and tell Robin' }));
    expect(calls[1]!.body).toEqual({
      block: { confirmBy: null, startDate: '2027-04-15', endDate: '2027-04-15', kind: 'blocked' },
      bookings: [{ requestId: 'r-robin' }],
    });
    expect(document.activeElement).toBe(within(thu()).getByRole('radio', { name: 'Blocked' }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it('the bookings changed since the preview: asks again with the new list', async () => {
    const SAM = { ...ROBIN, id: 'r-sam', contactName: 'Sam' };
    mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [ROBIN], underWay: [] } },
      'POST /api/admin/season/blocks/confirm': {
        status: 409,
        json: { ok: false, code: 'locked_bookings', affected: [ROBIN, SAM], underWay: [] },
      },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    await user.click(screen.getByRole('button', { name: 'Block and tell Robin' }));
    expect(screen.getByRole('button', { name: 'Block and tell them' })).toBeTruthy();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('pr78 F4: a confirm that finds them already moved (409, none left) is done: no empty ask', async () => {
    mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [ROBIN], underWay: [] } },
      'POST /api/admin/season/blocks/confirm': {
        status: 409,
        json: { ok: false, code: 'locked_bookings', affected: [], underWay: [] },
      },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    await user.click(screen.getByRole('button', { name: 'Block and tell Robin' }));
    expect(screen.queryByRole('group', { name: 'Block anyway?' })).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
    expect(document.activeElement).toBe(within(thu()).getByRole('radio', { name: 'Blocked' }));
  });

  it('pr78 F5: a double-click on Block and tell sends ONE confirm', async () => {
    let answer: (v: Response) => void = () => {};
    const posts: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return new Response(JSON.stringify({ ok: true, affected: [ROBIN], underWay: [] }));
        }
        posts.push(url);
        return new Promise<Response>((r) => (answer = r));
      }),
    );
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    await user.dblClick(screen.getByRole('button', { name: 'Block and tell Robin' }));
    answer(new Response(JSON.stringify({ ok: true, id: 'b2', moved: [], underWay: [] }), { status: 201 }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(posts).toEqual(['/api/admin/season/blocks/confirm']);
  });

  it('a failed block puts the date back and says so', async () => {
    mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [], underWay: [] } },
      'POST /api/admin/season/blocks': { status: 500, json: { ok: false } },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    expect(within(thu()).getByRole('radio', { name: 'Open' })).toHaveProperty('checked', true);
    expect(
      screen.getByText(whole('Something went sideways on my end. Try once more, or text me.')),
    ).toBeTruthy();
  });

  it('T2.5.05: a block that leaves a booking under way says so under the date', async () => {
    mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [], underWay: [UNDER] } },
      'POST /api/admin/season/blocks': { status: 201, json: { ok: true, id: 'b1', underWay: [UNDER] } },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(thu()).getByRole('radio', { name: 'Blocked' }));
    expect(screen.getByText(whole('1 booking is under way and will finish as planned.'))).toBeTruthy();
  });

  it('Open on a blocked date removes its block; the keyboard works the same', async () => {
    const calls = mockFetch({ 'DELETE /api/admin/season/blocks/b-fri': { json: { ok: true } } });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(within(fri()).getByRole('radio', { name: 'Open' }));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['DELETE /api/admin/season/blocks/b-fri']);
    expect(screen.getAllByText(whole('noon–2 pm · Open'))).toHaveLength(2);
  });

  it('the whole week, a 3rd this week and a stand-by offer call their routes', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': { json: { ok: true, affected: [], underWay: [] } },
      'POST /api/admin/season/blocks': { status: 201, json: { ok: true, id: 'bw', underWay: [] } },
      'PATCH /api/admin/season/weeks/2027-04-12': { json: { ok: true } },
      'POST /api/admin/requests/r-chris/standby-offer': { json: { ok: true } },
    });
    const user = userEvent.setup();
    render(<WeekEditor week={WEEK} back={null} />);
    await user.click(screen.getByRole('checkbox', { name: 'Block the whole week' }));
    await user.click(screen.getByRole('checkbox', { name: 'Allow a 3rd this week' }));
    await user.click(
      screen.getByRole(
        'button',
        { name: /^Offer Thu noon–2 pm\s*to Chris$/ } /* jsdom drops the space before a .vh span */,
      ),
    );
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['GET', '/api/admin/season/blocks/preview?startDate=2027-04-12&endDate=2027-04-18', undefined],
      [
        'POST',
        '/api/admin/season/blocks',
        { confirmBy: null, startDate: '2027-04-12', endDate: '2027-04-18', kind: 'blocked' },
      ],
      ['PATCH', '/api/admin/season/weeks/2027-04-12', { capOverride: 3 }],
      ['POST', '/api/admin/requests/r-chris/standby-offer', { slotId: 'slot-thu' }],
    ]);
  });
});
