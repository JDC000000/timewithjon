// T2.5.U1: the A4c away pane under user-event. Pack a4c words and form pattern (inline errors + "Things to fix");
// ruling Q2 (confirm by = Back on + 2 days, shown in "What guests see"); FOC-04: arrival lands on the title, a
// failed submit on the summary, a summary link on its field.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SeasonBlock } from '@/features/admin/season-view';
import { installFocusGuard } from '@/ui/focus';
import { AwayForm } from '../AwayForm';
import { mockFetch, whole } from './fetch-mock';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const AWAY: SeasonBlock = {
  id: 'a-1',
  startDate: '2027-04-24',
  endDate: '2027-05-03',
  kind: 'away',
  confirmBy: '2027-05-05',
  note: null,
};
const SAM = {
  id: 'r-sam',
  contactName: 'Sam',
  startsAt: '2027-05-13T19:00:00Z',
  endsAt: '2027-05-13T21:00:00Z',
};
const preview = (affected: unknown[] = []) => ({ json: { ok: true, affected, underWay: [] } });

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  router.push.mockClear();
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
});

const from = () => screen.getByLabelText('From') as HTMLInputElement;
const to = () => screen.getByLabelText('Back on') as HTMLInputElement;

describe('AwayForm', () => {
  it('lands on the title; an empty form lists two things to fix and lands on the summary', async () => {
    const calls = mockFetch({});
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Away mode' }));
    expect(screen.queryByRole('button', { name: 'Turn away mode off' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    const sum = screen.getByRole('heading', { name: 'Two things to fix' }).parentElement!;
    expect(document.activeElement).toBe(sum);
    expect(from().getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('aw-from-e')!.textContent).toBe('Add a date.');
    await user.click(screen.getByRole('link', { name: 'Add the day you’re back.' }));
    expect(document.activeElement).toBe(to());
    await user.type(from(), '2027-04-24');
    expect(from().getAttribute('aria-invalid')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('Back on before From: one thing to fix, the pack words', async () => {
    mockFetch({});
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await user.type(from(), '2027-04-24');
    await user.type(to(), '2027-04-20');
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    expect(screen.getByRole('heading', { name: 'One thing to fix' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back on has to be after From.' })).toBeTruthy();
  });

  it('shows what guests see (confirm by Back on + 2 days) and saves a new range', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview([SAM]),
      'POST /api/admin/season/blocks': {
        status: 409,
        json: { ok: false, code: 'locked_bookings', affected: [SAM], underWay: [] },
      },
      'POST /api/admin/season/blocks/confirm': { status: 201, json: { ok: true, id: 'a-2', underWay: [] } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await user.type(from(), '2027-05-10');
    await user.type(to(), '2027-05-14');
    expect(screen.getByText(whole('I’m away until May 14. I’ll confirm by May 16.'))).toBeTruthy();
    expect(screen.getByText(whole('Hides every time from Mon May 10 to Fri May 14.'))).toBeTruthy();
    await screen.findByText(whole('1 locked booking in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/season?saved=away'));
    const range = { startDate: '2027-05-10', endDate: '2027-05-14', kind: 'away', confirmBy: '2027-05-16' };
    expect(calls.filter((c) => c.method !== 'GET').map((c) => [c.url, c.body])).toEqual([
      ['/api/admin/season/blocks', range],
      ['/api/admin/season/blocks/confirm', { block: range, bookings: [{ requestId: 'r-sam' }] }],
    ]);
  });

  it('a changed range replaces the old one; an unchanged one saves nothing', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview(),
      'POST /api/admin/season/blocks': { status: 201, json: { ok: true, id: 'a-2', underWay: [] } },
      'DELETE /api/admin/season/blocks/a-1': { json: { ok: true } },
    });
    const user = userEvent.setup();
    const { unmount } = render(<AwayForm away={AWAY} lockedNow={null} back={null} />);
    expect(from().value).toBe('2027-04-24');
    expect(screen.getByText(whole('I’m away until May 3. I’ll confirm by May 5.'))).toBeTruthy();
    await screen.findByText(whole('No locked bookings in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
    unmount();

    render(<AwayForm away={AWAY} lockedNow={null} back={null} />);
    await user.clear(to());
    await user.type(to(), '2027-05-04');
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(2));
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/admin/season/blocks',
      'DELETE /api/admin/season/blocks/a-1',
    ]);
  });

  it('INT-06: the locked line is there from the first paint and keeps its place while a new count loads', async () => {
    let answer: (v: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (answer = r))),
    );
    const user = userEvent.setup();
    render(<AwayForm away={AWAY} lockedNow={2} back={null} />);
    const line = screen.getByText(whole('2 locked bookings in that range.'));
    expect(line.style.visibility).toBe('');
    await user.clear(to());
    await user.type(to(), '2027-05-04');
    // (clearing the date hid the summary; the new range brings it back with the line held in place)
    const held = screen.getByText(whole('2 locked bookings in that range.'));
    expect(held.style.visibility).toBe('hidden');
    expect(held.getAttribute('aria-hidden')).toBe('true');
    answer(new Response(JSON.stringify({ ok: true, affected: [], underWay: [] })));
    await screen.findByText(whole('No locked bookings in that range.'));
    expect(screen.getByText(whole('No locked bookings in that range.')).style.visibility).toBe('');
  });

  const ROBIN = { ...SAM, id: 'r-robin', contactName: 'Robin' };
  const lock409 = (affected: unknown[]) => ({
    status: 409,
    json: { ok: false, code: 'locked_bookings', affected, underWay: [] },
  });
  const posts = (calls: { method: string; url: string }[]) =>
    calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`);
  async function typeRange(user: ReturnType<typeof userEvent.setup>) {
    await user.type(from(), '2027-05-10');
    await user.type(to(), '2027-05-14');
  }

  it('pr78 F1: the count could not be read → a 409 asks in place, moves no one until Block and tell', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': { status: 500, json: { ok: false } },
      'POST /api/admin/season/blocks': lock409([SAM]),
      'POST /api/admin/season/blocks/confirm': { status: 201, json: { ok: true, id: 'a-2', underWay: [] } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    const ask = await screen.findByRole('group', { name: 'Block anyway?' });
    expect(document.activeElement).toBe(within(ask).getByRole('heading', { name: 'Block anyway?' }));
    expect(ask.textContent).toContain('Thu May 13 is locked for Sam.');
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks']);
    expect(router.push).not.toHaveBeenCalled();
    await user.click(within(ask).getByRole('button', { name: 'Block and tell Sam' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/season?saved=away'));
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks', 'POST /api/admin/season/blocks/confirm']);
  });

  it('pr78 F1: the count Jon read (1) is not the 409 list (2) → asks with both names', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview([SAM]),
      'POST /api/admin/season/blocks': lock409([SAM, ROBIN]),
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await screen.findByText(whole('1 locked booking in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await screen.findByRole('button', { name: 'Block and tell them' });
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks']);
  });

  it('pr78 F1: same count, another booking (one moved, one locked since) → asks; Keep it open lands on Save', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview([SAM]),
      'POST /api/admin/season/blocks': lock409([ROBIN]),
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await screen.findByText(whole('1 locked booking in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it open' }));
    expect(screen.queryByRole('group', { name: 'Block anyway?' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save away mode' }));
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks']);
  });

  it('pr78 F1: a count read for the OLD range never confirms the new one (its count failed)', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': (c) =>
        c.url.includes('endDate=2027-05-14') ? preview([SAM]) : { status: 500, json: { ok: false } },
      'POST /api/admin/season/blocks': lock409([SAM]),
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await screen.findByText(whole('1 locked booking in that range.'));
    await user.clear(to());
    await user.type(to(), '2027-05-15');
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await screen.findByRole('button', { name: 'Block and tell Sam' });
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks']);
  });

  it('pr78 F1: a confirm that finds the list changed again asks again (never confirms on its own)', async () => {
    let n = 0;
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview([SAM]),
      'POST /api/admin/season/blocks': lock409([SAM, ROBIN]),
      'POST /api/admin/season/blocks/confirm': () =>
        ++n === 1 ? lock409([SAM]) : { status: 201, json: { ok: true, id: 'a-2', underWay: [] } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await screen.findByText(whole('1 locked booking in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await user.click(await screen.findByRole('button', { name: 'Block and tell them' }));
    await screen.findByRole('button', { name: 'Block and tell Sam' });
    expect(posts(calls)).toEqual(['POST /api/admin/season/blocks', 'POST /api/admin/season/blocks/confirm']);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('pr78 F1: Save is off while a new range’s count loads, then on', async () => {
    let answer: (v: Response) => void = () => {};
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        sent.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
        return new Promise<Response>((r) => (answer = r));
      }),
    );
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    const save = screen.getByRole('button', { name: 'Save away mode' });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    await user.click(save);
    expect(sent.every((c) => c.startsWith('GET'))).toBe(true);
    answer(new Response(JSON.stringify({ ok: true, affected: [], underWay: [] })));
    await waitFor(() => expect(save.getAttribute('aria-disabled')).toBeNull());
  });

  it('pr78 F4: a confirm that finds them already moved (409, none left) saves: no empty ask', async () => {
    mockFetch({
      'GET /api/admin/season/blocks/preview': { status: 500, json: { ok: false } },
      'POST /api/admin/season/blocks': lock409([SAM]),
      'POST /api/admin/season/blocks/confirm': lock409([]),
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await typeRange(user);
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await user.click(await screen.findByRole('button', { name: 'Block and tell Sam' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/season?saved=away'));
    expect(screen.queryByRole('group', { name: 'Block anyway?' })).toBeNull();
  });

  it('pr78 F6: the new range is in but the old one won’t go → says so; Save again only removes the old one', async () => {
    let del = 0;
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview(),
      'POST /api/admin/season/blocks': { status: 201, json: { ok: true, id: 'a-2', underWay: [] } },
      'DELETE /api/admin/season/blocks/a-1': () =>
        ++del === 1 ? { status: 500, json: { ok: false } } : { json: { ok: true } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={AWAY} lockedNow={null} back={null} />);
    await user.clear(to());
    await user.type(to(), '2027-05-04');
    await screen.findByText(whole('No locked bookings in that range.'));
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await screen.findByText(
      'Your new dates are saved, but the old ones are still there. Save again to clear them.',
    );
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/season?saved=away'));
    expect(posts(calls)).toEqual([
      'POST /api/admin/season/blocks',
      'DELETE /api/admin/season/blocks/a-1',
      'DELETE /api/admin/season/blocks/a-1',
    ]);
  });

  it('turns away mode off', async () => {
    const calls = mockFetch({
      'GET /api/admin/season/blocks/preview': preview(),
      'DELETE /api/admin/season/blocks/a-1': { json: { ok: true } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={AWAY} lockedNow={null} back={null} />);
    await user.click(screen.getByRole('button', { name: 'Turn away mode off' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/season?saved=off'));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('a failed save says so and can be tried again', async () => {
    mockFetch({
      'GET /api/admin/season/blocks/preview': preview(),
      'POST /api/admin/season/blocks': { status: 500, json: { ok: false } },
    });
    const user = userEvent.setup();
    render(<AwayForm away={null} lockedNow={null} back={null} />);
    await user.type(from(), '2027-05-10');
    await user.type(to(), '2027-05-14');
    await user.click(screen.getByRole('button', { name: 'Save away mode' }));
    await screen.findByText(whole('Something went sideways on my end. Try once more, or text me.'));
    expect(screen.getByRole('button', { name: 'Save away mode' }).getAttribute('aria-disabled')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});
