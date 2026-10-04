// QA r2 L7: the Suggest sheet's button counts the ticked times ("Send 0 times", disabled, before any tick).
// QA r2 M3: a stand-by week row that crosses a month (a date dish's Thu–Sun) names both months.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { StandbySheet, SuggestSheet } from './ActionSheets';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const base = { requestId: 'r1', who: 'Sam', dish: 'The Grind', open: true, onClose: () => {} };
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00-07:00`).toISOString();
const TIMES = [
  { slotId: 's1', startsAt: at('2027-05-13', '12:00'), endsAt: at('2027-05-13', '14:00') },
  { slotId: 's2', startsAt: at('2027-05-14', '12:00'), endsAt: at('2027-05-14', '14:00') },
];

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
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
});

describe('A3 sheets (QA r2)', () => {
  it('L7: Suggest counts what is ticked: 0 (disabled), 1, then 2', async () => {
    const user = userEvent.setup();
    render(<SuggestSheet {...base} times={TIMES} />);
    const send = () => screen.getByRole('button', { name: /^Send \d+ times?$/ });
    expect(send().textContent).toBe('Send 0 times');
    expect(send().getAttribute('aria-disabled')).toBe('true');
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]!);
    expect(send().textContent).toBe('Send 1 time');
    await user.click(boxes[1]!);
    expect(send().textContent).toBe('Send 2 times');
  });

  it('M3: a week row across a month names both months; one inside a month reads "Jun 3–6"', () => {
    render(
      <StandbySheet
        {...base}
        weeks={[
          { weekStart: '2027-05-31', firstDate: '2027-06-03', lastDate: '2027-06-06', state: 'open' },
          { weekStart: '2027-04-26', firstDate: '2027-04-29', lastDate: '2027-05-02', state: 'spoken_for' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: /Jun 3–6/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Apr 29–May 2/ })).toBeTruthy();
  });
});
