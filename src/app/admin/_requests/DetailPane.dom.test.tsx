// pr77-review F2 (INT-03, A3b): Lock in opens a 10 s undo window; the POST goes when it ends, or at once if Jon leaves (PR-G2).
// user-event clicks with fake timers; sendLock (the POST) is mocked and counted.
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LOCK } from '@/content/ui/admin-requests';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';
import { sendLock } from './lock-logic';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./lock-logic', () => ({ sendLock: vi.fn(async () => ({ ok: true, standbyOfferLive: false })) }));

const view: DetailView = {
  who: 'Priya',
  caption: { text: 'Needs a reply · ', unit: '3 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Priya · Requests · Time with Jon admin',
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
  bigDayLocked: false,
  cancelWords: null,
  failed: [],
};
const props: DetailPaneProps = {
  requestId: 'r1',
  email: 'priya@example.com',
  phone: null,
  dish: 'the-long-lunch',
  dishName: 'The Long Lunch',
  season: { start: '2027-04-01', end: '2027-06-30' },
  joinedToRequestId: null,
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
};

let uninstall: () => void = () => {};
beforeEach(() => {
  // Only the countdown's clock (setInterval) is fake: user-event needs a real setTimeout to finish a click, so the
  // Toast's 600 ms Undo arm runs in real time (armUndo below).
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.mocked(sendLock).mockClear();
  uninstall = installFocusGuard(null);
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

/** The Toast ignores Undo for its first 600 ms (a double tap on Lock in can't land on it): real time. */
const armUndo = () => act(() => new Promise<void>((r) => setTimeout(r, 700)));
const wait = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));
async function lockIn() {
  const user = userEvent.setup({ delay: null });
  const r = render(<DetailPane {...props} />);
  await user.click(screen.getByRole('button', { name: /^Lock in/ }));
  return { user, ...r };
}

describe('A3b: the lock POST waits for the undo window (INT-03)', () => {
  it('no POST at 9.9 s; exactly one, with the slot and the ticks, when the window ends', async () => {
    await lockIn();
    expect(screen.getByRole('button', { name: /Undo/ })).toBeTruthy();
    await wait(9_900);
    expect(sendLock).not.toHaveBeenCalled();
    await wait(1_200);
    expect(sendLock).toHaveBeenCalledTimes(1);
    expect(sendLock).toHaveBeenCalledWith(
      'r1',
      { slotId: 's1' },
      { overrideWeek: false, bookAnyway: false },
      expect.any(Function),
    );
    await wait(20_000);
    expect(sendLock).toHaveBeenCalledTimes(1);
  });

  it('Undo: never a POST, and focus lands on the "Undone" line', async () => {
    const { user } = await lockIn();
    await armUndo();
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await wait(30_000);
    expect(sendLock).not.toHaveBeenCalled();
    const note = screen.getByText(LOCK.undone('Priya'));
    expect(note.classList.contains('notice')).toBe(true);
    expect(note.classList.contains('undone')).toBe(true);
    expect(document.activeElement).toBe(note);
  });

  it('leaving mid-window (unmount: Back, reload, another request) POSTs the lock at once, exactly once', async () => {
    const { unmount } = await lockIn();
    await wait(5_000);
    expect(sendLock).not.toHaveBeenCalled();
    unmount();
    expect(sendLock).toHaveBeenCalledTimes(1);
    await wait(30_000);
    expect(sendLock).toHaveBeenCalledTimes(1);
  });

  it('pagehide, then the tab going hidden, mid-window: one POST, then no second one when the window ends', async () => {
    await lockIn();
    await wait(2_000);
    act(() => void window.dispatchEvent(new Event('pagehide')));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    delete (document as { visibilityState?: unknown }).visibilityState;
    expect(sendLock).toHaveBeenCalledTimes(1);
    await wait(30_000);
    expect(sendLock).toHaveBeenCalledTimes(1);
  });
});

describe('A3b: the lock is never silent (PR-G)', () => {
  it('a sent lock leaves "Locked in. Invite sent." on the page, in a status region', async () => {
    await lockIn();
    await wait(11_000);
    const line = await screen.findByText(LOCK.sent);
    expect(line.closest('[role="status"]')).toBeTruthy();
  });

  it('a refused lock is an alert with the reason, and takes focus', async () => {
    vi.mocked(sendLock).mockResolvedValueOnce({
      ok: false,
      code: 'time_taken',
      message: 'That time just went.',
    });
    await lockIn();
    await wait(11_000);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That time just went.');
    expect(document.activeElement).toBe(alert);
  });
});
