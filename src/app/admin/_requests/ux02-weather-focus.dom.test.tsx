// UX-02 (ux-a11y-adversarial 2026-10-08): after "Send the weather call" the sheet closed, its "Weather call ›" button
// unmounted (the request re-reads as needing a new time) and focus fell to <body>. Now it lands on the caption.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { SHEETS } from '@/content/ui/admin-requests';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const locked: DetailView = {
  who: 'Sam',
  caption: { text: 'Locked in · Big Day' },
  filter: 'locked',
  back: { href: '/admin#locked', label: 'Locked in' },
  pageTitle: 'Sam · Locked in · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'The Grind' }],
  times: [],
  dates: [],
  open: false,
  flags: [],
  spam: false,
  dateKeys: [],
  pitch: false,
  datesMode: true,
  overnight: false,
  bigDayLocked: true,
  cancelWords: { dish: 'Grind', day: 'Sat May 8' },
  failed: [],
};
const after: DetailView = {
  ...locked,
  caption: { text: 'Waiting on them' },
  filter: 'waiting',
  open: true,
  bigDayLocked: false,
  cancelWords: null,
};
const props = (view: DetailView): DetailPaneProps => ({
  requestId: 'r-w',
  email: 'sam@example.com',
  phone: null,
  dish: 'the-grind',
  dishName: 'The Grind',
  season: { start: '2027-04-01', end: '2027-06-30' },
  joinedToRequestId: null,
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
});

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('UX-02: focus after the weather call', () => {
  it('lands on the caption once the request re-reads, never on <body>', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DetailPane {...props(locked)} />);
    await user.click(screen.getByRole('button', { name: new RegExp(SHEETS.weather.open) }));
    const sheet = screen.getByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: SHEETS.weather.send }));
    await act(async () => rerender(<DetailPane {...props(after)} />)); // router.refresh: the re-read request
    const cap = screen.getByText('Waiting on them');
    expect(document.activeElement).toBe(cap);
  });
});
