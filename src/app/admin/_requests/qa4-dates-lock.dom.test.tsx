// QA4 M1 + M2 (proto walkthrough r4, 2026-10-08): a dated request with only a rough window still locks (Lock in…
// opens the dates sheet, which asks for any season date), and an overnight request's sheet picks "one night away".
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LOCK_SHEET } from '@/content/ui/admin-requests';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';
import { sendLock } from './lock-logic';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./lock-logic', () => ({ sendLock: vi.fn(async () => ({ ok: true, standbyOfferLive: false })) }));

const view = (over: Partial<DetailView> = {}): DetailView => ({
  who: 'Sam',
  caption: { text: 'Needs a reply · ', unit: '3 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Sam · Requests · Time with Jon admin',
  facts: [
    { label: 'Dish', value: 'The Shore Ride' },
    { label: 'When', value: 'Any weekend in late May' },
  ],
  times: [],
  dates: [],
  open: true,
  flags: [],
  spam: false,
  dateKeys: [],
  pitch: false,
  datesMode: true,
  overnight: false,
  bigDayLocked: false,
  cancelWords: null,
  failed: [],
  ...over,
});
const props = (v: DetailView): DetailPaneProps => ({
  requestId: 'r1',
  email: 'sam@example.com',
  phone: null,
  dish: 'the-shore-ride',
  dishName: 'The Shore Ride',
  season: { start: '2027-04-01', end: '2027-06-30' },
  joinedToRequestId: null,
  pitchLength: '',
  view: v,
  options: null,
  notes: { before60: '', jon: '' },
});

let uninstall: () => void = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(sendLock).mockClear();
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

describe('QA4 M2: only a rough window', () => {
  it('Lock in… is enabled and opens the dates sheet with a season date field; the lock goes with that date', async () => {
    const user = userEvent.setup({ delay: null });
    render(<DetailPane {...props(view())} />);
    const lock = screen.getByRole('button', { name: LOCK_SHEET.lockOpen });
    expect(lock.hasAttribute('disabled')).toBe(false);
    await user.click(lock);
    const sheet = screen.getByRole('dialog');
    const date = within(sheet).getByLabelText(LOCK_SHEET.date) as HTMLInputElement;
    expect(date.type).toBe('date');
    expect(date.min).toBe('2027-04-01');
    expect(date.max).toBe('2027-06-30');
    await user.type(date, '2027-05-29');
    await user.click(within(sheet).getByRole('button', { name: /^Lock in Sat May 29, 9 am$/ }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(11_000)));
    expect(sendLock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendLock).mock.calls[0]![1]).toEqual({
      date: '2027-05-29',
      start: '09:00',
      lengthMinutes: 240,
      countsToward: 'big_day',
    });
  });
});

describe('QA4 M1: one night away', () => {
  it('the dates sheet offers the overnight length and picks it; the lock is 24 h', async () => {
    const user = userEvent.setup({ delay: null });
    render(
      <DetailPane {...props(view({ overnight: true, dates: ['Sat May 8'], dateKeys: ['2027-05-08'] }))} />,
    );
    await user.click(screen.getByRole('button', { name: /^Lock in Sat May 8$/ }));
    const sheet = screen.getByRole('dialog');
    const length = within(sheet).getByRole('radiogroup', { name: LOCK_SHEET.length });
    const night = within(length).getByRole('radio', { name: 'one night away' }) as HTMLInputElement;
    expect(night.checked).toBe(true);
    await user.click(within(sheet).getByRole('button', { name: /^Lock in Sat May 8, 9 am$/ }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(11_000)));
    expect(vi.mocked(sendLock).mock.calls[0]![1]).toMatchObject({
      date: '2027-05-08',
      lengthMinutes: 24 * 60,
    });
  });
});
