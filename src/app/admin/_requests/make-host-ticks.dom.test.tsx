// Make {name} the host re-checks the lock rules for the old host's time. A refusal a tick lifts shows here with that
// tick (as the lock sheets do) and goes again with it, instead of asking for a tick nobody can see.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LOCK, SHEETS } from '@/content/ui/admin-requests';
import { REFUSAL_MESSAGE as REFUSAL_COPY } from '@/features/availability/canLock';
import { DetailPane, type DetailPaneProps } from './DetailPane';
import type { DetailView } from './detail-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const view: DetailView = {
  who: 'Pat',
  caption: { text: 'Needs a reply · ', unit: '1 h' },
  filter: 'needs',
  back: { href: '/admin', label: 'Requests' },
  pageTitle: 'Pat · Requests · Time with Jon admin',
  facts: [{ label: 'Dish', value: 'The Shore Ride' }],
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
  joinedTo: null,
  canPromote: true,
};
const props: DetailPaneProps = {
  requestId: 'r-pat',
  email: 'pat@example.com',
  phone: null,
  dish: 'the-shore-ride',
  dishName: 'The Shore Ride',
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
  vi.unstubAllGlobals();
});

function stub(answers: { status: number; json: unknown }[]) {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => {
    const a = answers.shift()!;
    return new Response(JSON.stringify(a.json), { status: a.status });
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const bodyOf = (f: ReturnType<typeof stub>, n: number) => JSON.parse(String(f.mock.calls[n]![1]!.body));

async function makeHost(user: ReturnType<typeof userEvent.setup>, container: HTMLElement) {
  await user.click(container.querySelector('button[aria-haspopup="menu"]')!);
  await user.click(screen.getByRole('menuitem', { name: SHEETS.join.promote('Pat') }));
}

describe('Make host with its tick', () => {
  it('a Big Day clash: the refusal shows with Book anyway; ticked, Make host goes again with bookAnyway', async () => {
    const f = stub([
      { status: 409, json: { ok: false, code: 'big_day_clash', message: REFUSAL_COPY.big_day_clash } },
      { status: 200, json: { ok: true, warnings: [] } },
    ]);
    const user = userEvent.setup();
    const { container } = render(<DetailPane {...props} />);
    await makeHost(user, container);
    expect(bodyOf(f, 0)).toEqual({ overrideWeek: false, bookAnyway: false });
    const box = container.querySelector('[data-promote-refused]') as HTMLElement;
    expect(within(box).getByRole('alert').textContent).toBe(REFUSAL_COPY.big_day_clash);
    const again = within(box).getByRole('button', { name: SHEETS.join.promote('Pat') });
    expect(again.hasAttribute('disabled') || again.getAttribute('aria-disabled') === 'true').toBe(true);
    await user.click(within(box).getByRole('checkbox', { name: LOCK.bookAnywayClash }));
    await user.click(within(box).getByRole('button', { name: SHEETS.join.promote('Pat') }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(bodyOf(f, 1)).toEqual({ overrideWeek: false, bookAnyway: true });
    expect(container.querySelector('[data-promote-refused]')).toBeNull();
  });

  it('a full week: Override this week, naming which booking it would be', async () => {
    stub([{ status: 409, json: { ok: false, code: 'week_full', message: REFUSAL_COPY.week_full, nth: 3 } }]);
    const user = userEvent.setup();
    const { container } = render(<DetailPane {...props} />);
    await makeHost(user, container);
    expect(screen.getByRole('checkbox', { name: LOCK.overrideWeek('3rd') })).toBeTruthy();
  });

  it('a refusal no tick lifts is the usual line, with no tick', async () => {
    stub([{ status: 409, json: { ok: false, code: 'time_taken', message: REFUSAL_COPY.time_taken } }]);
    const user = userEvent.setup();
    const { container } = render(<DetailPane {...props} />);
    await makeHost(user, container);
    expect(screen.getByRole('alert').textContent).toBe(REFUSAL_COPY.time_taken);
    expect(container.querySelector('[data-promote-refused]')).toBeNull();
  });
});
