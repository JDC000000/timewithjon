// T2.9.U1 / T3.15.U1: the A7b and A7c forms and the A7 Re-sync button under user-event (wireframe 09 A7, A7b, A7c).
// Save sends only what changed; a refusal about a field lands focus on it; otherwise focus stays on the button and
// the line under it says what happened.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { mockFetch } from '@/app/admin/_season/__tests__/fetch-mock';
import { OpeningForm } from '../OpeningForm';
import { RepliesForm } from '../RepliesForm';
import { ResyncButton } from '../ResyncButton';

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

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

/** The line under a button (the #live region repeats it, so match the <p>). */
const live = () => document.getElementById('live')!.textContent?.trim();
const saved = { personalOpenAt: '2026-02-26T16:00:00.000Z', generalOpenAt: '2026-03-02T16:00:00.000Z' };

describe('OpeningForm (A7b)', () => {
  it('shows the saved Vancouver dates and hours; an unchanged Save sends nothing', async () => {
    const calls = mockFetch({});
    const user = userEvent.setup();
    render(<OpeningForm saved={saved} />);
    expect((screen.getByLabelText('Personal links open date') as HTMLInputElement).value).toBe('2026-02-26');
    const time = screen.getByRole('combobox', { name: 'The general link opens time' }) as HTMLSelectElement;
    expect(time.value).toBe('08:00');
    expect(time.selectedOptions[0]!.textContent).toBe('8 am');
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    expect(live()).toBe('Nothing changed.');
    expect(calls).toEqual([]);
    expect(document.activeElement).toBe(save);
  });

  it('a moved hour sends only that release, in UTC, and says Saved.', async () => {
    const calls = mockFetch({ 'PATCH /api/admin/settings': { json: { ok: true } } });
    const user = userEvent.setup();
    render(<OpeningForm saved={saved} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'The general link opens time' }), 'noon');
    const save = screen.getByRole('button', { name: 'Save' });
    await user.click(save);
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls).toEqual([
      { method: 'PATCH', url: '/api/admin/settings', body: { generalOpenAt: '2026-03-02T20:00:00.000Z' } },
    ]);
    expect(screen.getByText('Saved.', { selector: 'p' })).toBeTruthy();
    expect(document.activeElement).toBe(save);
  });

  it('personal after general: the error sits on the personal date, and focus lands there', async () => {
    mockFetch({
      'PATCH /api/admin/settings': { status: 400, json: { ok: false, code: 'personal_after_general' } },
    });
    const user = userEvent.setup();
    render(<OpeningForm saved={saved} />);
    const date = screen.getByLabelText('Personal links open date') as HTMLInputElement;
    await user.clear(date);
    await user.type(date, '2026-03-06');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Personal links have to open before the general link.', { selector: 'p' });
    expect(document.activeElement).toBe(date);
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('an empty date is caught before sending; out of range is said under Save', async () => {
    const calls = mockFetch({
      'PATCH /api/admin/settings': { status: 400, json: { ok: false, code: 'release_out_of_range' } },
    });
    const user = userEvent.setup();
    render(<OpeningForm saved={saved} />);
    const general = screen.getByLabelText('The general link opens date') as HTMLInputElement;
    await user.clear(general);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(document.activeElement).toBe(general);
    expect(screen.getByText('Pick a date.', { selector: 'p' })).toBeTruthy();
    expect(calls).toEqual([]);
    await user.type(general, '2027-07-01');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Pick a time between now and the end of the season.', { selector: 'p' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });
});

describe('RepliesForm (A7c)', () => {
  it('shows the saved choice and people reached; sends only what changed', async () => {
    const calls = mockFetch({ 'PATCH /api/admin/settings': { json: { ok: true } } });
    const user = userEvent.setup();
    render(<RepliesForm saved={{ replyPromiseDays: 2, before60Enabled: true }} peopleReached={34} />);
    expect((screen.getByRole('radio', { name: '2 days' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radiogroup', { name: 'Reply promise' })).toBeTruthy();
    expect(screen.getByText('34', { selector: 'dd' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: '3 days' }));
    await user.click(
      screen.getByRole('checkbox', { name: 'Ask guests “What should we do before I’m 60?” after Send' }),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({ replyPromiseDays: 3, before60Enabled: false });
    expect(live()).toBe('Saved.');
  });

  it('a refusal says so under Save', async () => {
    mockFetch({ 'PATCH /api/admin/settings': { status: 500, json: { ok: false } } });
    const user = userEvent.setup();
    render(<RepliesForm saved={{ replyPromiseDays: 3, before60Enabled: false }} peopleReached={0} />);
    await user.click(screen.getByRole('radio', { name: '2 days' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(ERRORS.generic, { selector: 'p' });
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('ResyncButton (A7)', () => {
  it('says how many bookings made it; focus stays on the button', async () => {
    const calls = mockFetch({
      'POST /api/admin/google/resync': { json: { ok: true, queued: 3, synced: 3 } },
    });
    const user = userEvent.setup();
    render(<ResyncButton />);
    const btn = screen.getByRole('button', { name: 'Re-sync calendar' });
    await user.click(btn);
    await screen.findByText('All 3 bookings are on your calendar.', { selector: 'p' });
    expect(calls).toHaveLength(1);
    expect(document.activeElement).toBe(btn);
  });

  it('not connected: says to connect first', async () => {
    mockFetch({
      'POST /api/admin/google/resync': { status: 409, json: { ok: false, code: 'not_connected' } },
    });
    const user = userEvent.setup();
    render(<ResyncButton />);
    await user.click(screen.getByRole('button', { name: 'Re-sync calendar' }));
    await screen.findByText('Google isn’t connected. Connect it first.', { selector: 'p' });
  });
});
