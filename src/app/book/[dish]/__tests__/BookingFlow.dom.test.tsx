// S6 picker behaviour (T1.5.U2-U5) with user-event (real event sequences; never element.focus()). Elements by role +
// accessible name. Layout (holdStill, 44 px, exact names in real engines) was checked ad hoc in Chromium + WebKit
// for PR #76; the S6 FOC-02 / INT-01 / INT-06 browser specs land with the T4.3 E2E lane (PR4 of this lane).
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, ERRORS, FLOW } from '@/content';
import { PICKER } from '@/content/ui/booking';
import { accessibleWindowName } from '@/features/availability/a11y';
import type { WeekOut } from '@/features/availability/types';
import { BookingFlow } from '../BookingFlow';
import { dishView } from '../_lib/flow-view';
import { pickerMonths } from '../_lib/picker-model';

// 2027: Apr 1 is a Thursday; weeks start on Mondays.
const win = (date: string, window: 'lunch' | 'evening' = 'lunch') => ({
  slotId: `${date}-${window}`,
  date,
  window,
  label: '',
});
const open = (weekStart: string, dates: string[]): WeekOut => ({
  weekStart,
  state: 'open',
  windows: dates.map((d) => win(d)),
});
const WEEKS: WeekOut[] = [
  open('2027-03-29', ['2027-04-01', '2027-04-02']),
  { weekStart: '2027-04-05', state: 'spoken_for', windows: [] },
  open('2027-05-03', ['2027-05-06']),
];
const LUNCH = DISHES.find((d) => d.slug === 'the-long-lunch');

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

function renderFlow() {
  if (!LUNCH) throw new Error('fixture dish missing');
  const user = userEvent.setup();
  const utils = render(
    <>
      <div id="live" aria-live="polite" />
      <BookingFlow
        dish={dishView(LUNCH)}
        months={pickerMonths(WEEKS)}
        notices={{ away: null, opensOn: null }}
      />
    </>,
  );
  return { user, ...utils };
}
// jsdom's name algorithm drops the space between the .tw and .tt spans ("Thunoon–2 pm, Apr 1"); Chromium and WebKit
// keep it, so the exact name is asserted in the Playwright spec. Here: the same words, spaces ignored.
const bare = (s: string) => s.replace(/\s+/g, '');
const nameOf = (date: string) => accessibleWindowName({ date, window: 'lunch' });
const tile = (date: string) => screen.getByRole('button', { name: (n) => bare(n) === bare(nameOf(date)) });
const queryTile = (date: string) =>
  screen.queryByRole('button', { name: (n) => bare(n) === bare(nameOf(date)) });

describe('S6 picker (T1.5.U2-U5)', () => {
  it('names each tile the pack way and toggles aria-pressed on click, announcing the count', async () => {
    const { user } = renderFlow();
    const t = tile('2027-04-01');
    expect(t).toHaveProperty('type', 'button');
    expect(t.getAttribute('aria-pressed')).toBe('false');
    await user.click(t);
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('live')?.textContent).toMatch(
      /^Picked Thu Apr 1 · noon–2 pm\. 1 time picked\./,
    );
    await user.click(t);
    expect(t.getAttribute('aria-pressed')).toBe('false');
    expect(document.getElementById('live')?.textContent).toMatch(/^Removed .* 0 times picked\./);
  });

  it('Send with no pick: the summary takes focus, the line sits under the tabs, a pick clears both (T1.5.U5)', async () => {
    const { user } = renderFlow();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    const summary = screen.getByRole('link', { name: /Pick at least one time/ }).closest('[tabindex="-1"]');
    expect(document.activeElement).toBe(summary);
    expect(screen.getByText(ERRORS.noTimes)).toBeTruthy();
    await user.click(tile('2027-04-02'));
    expect(screen.queryByText(ERRORS.noTimes)).toBeNull();
  });

  it('month tabs: arrows move and show the month (automatic activation), one tab stop', async () => {
    const { user } = renderFlow();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1']);
    await user.click(tabs[0]!);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tile('2027-05-06')).toBeTruthy();
    expect(queryTile('2027-04-01')).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('Remove in the picks list un-picks and returns focus to the tile, its month shown first', async () => {
    const { user } = renderFlow();
    await user.click(tile('2027-04-01'));
    await user.click(screen.getAllByRole('tab')[1]!);
    const rail = screen.getByRole('complementary');
    await user.click(within(rail).getByRole('button', { name: /Remove/ }));
    const t = tile('2027-04-01');
    expect(t.getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(t);
  });

  it('stand-by replaces picked times (the server rule)', async () => {
    const { user } = renderFlow();
    await user.click(tile('2027-04-01'));
    const standby = screen.getByRole('checkbox', {
      name: (n) => bare(n).startsWith(bare(`${FLOW.standby}, Apr 8–9 ${PICKER.standbyHint}`)),
    });
    await user.click(standby);
    expect(standby).toHaveProperty('checked', true);
    expect(screen.getByText(PICKER.standbyReplaces)).toBeTruthy();
    expect(tile('2027-04-01').getAttribute('aria-pressed')).toBe('false');
  });

  it('puts one dish photo slot in the header, its licensed stand-in (decision 35; slots filled in U2 PR2)', () => {
    const { container } = renderFlow();
    const slots = container.querySelectorAll('figure[data-slot]');
    expect(
      [...slots].map((s) => [s.getAttribute('data-slot'), s.querySelector('img')?.getAttribute('src')]),
    ).toEqual([['long-lunch', '/img/long-lunch-480.webp']]);
    // T4.6.04: the header photo is the screen's largest paint on a phone: fetched first, never lazy
    const img = slots[0]!.querySelector('img')!;
    expect([img.getAttribute('loading'), img.getAttribute('fetchpriority')]).toEqual(['eager', 'high']);
  });
});
