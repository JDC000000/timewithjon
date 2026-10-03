// QA H2: /new-date opens on the season's first month and only season days can be picked (the S7 grid's off days).
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DISHES } from '@/content';
import { installFocusGuard } from '@/ui/focus';
import { dishView } from '../../book/[dish]/_lib/flow-view';
import { NewDateForm } from '../form';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const grind = dishView(DISHES.find((d) => d.slug === 'the-grind')!);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  cleanup();
  document.body.innerHTML = '';
});

const shownMonth = () =>
  [...document.querySelectorAll('.cal-month')].filter((m) => !m.classList.contains('m-hide'));

describe('S18 new-date grid (QA H2)', () => {
  it('opens on the first season month, with only season months in the grid', () => {
    render(
      <NewDateForm token="t" dish={grind} form="dates" span={{ start: '2027-04-01', end: '2027-06-30' }} />,
    );
    expect(shownMonth().map((m) => m.getAttribute('data-name'))).toEqual(['April 2027']);
    expect([...document.querySelectorAll('.cal-month')].map((m) => m.getAttribute('data-name'))).toEqual([
      'April 2027',
      'May 2027',
      'June 2027',
    ]);
  });

  it('days before the span start are off and do nothing when tapped', async () => {
    const user = userEvent.setup();
    render(
      <NewDateForm token="t" dish={grind} form="dates" span={{ start: '2027-05-12', end: '2027-06-30' }} />,
    );
    expect(shownMonth().map((m) => m.getAttribute('data-name'))).toEqual(['May 2027']);
    const before = document.getElementById('d-2027-05-08')!;
    expect(before.getAttribute('aria-disabled')).toBe('true');
    await user.click(before);
    expect(before.getAttribute('aria-pressed')).toBeNull();
    const open = document.getElementById('d-2027-05-15')!; // a Saturday, in the span
    expect(open.getAttribute('aria-disabled')).toBeNull();
    await user.click(open);
    expect(open.getAttribute('aria-pressed')).toBe('true');
  });

  it('after the season: no grid, the rough window only', () => {
    render(<NewDateForm token="t" dish={grind} form="dates" span={null} />);
    expect(document.querySelector('.cal-month')).toBeNull();
    expect(document.getElementById('s18-rough')).toBeTruthy();
  });
});
