// T2.9.U1 (ruling Q3): A6 Not spam / Delete on a spam-suspect story, with A2b's words and in-place confirm. Idempotent:
// an answer given elsewhere counts; a refusal leaves Not spam on screen (a false positive is never stuck).
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { mockFetch } from '@/app/admin/_season/__tests__/fetch-mock';
import { SpamActions } from '../SpamActions';

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const ID = '0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5a';
const NOT_SPAM = `POST /api/admin/stories/${ID}/not-spam`;
const DELETE = `DELETE /api/admin/stories/${ID}/spam`;

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  for (const f of Object.values(router)) f.mockClear();
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
});

const setup = () => {
  const user = userEvent.setup();
  render(<SpamActions storyId={ID} />);
  return user;
};
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe('SpamActions (A6)', () => {
  it('Not spam: the story becomes ordinary and its consent box is the landing', async () => {
    const calls = mockFetch({ [NOT_SPAM]: { json: { ok: true } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Not spam' }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/admin/stories/${ID}?cleared=1`));
    expect(router.refresh).toHaveBeenCalled();
    expect(calls).toHaveLength(1);
  });

  it('Not spam when another tab already said so: same result', async () => {
    mockFetch({ [NOT_SPAM]: { status: 409, json: { ok: false, code: 'not_spam_suspect' } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Not spam' }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('Delete asks in place; Keep it goes back to Delete; Delete it deletes and returns to the list', async () => {
    const calls = mockFetch({ [DELETE]: { json: { ok: true } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await frame();
    expect(document.activeElement).toBe(screen.getByText('Delete it for good? This can’t be undone.'));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    await frame();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    expect(calls).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/stories'));
    expect(calls.map((c) => c.method)).toEqual(['DELETE']);
  });

  it('Delete when it is already gone: back to the list, no error', async () => {
    mockFetch({ [DELETE]: { status: 404, json: { ok: false, code: 'not_found' } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/admin/stories'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a refused Delete (photos) says so and leaves Not spam there: never stuck', async () => {
    mockFetch({
      [DELETE]: { status: 409, json: { ok: false, code: 'has_photos' } },
      [NOT_SPAM]: { json: { ok: true } },
    });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ERRORS.generic);
    await frame();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    expect(router.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Not spam' }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalled());
  });
});

// pr83: focus moves after React commits the step it lands on. A frame that fires BEFORE the commit (a loaded CI box)
// is simulated by a requestAnimationFrame that runs its callback at once: a rAF-based focus finds no element there.
describe('SpamActions (A6) focus lands after the commit, not on a frame', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it('nothing takes focus on first render', () => {
    setup();
    expect(document.activeElement).toBe(document.body);
  });

  it('Delete -> the question; Keep it -> Delete, with an early frame', async () => {
    mockFetch({});
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(document.activeElement).toBe(screen.getByText('Delete it for good? This can’t be undone.'));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('a refused Delete lands on Delete, with an early frame', async () => {
    mockFetch({ [DELETE]: { status: 409, json: { ok: false, code: 'has_photos' } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('a refused Not spam (a plain failure) lands on Delete too', async () => {
    mockFetch({ [NOT_SPAM]: { status: 500, json: { ok: false } } });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Not spam' }));
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
  });

  it('a landed focus is spent: clearing the error later does not pull focus off Not spam', async () => {
    mockFetch({
      [DELETE]: { status: 409, json: { ok: false, code: 'has_photos' } },
      [NOT_SPAM]: { json: { ok: true } },
    });
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete it' }));
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Not spam' }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Not spam' }));
  });
});
