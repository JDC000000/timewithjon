// r5 N-L7: the guest said it's one night away. The shorter-pitch form (from E8's link) now has the "It’s one night
// away" box, and every new-time form (manage dates / pitch, /new-date after a weather call) starts as they left it.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISHES } from '@/content';
import { MANAGE_UI } from '@/content/manage';
import { DATES } from '@/content/ui/booking';
import { installFocusGuard } from '@/ui/focus';
import { dishView } from '../../book/[dish]/_lib/flow-view';
import { NewDateForm } from '../../new-date/form';
import { ManageActions } from '../actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const SEASON = { start: '2027-04-01', end: '2027-06-30' };
const pitch = dishView(DISHES.find((d) => d.slug === 'pitch-me')!);
const grind = dishView(DISHES.find((d) => d.slug === 'the-grind')!);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

const box = () => screen.getByRole('checkbox', { name: DATES.oneNight }) as HTMLInputElement;

describe('one night away carries over (r5 N-L7)', () => {
  it('the shorter-pitch form has the box, ticked as stored, and sends it', async () => {
    const f = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', f);
    const user = userEvent.setup();
    render(
      <ManageActions
        token="tok"
        header="x-twj-manage"
        dish={pitch}
        form="pitch"
        pitch={{ idea: 'Three nights kayaking.', when: 'June' }}
        overnight
        frees={null}
        canCancel
        canAskAnother
        canAddStory
        maxPhotos={3}
        season={SEASON}
      />,
    );
    await user.click(screen.getByRole('button', { name: new RegExp(MANAGE_UI.askAnother) }));
    expect(box().checked).toBe(true);
    await user.click(screen.getByRole('button', { name: /^Send/ }));
    const sent = f.mock.calls.find((c) => String(c[0]).includes('/api/manage/another-time'));
    expect(JSON.parse(String(sent![1]?.body))).toMatchObject({ overnight: true });
  });

  it('not stored: the box starts unticked', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const user = userEvent.setup();
    render(
      <ManageActions
        token="tok"
        header="x-twj-manage"
        dish={pitch}
        form="pitch"
        pitch={{ idea: 'A hike.', when: 'May' }}
        frees={null}
        canCancel
        canAskAnother
        canAddStory
        maxPhotos={3}
        season={SEASON}
      />,
    );
    await user.click(screen.getByRole('button', { name: new RegExp(MANAGE_UI.askAnother) }));
    expect(box().checked).toBe(false);
  });

  it('/new-date after a weather call starts ticked when the request was one night away', () => {
    render(
      <NewDateForm
        token="t"
        dish={grind}
        form="dates"
        span={{ start: '2027-04-01', end: '2027-06-30' }}
        unavailable={[]}
        overnight
      />,
    );
    expect(box().checked).toBe(true);
  });
});
