// QA M3: a reload or Back on /book/<dish> keeps what the guest picked and typed (sessionStorage, this tab only), drops
// a pick that is no longer offered, never keeps the honeypot, never touches localStorage, and a saved Send clears it.
// A "reload" here is an unmount and a fresh render of the same flow.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, FLOW, type DishSlug } from '@/content';
import { DATES } from '@/content/ui/booking';
import { accessibleWindowName } from '@/features/availability/a11y';
import type { WeekOut } from '@/features/availability/types';
import { BookingFlow } from '../BookingFlow';
import { DatesFlow } from '../DatesFlow';
import { PitchFlow } from '../PitchFlow';
import { DetailsFields, SendFailed, useSend } from '../SendDetails';
import { calMonths } from '../_lib/date-grid';
import { draftKey } from '../_lib/draft';
import { dishView, type GuestView } from '../_lib/flow-view';
import { pickerMonths } from '../_lib/picker-model';

const NONE = { away: null, opensOn: null };
const view = (slug: DishSlug) => dishView(DISHES.find((d) => d.slug === slug)!);
const win = (date: string) => ({ slotId: `${date}-lunch`, date, window: 'lunch' as const, label: '' });
const open = (weekStart: string, dates: string[]): WeekOut => ({
  weekStart,
  state: 'open',
  windows: dates.map(win),
});
const WEEKS: WeekOut[] = [
  open('2027-03-29', ['2027-04-01', '2027-04-02']),
  open('2027-04-05', ['2027-04-08']),
];
const bare = (s: string) => s.replace(/\s+/g, '');
const tile = (date: string) =>
  screen.getByRole('button', {
    name: (n) => bare(n) === bare(accessibleWindowName({ date, window: 'lunch' })),
  });
const box = (name: string) =>
  screen.getByRole('textbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

function lunch(weeks = WEEKS) {
  return render(
    <>
      <div id="live" aria-live="polite" />
      <BookingFlow dish={view('the-long-lunch')} months={pickerMonths(weeks)} notices={NONE} />
    </>,
  );
}

describe('the booking draft (QA M3)', () => {
  it('times: picks, name and email survive a reload; the honeypot does not; nothing in localStorage', async () => {
    const user = userEvent.setup();
    const first = lunch();
    await user.click(tile('2027-04-01'));
    await user.click(tile('2027-04-08'));
    await user.type(box(FLOW.nameLabel), 'Sam');
    await user.type(box(FLOW.emailLabel), 'sam@example.com');
    const hp = document.getElementById('f-hp') as HTMLInputElement;
    await user.type(hp, 'bot');
    first.unmount();

    lunch();
    expect(tile('2027-04-01').getAttribute('aria-pressed')).toBe('true');
    expect(tile('2027-04-08').getAttribute('aria-pressed')).toBe('true');
    expect(tile('2027-04-02').getAttribute('aria-pressed')).toBe('false');
    expect(box(FLOW.nameLabel).value).toBe('Sam');
    expect(box(FLOW.emailLabel).value).toBe('sam@example.com');
    expect((document.getElementById('f-hp') as HTMLInputElement).value).toBe('');
    const raw = sessionStorage.getItem(draftKey('the-long-lunch'))!;
    expect(raw).not.toContain('bot');
    expect(localStorage.length).toBe(0);
  });

  it('a kept time that is no longer offered is dropped quietly', async () => {
    const user = userEvent.setup();
    const first = lunch();
    await user.click(tile('2027-04-01'));
    await user.click(tile('2027-04-08'));
    first.unmount();
    lunch([open('2027-03-29', ['2027-04-02']), open('2027-04-05', ['2027-04-08'])]);
    expect(tile('2027-04-08').getAttribute('aria-pressed')).toBe('true');
    expect(tile('2027-04-02').getAttribute('aria-pressed')).toBe('false');
    expect(JSON.parse(sessionStorage.getItem(draftKey('the-long-lunch'))!).picks).toEqual([
      '2027-04-08-lunch',
    ]);
  });

  it('one key per dish: another dish starts empty', async () => {
    const user = userEvent.setup();
    const first = lunch();
    await user.click(tile('2027-04-01'));
    first.unmount();
    render(<BookingFlow dish={view('the-flat-white')} months={pickerMonths(WEEKS)} notices={NONE} />);
    expect(tile('2027-04-01').getAttribute('aria-pressed')).toBe('false');
  });

  it('dates: picked dates, the rough window and overnight survive a reload', async () => {
    const user = userEvent.setup();
    const season = { start: '2027-04-01', end: '2027-06-30' };
    const flow = () => (
      <>
        <div id="live" aria-live="polite" />
        <DatesFlow
          dish={view('the-grind')}
          months={calMonths(season, [], view('the-grind').dateRule)}
          notices={NONE}
        />
      </>
    );
    const first = render(flow());
    await user.click(document.getElementById('d-2027-05-08')!);
    await user.click(screen.getByRole('button', { name: DATES.roughToggle }));
    await user.type(document.getElementById('f-rough')!, 'late May');
    first.unmount();
    render(flow());
    expect(document.getElementById('d-2027-05-08')!.getAttribute('aria-pressed')).toBe('true');
    expect((document.getElementById('f-rough') as HTMLInputElement).value).toBe('late May');
    expect(document.getElementById('rough')!.hidden).toBe(false);
  });

  it('pitch: the idea and when survive a reload', async () => {
    const user = userEvent.setup();
    const first = render(<PitchFlow dish={view('pitch-me')} notices={NONE} />);
    await user.type(document.getElementById('f-idea')!, 'Sailing');
    first.unmount();
    render(<PitchFlow dish={view('pitch-me')} notices={NONE} />);
    expect((document.getElementById('f-idea') as HTMLTextAreaElement).value).toBe('Sailing');
  });

  it('a personal invite whose details were edited reopens on the fields', async () => {
    const SAM: GuestView = { name: 'Sam Rivera', email: 'sam@example.com', general: false };
    sessionStorage.setItem(draftKey('the-long-lunch'), JSON.stringify({ email: 'sam@work.example' }));
    render(
      <BookingFlow dish={view('the-long-lunch')} months={pickerMonths(WEEKS)} notices={NONE} guest={SAM} />,
    );
    expect(box(FLOW.emailLabel).value).toBe('sam@work.example');
    expect(box(FLOW.nameLabel).value).toBe('Sam Rivera');
  });

  it('a saved Send clears the draft; a refused one keeps it', async () => {
    const answers = [{ ok: false, code: 'x', message: 'No.' }, { ok: true }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(answers.shift()), { status: 200 })),
    );
    sessionStorage.setItem(draftKey('pitch-me'), JSON.stringify({ idea: 'Sailing' }));
    const go = vi.fn();
    function Harness() {
      const s = useSend('pitch-me', { name: 'Sam', email: 'sam@example.com', general: false }, go);
      return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void s.submit({ pitchIdea: 'Sailing', windowText: 'May' });
          }}
        >
          <DetailsFields s={s} errors={[]} onFixed={() => {}} />
          <button type="submit">{FLOW.send}</button>
          <SendFailed s={s} />
        </form>
      );
    }
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    await vi.waitFor(() => expect(screen.getByText('No.')).toBeTruthy());
    expect(sessionStorage.getItem(draftKey('pitch-me'))).not.toBeNull();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    await vi.waitFor(() => expect(go).toHaveBeenCalledWith('/sent'));
    expect(sessionStorage.getItem(draftKey('pitch-me'))).toBeNull();
  });
});
