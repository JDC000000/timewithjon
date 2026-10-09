// QA4b M3 leftover (with #81): a joined booking's page has a ⋯ (it had none): Copy their email; no Suggest or Move to
// stand-by (it isn't open); Make host waits until the host has left (#81's canPromote).
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { ACTIONS, SHEETS } from '@/content/ui/admin-requests';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const view: DetailView = {
  who: 'Pat',
  caption: { text: 'Locked in' },
  filter: 'locked',
  back: { href: '/admin#locked', label: 'Locked in' },
  pageTitle: 'Pat · Locked in · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'The Long Lunch' }],
  times: [],
  dates: [],
  open: false,
  flags: [],
  spam: false,
  dateKeys: [],
  pitch: false,
  datesMode: false,
  overnight: false,
  bigDayLocked: false,
  cancelWords: { dish: 'Long Lunch', day: 'Thu May 27' },
  failed: [],
  joinedTo: { text: 'Joined to Robin’s booking.', href: '/admin/requests/h1' },
  canPromote: false,
};
const props: DetailPaneProps = {
  requestId: 'r-pat',
  email: 'pat@example.com',
  phone: null,
  dish: 'the-long-lunch',
  dishName: 'The Long Lunch',
  season: { start: '2027-04-01', end: '2027-06-30' },
  pitchLength: '',
  view,
  options: null,
  notes: { before60: '', jon: '' },
};

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  cleanup();
  uninstall();
});

describe('a joined booking’s page', () => {
  it('has a ⋯ with Copy their email, and Cancel for the guest; nothing an open request has', () => {
    render(<DetailPane {...props} />);
    expect(screen.getAllByRole('button', { name: ACTIONS.more('Pat') }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: SHEETS.cancel.link })).toBeTruthy();
    const sheet = document.getElementById('more-r-pat')!;
    expect(within(sheet).getByRole('button', { name: ACTIONS.copyEmail, hidden: true })).toBeTruthy();
    for (const absent of [ACTIONS.suggest, ACTIONS.standby, SHEETS.join.promote('Pat')])
      expect(within(sheet).queryByRole('button', { name: absent, hidden: true })).toBeNull();
  });
  it('a plain locked booking (not joined) has no ⋯', () => {
    render(<DetailPane {...props} view={{ ...view, joinedTo: null }} />);
    expect(screen.queryByRole('button', { name: ACTIONS.more('Pat') })).toBeNull();
  });
});
