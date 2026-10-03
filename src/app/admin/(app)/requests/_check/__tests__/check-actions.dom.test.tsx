// T2.9.U2: A2b/A2c Check these answers on a spam-suspect request. Optimistic: the screen changes before the server
// answers; a failure rolls it back. Delete asks in place first; Esc / Keep it goes back. After a delete, focus lands
// on the next row (or the list caption) in the Check these list (wireframe 09 n15).
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { CHECK } from '@/content/ui/admin-requests';
import { installFocusGuard } from '@/ui/focus';
import { CheckActions } from '../CheckActions';
import { CheckLanding } from '../CheckLanding';
import { CHECK_CAPTION_ID } from '../landing';

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const ID = '0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5a';
const NEXT = '6f1c2a9e-8d44-4b0a-a2c1-5e7d9b3f1a20';
const WHO = 'Sam';

/** A fetch whose answer the test releases, so the optimistic state can be seen while the request is open. */
function pendingFetch() {
  const calls: { method: string; url: string }[] = [];
  let release: (status: number, json: unknown) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          calls.push({ method: init?.method ?? 'GET', url });
          release = (status, json) => resolve(new Response(JSON.stringify(json), { status }));
        }),
    ),
  );
  return { calls, answer: (status: number, json: unknown) => release(status, json) };
}

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  for (const f of Object.values(router)) f.mockClear();
  document.body.insertAdjacentHTML('afterbegin', '<div id="live" aria-live="polite"></div>');
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** The list pane beside the detail (1024+): this row is current, one more row after it. */
const list = (rows: string[]) => (
  <>
    <p id={CHECK_CAPTION_ID} tabIndex={-1}>
      {CHECK.listCaption}
    </p>
    <ul>
      {rows.map((id) => (
        <li key={id}>
          <a href={`/admin/requests/${id}`} aria-current={id === ID ? 'page' : undefined}>
            row {id.slice(0, 4)}
          </a>
        </li>
      ))}
    </ul>
  </>
);
const setup = (rows: string[] = [ID, NEXT]) => {
  const user = userEvent.setup();
  render(
    <>
      {list(rows)}
      <CheckActions requestId={ID} who={WHO} />
    </>,
  );
  return user;
};
const live = () => document.getElementById('live')!.textContent?.trim();

describe('CheckActions: Not spam', () => {
  it('is optimistic: the status shows (and takes focus) before the server answers; then E2 route, refresh', async () => {
    const f = pendingFetch();
    const user = setup();
    const group = screen.getByRole('group', { name: `${CHECK.caption}: ${WHO}` });
    expect(group).toBeTruthy();
    await user.click(screen.getByRole('button', { name: CHECK.notSpam }));
    const status = await screen.findByText(CHECK.movedToNeeds(WHO));
    await vi.waitFor(() => expect(document.activeElement).toBe(status));
    expect(screen.queryByRole('button', { name: CHECK.notSpam })).toBeNull();
    expect(f.calls).toEqual([{ method: 'POST', url: `/api/admin/requests/${ID}/not-spam` }]);
    expect(router.refresh).not.toHaveBeenCalled();
    f.answer(200, { ok: true });
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(live()).toBe(CHECK.movedToNeeds(WHO));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('already cleared in another tab (409 not_spam_suspect): same result, no error', async () => {
    const f = pendingFetch();
    const user = setup();
    await user.click(screen.getByRole('button', { name: CHECK.notSpam }));
    f.answer(409, { ok: false, code: 'not_spam_suspect' });
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rolls back on an error: buttons return, an alert says so, focus on Not spam', async () => {
    const f = pendingFetch();
    const user = setup();
    await user.click(screen.getByRole('button', { name: CHECK.notSpam }));
    await screen.findByText(CHECK.movedToNeeds(WHO));
    f.answer(500, { ok: false, code: 'server' });
    expect((await screen.findByRole('alert')).textContent).toBe(ERRORS.generic);
    const again = screen.getByRole('button', { name: CHECK.notSpam });
    await vi.waitFor(() => expect(document.activeElement).toBe(again));
    expect(screen.queryByText(CHECK.movedToNeeds(WHO))).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(live()).toBe('');
  });
});

describe('CheckActions: Delete (with a confirm)', () => {
  it('asks in place (focus on the question); Keep it and Esc go back to Delete with no request', async () => {
    const f = pendingFetch();
    const user = setup();
    await user.click(screen.getByRole('button', { name: CHECK.delete }));
    const question = screen.getByText(CHECK.confirm);
    await vi.waitFor(() => expect(document.activeElement).toBe(question));
    expect(screen.getByRole('group', { name: CHECK.confirm })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: CHECK.keepIt }));
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: CHECK.delete })),
    );
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByText(CHECK.confirm)));
    await user.keyboard('{Escape}');
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: CHECK.delete })),
    );
    expect(f.calls).toEqual([]);
  });

  it('Delete it is optimistic (status + row hidden), then back to Check these with focus on the next row', async () => {
    const f = pendingFetch();
    const user = setup();
    const row = document.querySelector(`a[href="/admin/requests/${ID}"]`)!.closest('li')!;
    await user.click(screen.getByRole('button', { name: CHECK.delete }));
    await user.click(screen.getByRole('button', { name: CHECK.deleteIt }));
    const status = await screen.findByText(CHECK.deleted(WHO));
    await vi.waitFor(() => expect(document.activeElement).toBe(status));
    expect(row.hidden).toBe(true);
    expect(f.calls).toEqual([{ method: 'DELETE', url: `/api/admin/requests/${ID}/spam` }]);
    f.answer(200, { ok: true });
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin?check=1'));
    expect(router.refresh).toHaveBeenCalled();
    expect(live()).toBe(CHECK.deleted(WHO));
    // the Check these list mounts after the navigation and takes the landing once
    cleanup();
    render(
      <>
        {list([NEXT])}
        <CheckLanding />
      </>,
    );
    expect(document.activeElement).toBe(document.querySelector(`a[href="/admin/requests/${NEXT}"]`));
  });

  it('the last row deleted: focus lands on the list caption', async () => {
    const f = pendingFetch();
    const user = setup([ID]);
    await user.click(screen.getByRole('button', { name: CHECK.delete }));
    await user.click(screen.getByRole('button', { name: CHECK.deleteIt }));
    f.answer(404, { ok: false, code: 'not_found' }); // already gone: what Jon asked for
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin?check=1'));
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();
    render(
      <>
        {list([])}
        <CheckLanding />
      </>,
    );
    expect(document.activeElement).toBe(document.getElementById(CHECK_CAPTION_ID));
  });

  it('rolls back on an error: row shown again, alert, focus on Delete, no navigation', async () => {
    const f = pendingFetch();
    const user = setup();
    const row = document.querySelector(`a[href="/admin/requests/${ID}"]`)!.closest('li')!;
    await user.click(screen.getByRole('button', { name: CHECK.delete }));
    await user.click(screen.getByRole('button', { name: CHECK.deleteIt }));
    await screen.findByText(CHECK.deleted(WHO));
    f.answer(409, { ok: false, code: 'not_spam_suspect' }); // a real request is never deleted
    expect((await screen.findByRole('alert')).textContent).toBe(ERRORS.generic);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: CHECK.delete })),
    );
    expect(row.hidden).toBe(false);
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: CHECK.notSpam })).toBeTruthy();
  });

  it('a double activation sends one request', async () => {
    const f = pendingFetch();
    const user = setup();
    const notSpam = screen.getByRole('button', { name: CHECK.notSpam });
    notSpam.click();
    notSpam.click();
    await screen.findByText(CHECK.movedToNeeds(WHO));
    expect(f.calls).toHaveLength(1);
    f.answer(200, { ok: true });
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    void user;
  });
});

describe('CheckLanding', () => {
  it('does nothing when no delete asked for a landing', () => {
    render(
      <>
        {list([NEXT])}
        <CheckLanding />
      </>,
    );
    expect(document.activeElement).toBe(document.body);
  });
});
