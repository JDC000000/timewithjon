// QA4 L8 (proto walkthrough r4, 2026-10-08): on Links, each row's Copy link / Copy text / Revoke names whose link it
// is for a screen reader, and focus never drops to the page: Keep it returns to Revoke, a done Revoke lands on the
// row's name (the row stays, without its buttons).
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteListItem } from '@/features/admin/invites';
import { installFocusGuard } from '@/ui/focus';
import { revokeInvite } from '../api';
import { A5 } from '../copy';
import { InvitesList } from '../InvitesList';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../api', () => ({ revokeInvite: vi.fn(async () => true), rotateGeneral: vi.fn(async () => true) }));
vi.mock('../CreateSheet', () => ({ CreateSheet: () => null }));

const item = (over: Partial<InviteListItem>): InviteListItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'personal',
  isTest: false,
  name: 'Dana',
  slug: 'dana',
  ourThings: [],
  pickedDish: null,
  dishNotBookable: false,
  prefillEmail: null,
  hopedFor: false,
  revoked: false,
  openCount: 0,
  firstOpenedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  link: 'https://example.test/?for=dana.x',
  text: 'Hi Dana',
  requests: { count: 0, latest: null },
  ...over,
});
const LIST = [
  item({}),
  item({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Sam',
    slug: 'sam',
    link: 'https://example.test/?for=sam.y',
  }),
];

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  vi.mocked(revokeInvite).mockClear();
});
afterEach(() => {
  cleanup();
  uninstall();
});

describe('Links rows (QA4 L8)', () => {
  it('each row action carries the person’s name', () => {
    render(<InvitesList invites={LIST} dishes={[]} />);
    for (const who of ['Dana', 'Sam'])
      for (const action of [A5.copyLink, A5.copyText, A5.revoke])
        expect(screen.getByRole('button', { name: `${action}, ${who}` })).toBeTruthy();
  });

  it('Keep it puts focus back on that row’s Revoke', async () => {
    const user = userEvent.setup();
    render(<InvitesList invites={LIST} dishes={[]} />);
    await user.click(screen.getByRole('button', { name: `${A5.revoke}, Sam` }));
    await user.click(screen.getByRole('button', { name: A5.keep }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `${A5.revoke}, Sam` }));
  });

  it('a done Revoke lands focus on the row’s name, which stays after the list refreshes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InvitesList invites={LIST} dishes={[]} />);
    await user.click(screen.getByRole('button', { name: `${A5.revoke}, Sam` }));
    await user.click(screen.getByRole('button', { name: A5.revokeYes }));
    expect(revokeInvite).toHaveBeenCalledWith(LIST[1]!.id);
    const name = screen.getByText('Sam', { selector: '.who' });
    expect(document.activeElement).toBe(name);
    // the refreshed list: Sam's row has no buttons now; focus is still on the name
    await act(async () =>
      rerender(<InvitesList invites={[LIST[0]!, { ...LIST[1]!, revoked: true }]} dishes={[]} />),
    );
    expect(screen.queryByRole('button', { name: `${A5.revoke}, Sam` })).toBeNull();
    expect(document.activeElement).toBe(name);
  });
});
