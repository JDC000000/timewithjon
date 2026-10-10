// evals/bugs: lock-sheet-no-place (r6): the dates Lock sheet had no way to set the place, so E4's approved
// "Where: {where}." and the locked page's Where row could never be filled. It now has an optional Where field
// (E4's own word): typed, the place goes with the lock; empty, there is none, as before. A call (The Long Distance)
// has no place, so its sheet has no field.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LOCK_SHEET } from '@/content/ui/admin-requests';
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

const view: DetailView = {
  who: 'Bea',
  caption: { text: 'Needs a reply · ', unit: '1 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Bea · Requests · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'A hike or nature moment' }],
  times: [],
  dates: ['Sat May 8'],
  open: true,
  flags: [],
  spam: false,
  dateKeys: ['2027-05-08'],
  pitch: false,
  datesMode: true,
  overnight: false,
  bigDayLocked: false,
  cancelWords: null,
  failed: [],
  joinedTo: null,
  canPromote: false,
};
const props = (dish: string): DetailPaneProps => ({
  requestId: 'r-where',
  email: 'bea@example.com',
  phone: null,
  dish,
  dishName: 'Dish',
  season: { start: '2027-04-01', end: '2027-06-30' },
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
});

let uninstall = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(sendLock).mockClear();
  vi.mocked(checkLock).mockClear();
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

async function lockWith(dish: string, place: string | null) {
  const user = userEvent.setup({ delay: null });
  render(<DetailPane {...props(dish)} />);
  await user.click(screen.getByRole('button', { name: /^Lock in Sat May 8$/ }));
  const sheet = screen.getByRole('dialog');
  if (place !== null) await user.type(within(sheet).getByRole('textbox', { name: LOCK_SHEET.where }), place);
  await user.click(within(sheet).getByRole('button', { name: /^Lock in Sat May 8, / }));
  await act(async () => void (await vi.advanceTimersByTimeAsync(11_000)));
  return vi.mocked(sendLock).mock.calls[0]![1] as { where: string | null };
}

describe('the Lock sheet’s Where (r6)', () => {
  it('a typed place goes with the pre-check and the lock', async () => {
    expect((await lockWith('the-grind', '  North gate ')).where).toBe('North gate');
    expect((vi.mocked(checkLock).mock.calls[0]![1] as { where: string | null }).where).toBe('North gate');
  });
  it('left empty: no place (null), as before', async () => {
    expect((await lockWith('the-grind', null)).where).toBeNull();
  });
  it('The Long Distance (a call) has no Where field, and never sends a place', async () => {
    const user = userEvent.setup({ delay: null });
    render(<DetailPane {...props('the-long-distance')} />);
    await user.click(screen.getByRole('button', { name: /^Lock in Sat May 8$/ }));
    expect(within(screen.getByRole('dialog')).queryByRole('textbox', { name: LOCK_SHEET.where })).toBeNull();
  });
});
