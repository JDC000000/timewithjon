// T2.9.U1: A6 "OK for the book" under user-event: the box follows at once, the route gets { consent }, the list
// re-reads; a refusal puts the box back and says so. Focus never leaves the box.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { mockFetch } from '@/app/admin/_season/__tests__/fetch-mock';
import { ConsentToggle } from '../ConsentToggle';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
const ID = '0b5f0d8e-3c1e-4d7e-9a53-0e8f2b1c4d5a';

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  router.refresh.mockClear();
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
});
afterEach(() => {
  cleanup();
  uninstall();
  document.getElementById('live')?.remove();
  vi.unstubAllGlobals();
});

describe('ConsentToggle', () => {
  it('unticking sends consent false, says so and re-reads the list', async () => {
    const calls = mockFetch({ [`PATCH /api/admin/stories/${ID}`]: { json: { ok: true } } });
    const user = userEvent.setup();
    render(<ConsentToggle storyId={ID} who="Priya" consent />);
    const box = screen.getByRole('checkbox', { name: 'OK for the book' });
    expect((box as HTMLInputElement).checked).toBe(true);
    await user.click(box);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls).toEqual([{ method: 'PATCH', url: `/api/admin/stories/${ID}`, body: { consent: false } }]);
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(document.getElementById('live')!.textContent).toBe('Priya’s story is not for the book.');
    expect(document.activeElement).toBe(box);
  });

  it('a refusal puts the tick back and shows the error', async () => {
    mockFetch({
      [`PATCH /api/admin/stories/${ID}`]: { status: 409, json: { ok: false, code: 'spam_suspect' } },
    });
    const user = userEvent.setup();
    render(<ConsentToggle storyId={ID} who="Priya" consent={false} />);
    const box = screen.getByRole('checkbox', { name: 'OK for the book' }) as HTMLInputElement;
    await user.click(box);
    await screen.findByText(ERRORS.generic);
    expect(box.checked).toBe(false);
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('arriving from Not spam: focus lands on the box and the query goes', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(<ConsentToggle storyId={ID} who="Priya" consent={false} land />);
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'OK for the book' }));
    expect(replace).toHaveBeenCalledWith(window.history.state, '', window.location.pathname);
    replace.mockRestore();
  });

  it('an ordinary arrival leaves focus alone', () => {
    render(<ConsentToggle storyId={ID} who="Priya" consent={false} />);
    expect(document.activeElement).toBe(document.body);
  });
});
