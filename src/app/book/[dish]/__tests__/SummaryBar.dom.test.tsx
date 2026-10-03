// T1.7.U5 the sticky summary bar (pack .sbar) in the real flows, with user-event: "N times picked · Your details ↓"
// jumps to the details, switches to a Send that submits the same form once the details are in view, hides while the
// keyboard is open, and sits on the safe area (site.css). IntersectionObserver and visualViewport are jsdom stubs;
// the pinned layout at 375 px is the E2E's and the screenshots' job.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, FLOW } from '@/content';
import { DATES, DETAILS, FLOW_UI, PICKER } from '@/content/ui/booking';
import { accessibleWindowName } from '@/features/availability/a11y';
import type { WeekOut } from '@/features/availability/types';
import { BookingFlow } from '../BookingFlow';
import { DatesFlow } from '../DatesFlow';
import { calMonths } from '../_lib/date-grid';
import { dishView } from '../_lib/flow-view';
import { DETAILS_ID, FIELD_IDS } from '../_lib/form-errors';
import { pickerMonths } from '../_lib/picker-model';

const WEEKS: WeekOut[] = [
  {
    weekStart: '2027-03-29',
    state: 'open',
    windows: ['2027-04-01', '2027-04-02'].map((date) => ({
      slotId: `${date}-lunch`,
      date,
      window: 'lunch' as const,
      label: '',
    })),
  },
];
const LUNCH = dishView(DISHES.find((d) => d.slug === 'the-long-lunch')!);
const SHORE = dishView(DISHES.find((d) => d.slug === 'the-shore-ride')!);

/** A controllable IntersectionObserver: `see(true)` puts the observed details in view. */
let observed: Element[] = [];
let fire: (on: boolean) => void = () => {};
class FakeIO {
  constructor(private cb: IntersectionObserverCallback) {
    fire = (on) =>
      this.cb(
        observed.map((target) => ({ target, isIntersecting: on }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver,
      );
  }
  observe(el: Element) {
    observed.push(el);
  }
  disconnect() {
    observed = [];
  }
  unobserve() {}
  takeRecords() {
    return [];
  }
}
const see = (on: boolean) => act(() => fire(on));

/** visualViewport: a keyboard shrinks it (innerHeight stays). */
function stubViewport(height: number) {
  const vv = Object.assign(new EventTarget(), { height });
  vi.stubGlobal('visualViewport', vv);
  return {
    resize(h: number) {
      vv.height = h;
      act(() => {
        vv.dispatchEvent(new Event('resize'));
      });
    },
  };
}

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  observed = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
  window.HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

const bar = () => document.querySelector<HTMLElement>('.sbar')!;
const bare = (s: string) => s.replace(/\s+/g, '');
const tile = (date: string) =>
  screen.getByRole('button', {
    name: (n) => bare(n) === bare(accessibleWindowName({ date, window: 'lunch' })),
  });
const detailsLink = () => screen.getByRole('link', { name: 'Your details' });
// jsdom's name algorithm drops the space before the hidden rest (see BookingFlow.dom.test); real engines keep it
const barSend = () =>
  screen.getByRole('button', { name: (n) => bare(n) === bare(`${FLOW.send}${FLOW_UI.barSendRest}`) });

function renderBooking() {
  const user = userEvent.setup();
  render(
    <>
      <div id="live" aria-live="polite" />
      <BookingFlow dish={LUNCH} months={pickerMonths(WEEKS)} notices={{ away: null, opensOn: null }} />
    </>,
  );
  return user;
}

describe('T1.7.U5 sticky summary bar', () => {
  it('hidden with no picks; "N times picked · Your details ↓" once a time is picked (the arrow is decoration)', async () => {
    const user = renderBooking();
    expect(bar().hidden).toBe(true);
    await user.click(tile('2027-04-01'));
    expect(bar().hidden).toBe(false);
    expect(bar().querySelector('.count')?.textContent).toBe(PICKER.count(1));
    await user.click(tile('2027-04-02'));
    expect(bar().querySelector('.count')?.textContent).toBe(PICKER.count(2));
    expect(bar().textContent).toBe(`${PICKER.count(2)}Your details ↓`);
    expect(detailsLink().getAttribute('href')).toBe(`#${DETAILS_ID}`);
    expect(bar().querySelector('[aria-hidden="true"]')?.textContent).toBe(' ↓');
  });

  it('"Your details ↓" lands focus on the name field inside the details', async () => {
    const user = renderBooking();
    await user.click(tile('2027-04-01'));
    await user.click(detailsLink());
    expect(document.activeElement?.id).toBe(FIELD_IDS.name);
    expect(document.getElementById(DETAILS_ID)?.contains(document.activeElement)).toBe(true);
  });

  it('switches to Send once the details are in view, and that Send submits the same form (its checks run)', async () => {
    const user = renderBooking();
    await user.click(tile('2027-04-01'));
    expect(observed.map((e) => e.id)).toEqual([DETAILS_ID]);
    see(true);
    expect(screen.queryByRole('link', { name: 'Your details' })).toBeNull();
    const send = barSend();
    expect(send.getAttribute('type')).toBe('submit');
    expect(send.closest('form')).toBe(tile('2027-04-01').closest('form'));
    // the form's own Send keeps the plain name (one /^Send$/ on the page)
    expect(screen.getAllByRole('button', { name: /^Send$/ })).toHaveLength(1);
    await user.click(send);
    expect(document.body.textContent).toContain(DETAILS.nameError);
    see(false);
    expect(detailsLink()).toBeTruthy();
  });

  it('hides while a text field has focus (keyboard open) and comes back when it leaves', async () => {
    const user = renderBooking();
    await user.click(tile('2027-04-01'));
    expect(bar().hidden).toBe(false);
    await user.click(screen.getByRole('textbox', { name: /^Your name/ }));
    expect(bar().hidden).toBe(true);
    await user.click(tile('2027-04-02'));
    expect(bar().hidden).toBe(false);
  });

  it('a focusout during a press waits for the release: the bar never appears under the pointer mid-click', async () => {
    const user = renderBooking();
    await user.click(tile('2027-04-01'));
    await user.click(screen.getByRole('textbox', { name: /^Your name/ }));
    expect(bar().hidden).toBe(true);
    await user.pointer({ keys: '[MouseLeft>]', target: tile('2027-04-02') });
    expect(document.activeElement).toBe(tile('2027-04-02'));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(bar().hidden).toBe(true);
    await user.pointer({ keys: '[/MouseLeft]', target: tile('2027-04-02') });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(bar().hidden).toBe(false);
  });

  it('hides while the visual viewport is shrunk by a keyboard (no focus change needed)', async () => {
    const vv = stubViewport(window.innerHeight);
    const user = renderBooking();
    await user.click(tile('2027-04-01'));
    expect(bar().hidden).toBe(false);
    vv.resize(Math.floor(window.innerHeight * 0.5));
    expect(bar().hidden).toBe(true);
    vv.resize(window.innerHeight);
    expect(bar().hidden).toBe(false);
  });

  it('the dates flow: "N picked" and the same switch to Send', async () => {
    const user = userEvent.setup();
    render(
      <>
        <div id="live" aria-live="polite" />
        <DatesFlow
          dish={SHORE}
          months={calMonths({ start: '2027-04-01', end: '2027-06-30' }, [], SHORE.dateRule)}
          notices={{ away: null, opensOn: null }}
        />
      </>,
    );
    expect(bar().hidden).toBe(true);
    await user.click(screen.getByRole('button', { name: '8, Saturday May 8' }));
    expect(bar().querySelector('.count')?.textContent).toBe(DATES.count(1));
    expect(detailsLink()).toBeTruthy();
    see(true);
    expect(barSend().closest('form')).not.toBeNull();
  });

  it('respects the safe area: the .sbar rule pads by env(safe-area-inset-bottom), is phone-only and static at 400 %', () => {
    const css = readFileSync(join(process.cwd(), 'src/ui/site.css'), 'utf8');
    const rule = css.match(/\n\.sbar \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/padding:[^;]*calc\([^;]*env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.sbar \{\s*display: none !important;/);
    expect(css).toMatch(/@media \(max-height: 400px\) \{[^@]*\.sbar,[^}]*\{\s*position: static !important;/);
    expect(css).toMatch(/html:has\(\.sbar\) \{\s*scroll-padding-bottom: var\(--clear-sbar\);/);
    // hidden = gone (the global [hidden] rule beats .sbar's display: flex)
    expect(css).toMatch(/\[hidden\] \{\s*display: none !important;/);
  });

  it('while sending, the bar’s Send shows the same busy label and swallows a second tap', async () => {
    const f = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', f);
    const user = userEvent.setup();
    render(
      <BookingFlow
        dish={LUNCH}
        months={pickerMonths(WEEKS)}
        notices={{ away: null, opensOn: null }}
        guest={{ name: 'Sam Rivera', email: 'sam@example.com', general: false }}
      />,
    );
    await user.click(tile('2027-04-01'));
    see(true);
    await user.click(barSend());
    const busy = bar().querySelector('button')!;
    expect(busy.textContent).toBe(FLOW_UI.sending);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    await user.click(busy);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
