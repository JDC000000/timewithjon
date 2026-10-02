// T1.6.U1-U6 behaviour with user-event (real event sequences; never element.focus()): the S7 month grid, the
// rough window, overnight, the Long Distance time zone, the Old Haunt weekend grid, Surprise Me and Pitch Me.
// Elements by role + accessible name. Exact layout and names in real engines: the Playwright pass for PR2.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, FLOW, type DishSlug } from '@/content';
import { DATES, PITCH, SURPRISE, TIME_ZONE } from '@/content/ui/booking';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import type { WeekOut } from '@/features/availability/types';
import { BookingFlow } from '../BookingFlow';
import { DatesFlow } from '../DatesFlow';
import { PitchFlow } from '../PitchFlow';
import { calMonths } from '../_lib/date-grid';
import { dishView } from '../_lib/flow-view';
import { pickerMonths } from '../_lib/picker-model';

const SEASON = { start: '2027-04-01', end: '2027-06-30' };
const AWAY = ['2027-04-29', '2027-04-30', '2027-05-01', '2027-05-02', '2027-05-03'];
const NONE = { away: null, opensOn: null };
/** a personal invite's filled-in details, so Send's summary counts only the flow's own problems (T1.7.U4) */
const GUEST = { name: 'Sam Rivera', email: 'sam@example.com', general: false };
const view = (slug: DishSlug) => dishView(DISHES.find((d) => d.slug === slug)!);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

const ERR = 'p.err, .errsum a';
const live = () => document.getElementById('live')?.textContent ?? '';
const day = (label: string) => screen.getByRole('button', { name: label });

function renderDates(slug: DishSlug = 'the-shore-ride', weekend = false) {
  const user = userEvent.setup();
  const d = view(slug);
  render(
    <>
      <div id="live" aria-live="polite" />
      <DatesFlow
        dish={d}
        months={calMonths(SEASON, AWAY, weekend ? 'weekend' : d.dateRule)}
        notices={NONE}
        weekendsOnly={weekend}
      />
    </>,
  );
  return user;
}

describe('S7 month grid (T1.6.U1)', () => {
  it('one Tab stop for the season; arrows move by day and week, across months, over off days', async () => {
    const user = renderDates('the-long-distance');
    const days = screen.getAllByRole('button', { name: /^\d+, / });
    expect(days.filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label'))).toEqual([
      '1, Thursday April 1',
    ]);
    await user.click(screen.getByRole('button', { name: DATES.roughToggle }));
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(day('1, Thursday April 1'));
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(day('22, Thursday April 22'));
    await user.keyboard('{ArrowDown}'); // Apr 29 is away: on to May 4
    expect(document.activeElement).toBe(day('4, Tuesday May 4'));
    expect(day('4, Tuesday May 4').tabIndex).toBe(0);
    expect(day('22, Thursday April 22').tabIndex).toBe(-1);
    await user.keyboard('{PageDown}{End}');
    expect(document.activeElement).toBe(day('6, Sunday June 6'));
  });

  it('pr80-review F4: Alt, Ctrl and Meta keys are left to the browser (Alt+Left is Back)', async () => {
    const user = renderDates('the-long-distance');
    day('1, Thursday April 1').focus();
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}{Control>}{End}{/Control}{Meta>}{PageDown}{/Meta}');
    expect(document.activeElement).toBe(day('1, Thursday April 1'));
    for (const mod of ['altKey', 'ctrlKey', 'metaKey'])
      expect(fireEvent.keyDown(day('1, Thursday April 1'), { key: 'ArrowLeft', [mod]: true })).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(day('2, Friday April 2'));
  });

  it('Space and Enter pick; a third pick swaps out the oldest and says so; the chips follow', async () => {
    const user = renderDates('the-long-distance');
    await user.click(day('8, Saturday May 8'));
    expect(day('8, Saturday May 8').getAttribute('aria-pressed')).toBe('true');
    expect(live()).toBe(DATES.picked('Sat May 8'));
    await user.keyboard('{ArrowRight}{Enter}');
    await user.keyboard('{ArrowRight} ');
    expect(live()).toBe(`${DATES.swapped('Sat May 8')}${DATES.picked('Mon May 10')}`);
    expect(day('8, Saturday May 8').getAttribute('aria-pressed')).toBe('false');
    const chips = screen.getByRole('list', { name: DATES.chipsLabel });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Sun May 9×', 'Mon May 10×']);
    // the count by Send (the sticky bar repeats it, T1.7.U5)
    expect(document.querySelector('.send')?.textContent).toContain(DATES.count(2));
    await user.keyboard('{Enter}');
    expect(live()).toBe(DATES.removed('Monday May 10'));
  });

  it('a chip’s Remove un-picks and returns focus to the day', async () => {
    const user = renderDates('the-long-distance');
    await user.click(day('8, Saturday May 8'));
    await user.click(screen.getByRole('button', { name: DATES.remove('Saturday May 8') }));
    expect(day('8, Saturday May 8').getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(day('8, Saturday May 8'));
    expect(live()).toBe(DATES.removed('Saturday May 8'));
  });

  it('off days are aria-disabled and never picked, by click or key', async () => {
    const user = renderDates('the-long-distance');
    const off = day('30, Friday April 30');
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.hasAttribute('aria-pressed')).toBe(false);
    await user.click(off);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    await user.keyboard('{Enter}');
    expect(off.getAttribute('aria-pressed')).toBeNull();
  });

  it('phones: the month steps show one month and move the Tab stop', async () => {
    const user = renderDates('the-long-distance');
    const prev = screen.getByRole('button', { name: DATES.prevMonth });
    const next = screen.getByRole('button', { name: DATES.nextMonth });
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    await user.click(next);
    expect(live()).toBe('May 2027');
    expect(prev.getAttribute('aria-disabled')).toBe('false');
    expect(day('4, Tuesday May 4').tabIndex).toBe(0);
    expect(day('4, Tuesday May 4').closest('.cal-month')?.classList.contains('m-hide')).toBe(false);
    expect(day('1, Thursday April 1').closest('.cal-month')?.classList.contains('m-hide')).toBe(true);
    await user.click(next);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    await user.click(next);
    expect(live()).toBe('June 2027');
    await user.click(prev);
    expect(live()).toBe('May 2027');
  });

  it('Send with no date: the summary takes focus; a rough window clears it', async () => {
    const user = renderDates();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    const link = screen.getByRole('link', { name: DATES.noDates });
    expect(document.activeElement).toBe(link.closest('[tabindex="-1"]'));
    // The h1 has the same words (FLOW.datesTitle): count the inline line and the summary link only.
    expect(screen.getAllByText(DATES.noDates, { selector: ERR })).toHaveLength(2);
    await user.click(link);
    expect(document.activeElement).toBe(screen.getByRole('group', { name: DATES.legend }));
    const toggle = screen.getByRole('button', { name: DATES.roughToggle });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await user.type(screen.getByRole('textbox', { name: /When were you thinking/ }), 'sometime in May');
    expect(screen.queryAllByText(DATES.noDates, { selector: ERR })).toHaveLength(0);
    expect(within(screen.getByRole('complementary')).getByText('sometime in May')).toBeTruthy();
  });

  it('a pick clears the error too', async () => {
    const user = renderDates();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    await user.click(day('8, Saturday May 8'));
    expect(screen.queryAllByText(DATES.noDates, { selector: ERR })).toHaveLength(0);
  });

  it('Big Days (weekend or Thu/Fri): Mon-Wed are off; the one-night row shows (T1.6.U3)', async () => {
    const user = renderDates('the-shore-ride');
    expect(day('5, Wednesday May 5').getAttribute('aria-disabled')).toBe('true');
    expect(day('6, Thursday May 6').getAttribute('aria-pressed')).toBe('false');
    const night = screen.getByRole('checkbox', { name: DATES.oneNight });
    await user.click(night);
    expect(night).toHaveProperty('checked', true);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('the Encore has no one-night row', () => {
    renderDates('the-encore');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(DATES.leads['the-encore']!)).toBeTruthy();
  });
});

describe('the Long Distance time zone (T1.6.U2)', () => {
  it('a select labelled "Your time zone" with the help line, set from the phone, editable', async () => {
    const user = renderDates('the-long-distance');
    const tz = screen.getByRole('combobox', { name: FLOW.timeZoneLabel });
    expect(tz.getAttribute('aria-describedby')).toBe('f-tz-h');
    expect(screen.getByText(TIME_ZONE.help).id).toBe('f-tz-h');
    const phone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const listed = TIME_ZONE.options.some((o) => o.value === phone);
    expect((tz as HTMLSelectElement).value).toBe(listed ? phone : 'elsewhere');
    await user.selectOptions(tz, 'Europe/London');
    expect((tz as HTMLSelectElement).value).toBe('Europe/London');
    expect(screen.getAllByRole('option')).toHaveLength(TIME_ZONE.options.length + 1);
  });
});

describe('the Old Haunt weekend grid (T1.6.U6)', () => {
  it('weekdays are off and named "weekends only"; each month says so', async () => {
    const user = renderDates('the-old-haunt', true);
    const thu = day(`6, Thursday May 6${DATES.weekendsOnlySuffix}`);
    expect(thu.getAttribute('aria-disabled')).toBe('true');
    await user.click(thu);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getAllByText(DATES.weekendsOnly)).toHaveLength(3);
    // An away weekend is off without the suffix.
    expect(day('1, Saturday May 1').getAttribute('aria-disabled')).toBe('true');
    await user.click(day('8, Saturday May 8'));
    expect(day('8, Saturday May 8').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('Surprise Me (T1.6.U4)', () => {
  const WEEKS: WeekOut[] = [
    {
      weekStart: '2027-05-03',
      state: 'open',
      windows: [{ slotId: 's1', date: '2027-05-06', window: 'evening', label: '' }],
    },
  ];
  function renderSurprise() {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <div id="live" aria-live="polite" />
        <BookingFlow
          dish={view('surprise-me')}
          months={pickerMonths(WEEKS)}
          notices={NONE}
          guest={GUEST}
          surprise
        />
      </>,
    );
    return { user, container };
  }

  it('its heading, When works over the picker, then The plan: need-to-know required, the plan optional', () => {
    const { container } = renderSurprise();
    expect(screen.getByRole('heading', { level: 1, name: SURPRISE.heading })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: SURPRISE.whenWorks })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: SURPRISE.planHeading })).toBeTruthy();
    const need = screen.getByRole('textbox', { name: new RegExp(`^${SURPRISE.needLabel}`) });
    expect(need).toHaveProperty('required', true);
    expect(
      screen.getByRole('textbox', { name: new RegExp(`^${SURPRISE.planLabel.replace(/[()]/g, '\\$&')}`) }),
    ).toHaveProperty('required', false);
    expect(container.querySelectorAll('figure[data-slot]')).toHaveLength(0); // no photo on S8 (Q5)
  });

  it('Send: the picks and the need-to-know both counted; the link lands on the field; typing clears it', async () => {
    const { user } = renderSurprise();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(screen.getByRole('heading', { name: 'Two things to fix' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: SURPRISE.needSummary }));
    const need = screen.getByRole('textbox', { name: new RegExp(`^${SURPRISE.needLabel}`) });
    expect(document.activeElement).toBe(need);
    expect(need.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(SURPRISE.needError)).toBeTruthy();
    await user.type(need, 'Sat, Lynn Canyon, helmet');
    expect(screen.queryByText(SURPRISE.needError)).toBeNull();
    expect(need.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Pitch Me (T1.6.U5)', () => {
  function renderPitch() {
    const user = userEvent.setup();
    render(
      <>
        <div id="live" aria-live="polite" />
        <PitchFlow dish={view('pitch-me')} notices={NONE} guest={GUEST} />
      </>,
    );
    return user;
  }
  const idea = () => screen.getByRole('textbox', { name: new RegExp(`^${FLOW.pitchIdeaLabel}`) });

  it('a starter fills the empty idea, then appends on a new line; focus to the end, announced', async () => {
    const user = renderPitch();
    const starters = within(screen.getByRole('group', { name: PITCH.try })).getAllByRole('button');
    expect(starters.map((b) => b.textContent)).toEqual(view('pitch-me').suggestions);
    await user.click(starters[0]!);
    const box = idea() as HTMLTextAreaElement;
    expect(box.value).toBe(starters[0]!.textContent);
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe(box.value.length);
    expect(live()).toBe(PITCH.added);
    await user.type(box, ' in May');
    await user.click(starters[1]!);
    expect(box.value).toBe(`${starters[0]!.textContent} in May\n${starters[1]!.textContent}`);
  });

  it('"You choose." (decision 43.7) shows as prose before "Try:" and the starters, not as a button', () => {
    renderPitch();
    const group = screen.getByRole('group', { name: PITCH.try });
    const lead = within(group).getByText('You choose.');
    expect(lead.tagName).toBe('P');
    expect(lead.closest('button')).toBeNull();
    expect(within(group).queryByRole('button', { name: 'You choose.' })).toBeNull();
    const order = [lead, within(group).getByText(PITCH.try), ...within(group).getAllByRole('button')];
    order.slice(1).forEach((el, i) => {
      expect(order[i]!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('"It’s one night away" reveals "Which night?" (single line, 60 max) and adds to the rail', async () => {
    const user = renderPitch();
    expect(screen.queryByRole('textbox', { name: new RegExp(`^${FLOW.overnightTitle}`) })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: DATES.oneNight }));
    const night = screen.getByRole('textbox', { name: new RegExp(`^${FLOW.overnightTitle}`) });
    expect(night.getAttribute('maxlength')).toBe('60');
    expect(night.tagName).toBe('INPUT');
    await user.type(night, 'Sat Jun 12, up Indian Arm');
    await user.type(
      screen.getByRole('textbox', { name: new RegExp(`^${FLOW.pitchWhenLabel}`) }),
      'sometime in June',
    );
    const rail = within(screen.getByRole('complementary'));
    expect(rail.getByRole('heading', { name: PITCH.yourPitch })).toBeTruthy();
    expect(rail.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'sometime in June',
      PITCH.oneNightAway,
    ]);
  });

  it('Send: the idea and when, counted; fixing each clears it', async () => {
    const user = renderPitch();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(screen.getByRole('heading', { name: 'Two things to fix' })).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: PITCH.ideaSummary }).closest('[tabindex="-1"]'),
    );
    await user.click(screen.getByRole('link', { name: PITCH.ideaSummary }));
    expect(document.activeElement).toBe(idea());
    await user.type(idea(), 'Canoe up Indian Arm');
    expect(screen.queryByText(PITCH.ideaError)).toBeNull();
    expect(screen.getAllByText(VALIDATION_MESSAGE.no_dates).length).toBeGreaterThan(0);
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${FLOW.pitchWhenLabel}`) }), 'June');
    expect(screen.queryAllByText(VALIDATION_MESSAGE.no_dates)).toHaveLength(0);
  });
});
