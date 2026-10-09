// QA4 H1 (proto walkthrough r4b, 2026-10-08): locking a date dish in a full week said "Locked in… invite goes out in
// 10 s", then the server refused ("Tick Override this week") with no tick in the dates sheet; leaving inside the 10 s
// made the refusal silent. Now (a) the dates sheet offers the time lock's own tick, (b) the read-only pre-check runs
// before any window opens, so a refusal shows at once, and (c) a refusal that still comes back after Jon has left
// waits for him and shows when he opens the request again.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LOCK } from '@/content/ui/admin-requests';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';
import { checkLock, sendLock } from './lock-logic';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./lock-logic', async (orig) => ({
  ...(await orig<typeof import('./lock-logic')>()),
  sendLock: vi.fn(async () => ({ ok: true, standbyOfferLive: false })),
  checkLock: vi.fn(async () => ({ ok: true })),
}));

const FULL = 'That week is full. Tick Override this week to go ahead.';
const base: DetailView = {
  who: 'Kai',
  caption: { text: 'Needs a reply · ', unit: '3 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Kai · Requests · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'The Encore' }],
  times: [],
  dates: ['Thu May 20'],
  open: true,
  flags: [],
  spam: false,
  dateKeys: ['2027-05-20'],
  pitch: false,
  datesMode: true,
  overnight: false,
  bigDayLocked: false,
  cancelWords: null,
  failed: [],
  joinedTo: null,
  canPromote: false,
};
const slotView: DetailView = {
  ...base,
  facts: [{ label: 'Dish', value: 'The Long Lunch' }],
  dates: [],
  dateKeys: [],
  datesMode: false,
  times: [
    {
      slotId: 's1',
      label: 'Fri May 14 · noon–2 pm',
      meta: 'Week of May 10 · 1 of 2',
      open: true,
      lockable: true,
      override: null,
      nth: null,
    },
  ],
};
const props = (view: DetailView, dish = 'the-encore'): DetailPaneProps => ({
  requestId: 'r-h1',
  email: 'kai@example.com',
  phone: null,
  dish,
  dishName: 'The Encore',
  season: { start: '2027-04-01', end: '2027-06-30' },
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
});
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

let uninstall: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(sendLock).mockClear();
  vi.mocked(checkLock).mockReset();
  vi.mocked(checkLock).mockResolvedValue({ ok: true });
  sessionStorage.clear();
  uninstall = installFocusGuard(null);
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = '';
});

describe('QA4 H1 (a)+(b): the dates sheet asks first, and offers Override this week', () => {
  it('a full week: no window, the refusal and the tick in the sheet; ticked, the lock goes with overrideWeek', async () => {
    vi.mocked(checkLock)
      .mockResolvedValueOnce({ ok: false, code: 'week_full', message: FULL, nth: 3 })
      .mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup({ delay: null });
    render(<DetailPane {...props(base)} />);
    await user.click(screen.getByRole('button', { name: /^Lock in Thu May 20$/ }));
    const sheet = screen.getByRole('dialog');
    const commit = within(sheet).getByRole('button', { name: /^Lock in Thu May 20, 7 pm$/ });
    await user.click(commit);
    // refused BEFORE any "Locked in" toast: the sheet stays, with the server's words and the time lock's tick
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(within(sheet).getByRole('alert').textContent).toBe(FULL);
    const tick = within(sheet).getByRole('checkbox', { name: LOCK.overrideWeek('3rd') });
    expect(commit.hasAttribute('disabled') || commit.getAttribute('aria-disabled') === 'true').toBe(true);
    await user.click(tick);
    await user.click(commit);
    expect(vi.mocked(checkLock).mock.calls[1]![2]).toEqual({ overrideWeek: true, bookAnyway: false });
    await screen.findByRole('button', { name: /Undo/ });
    await wait(11_000);
    expect(sendLock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendLock).mock.calls[0]![2]).toEqual({ overrideWeek: true, bookAnyway: false });
  });

  it('a blocked date offers Book anyway; changing the date clears the refusal and the tick', async () => {
    vi.mocked(checkLock).mockResolvedValueOnce({
      ok: false,
      code: 'blocked',
      message: 'That date is blocked. Tick Book anyway to go ahead.',
      nth: null,
    });
    const user = userEvent.setup({ delay: null });
    render(
      <DetailPane
        {...props({ ...base, dates: ['Thu May 20', 'Fri May 21'], dateKeys: ['2027-05-20', '2027-05-21'] })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Lock in Thu May 20$/ }));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /^Lock in Thu May 20/ }));
    expect(within(sheet).getByRole('checkbox', { name: LOCK.bookAnyway })).toBeTruthy();
    await user.click(within(sheet).getByRole('radio', { name: /Fri May 21/ }));
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(within(sheet).queryByRole('checkbox')).toBeNull();
  });
});

describe('QA4 H1 (b): a time lock is checked before its window too', () => {
  it('refused: the line shows at once, no toast, no POST', async () => {
    vi.mocked(checkLock).mockResolvedValueOnce({
      ok: false,
      code: 'time_taken',
      message: 'That time just went.',
      nth: null,
    });
    const user = userEvent.setup({ delay: null });
    render(<DetailPane {...props(slotView, 'the-long-lunch')} />);
    await user.click(screen.getByRole('button', { name: /^Lock in/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('That time just went.');
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    await wait(15_000);
    expect(sendLock).not.toHaveBeenCalled();
  });
});

describe('QA4 H1 (c): a refusal after Jon left is never silent', () => {
  it('leaving mid-window, the late refusal waits; opening the request again shows it', async () => {
    vi.mocked(sendLock).mockResolvedValueOnce({ ok: false, code: 'week_full', message: FULL });
    const user = userEvent.setup({ delay: null });
    const first = render(<DetailPane {...props(slotView, 'the-long-lunch')} />);
    await user.click(screen.getByRole('button', { name: /^Lock in/ }));
    await screen.findByRole('button', { name: /Undo/ });
    first.unmount(); // another request, Season, Back: the lock goes at once (PR-G)
    await act(async () => {
      await Promise.resolve();
    });
    expect(sendLock).toHaveBeenCalledTimes(1);
    render(<DetailPane {...props(slotView, 'the-long-lunch')} />);
    expect((await screen.findByRole('alert')).textContent).toBe(FULL);
    // a new Lock in clears it
    await user.click(screen.getByRole('button', { name: /^Lock in/ }));
    await screen.findByRole('button', { name: /Undo/ });
    expect(screen.queryByText(FULL)).toBeNull();
  });
});
