// evals/bugs: time-dish-no-place (TWJ11, Jon 2026-10-10): a time dish (a lunch, an evening) locks in one click from
// the detail page, with no sheet, so it had no way to set the place. The detail now has the sheet's optional Where
// (E4's word) by the one-click Lock in. Empty, the lock goes exactly as before (no place).
import { act, cleanup, render, screen } from '@testing-library/react';
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
  who: 'Kim',
  caption: { text: 'Needs a reply · ', unit: '2 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Kim · Requests · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'The Long Lunch' }],
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
  dates: [],
  open: true,
  flags: [],
  spam: false,
  dateKeys: [],
  pitch: false,
  datesMode: false,
  overnight: false,
  bigDayLocked: false,
  cancelWords: null,
  failed: [],
  joinedTo: null,
  canPromote: false,
};
const props = (over: Partial<DetailPaneProps> = {}): DetailPaneProps => ({
  requestId: 'r-t',
  email: 'kim@example.com',
  phone: null,
  dish: 'the-long-lunch',
  dishName: 'The Long Lunch',
  season: { start: '2027-04-01', end: '2027-06-30' },
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
  ...over,
});

let uninstall = () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(sendLock).mockClear();
  vi.mocked(checkLock).mockClear();
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = '';
});

async function lockIn(place: string | null) {
  const user = userEvent.setup({ delay: null });
  render(<DetailPane {...props()} />);
  if (place !== null) await user.type(screen.getByRole('textbox', { name: LOCK_SHEET.where }), place);
  await user.click(screen.getByRole('button', { name: /^Lock in Fri May 14/ }));
  await screen.findByRole('button', { name: /Undo/ });
  await act(async () => void (await vi.advanceTimersByTimeAsync(11_000)));
}

describe('a time dish’s Where (TWJ11)', () => {
  it('a typed place goes with the pre-check and the one-click lock (trimmed)', async () => {
    await lockIn('  North gate ');
    expect(vi.mocked(checkLock).mock.calls[0]![1]).toEqual({ slotId: 's1', where: 'North gate' });
    expect(vi.mocked(sendLock).mock.calls[0]![1]).toEqual({ slotId: 's1', where: 'North gate' });
  });
  it('left empty: the one-click lock still goes, with no place', async () => {
    await lockIn(null);
    expect(sendLock).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendLock).mock.calls[0]![1]).toEqual({ slotId: 's1', where: null });
  });
  it('no field on a locked page, nor on a dated request (its sheet has its own)', () => {
    const { unmount } = render(
      <DetailPane {...props({ view: { ...view, open: false, filter: 'locked' } })} />,
    );
    expect(screen.queryByRole('textbox', { name: LOCK_SHEET.where })).toBeNull();
    unmount();
    render(
      <DetailPane
        {...props({
          dish: 'the-grind',
          view: { ...view, times: [], datesMode: true, dates: ['Sat May 8'], dateKeys: ['2027-05-08'] },
        })}
      />,
    );
    expect(screen.queryByRole('textbox', { name: LOCK_SHEET.where })).toBeNull();
  });
});
