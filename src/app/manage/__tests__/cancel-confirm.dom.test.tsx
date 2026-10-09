// QA B: the guest's Cancel on S17 asks first, in place: the row becomes the question and its two answers; "Keep it"
// puts the row back (focus returns to Cancel), "Yes, cancel" makes the one POST. Keyboard only, with user-event.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISHES } from '@/content';
import { MANAGE_UI } from '@/content/manage';
import { installFocusGuard } from '@/ui/focus';
import { dishView } from '../../book/[dish]/_lib/flow-view';
import { ManageActions } from '../actions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const lunch = dishView(DISHES.find((d) => d.slug === 'the-long-lunch')!);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  refresh.mockReset();
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

const SEASON = { start: '2027-04-01', end: '2027-06-30' };

function renderActions() {
  const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal('fetch', f);
  render(
    <ManageActions
      token="tok"
      header="x-twj-manage"
      season={SEASON}
      dish={lunch}
      form="slots"
      frees={null}
      canCancel
      canAskAnother
      canAddStory
      maxPhotos={3}
    />,
  );
  return { f, user: userEvent.setup() };
}

const cancelRow = () => screen.queryByRole('button', { name: MANAGE_UI.cancel });

describe('S17 Cancel asks first (QA B)', () => {
  it('one tap asks in place and posts nothing; focus moves into the question', async () => {
    const { f, user } = renderActions();
    await user.click(cancelRow()!);
    expect(f).not.toHaveBeenCalled();
    expect(cancelRow()).toBeNull();
    const group = screen.getByRole('group', { name: MANAGE_UI.cancelAsk });
    expect(group.textContent).toContain(MANAGE_UI.cancelAsk);
    expect(group.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole('button', { name: MANAGE_UI.cancelYes })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: MANAGE_UI.cancelKeep }));
  });

  it('Keep it puts the row back and returns focus to Cancel, by keyboard', async () => {
    const { f, user } = renderActions();
    cancelRow()!.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: MANAGE_UI.cancelKeep }));
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('group', { name: MANAGE_UI.cancelAsk })).toBeNull();
    expect(document.activeElement).toBe(cancelRow());
    expect(f).not.toHaveBeenCalled();
  });

  it('Yes, cancel makes the one POST and the page re-reads', async () => {
    const { f, user } = renderActions();
    await user.click(cancelRow()!);
    await user.click(screen.getByRole('button', { name: MANAGE_UI.cancelYes }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe('/api/manage/cancel');
  });

  it('Escape answers Keep it', async () => {
    const { f, user } = renderActions();
    await user.click(cancelRow()!);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(cancelRow());
    expect(f).not.toHaveBeenCalled();
  });

  it('Ask for another time: the rough window starts empty, no example inside it (QA L9)', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      <ManageActions
        token="tok"
        header="x-twj-manage"
        season={SEASON}
        dish={lunch}
        form="pitch"
        frees={null}
        canCancel
        canAskAnother
        canAddStory
        maxPhotos={3}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: MANAGE_UI.askAnother }));
    const rough = document.getElementById('m-rough') as HTMLInputElement;
    expect(rough.value).toBe('');
    expect(rough.hasAttribute('placeholder')).toBe(false);
  });
});
