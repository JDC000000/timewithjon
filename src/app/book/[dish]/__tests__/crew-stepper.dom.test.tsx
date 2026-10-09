// Q9 (approved: Jon 2026-10-09) "How many of you?" on every booking flow's details: a − n + stepper from the dish's
// smallest party to the servesMax the menu shows, sent as `crew` (stored in request.crew_size). Keyboard and screen
// reader: one labelled group, two named 44 px buttons that keep focus at the ends (aria-disabled), the number read
// out politely. A dish with one size doesn't ask and sends that size.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { DISHES, FLOW } from '@/content';
import { crewRange, type CrewRange } from '@/content/menu-helpers';
import { DETAILS } from '@/content/ui/booking';
import { PitchFlow } from '../PitchFlow';
import { DetailsFields, useSend } from '../SendDetails';
import { dishView, type GuestView } from '../_lib/flow-view';

const SAM: GuestView = { name: 'Sam Rivera', email: 'sam@example.com', general: false };
const NONE = { away: null, opensOn: null };
const view = (slug: string) => dishView(DISHES.find((d) => d.slug === slug)!);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
  sessionStorage.clear();
});

function stubFetch() {
  const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', f);
  return f;
}
const posted = (f: ReturnType<typeof stubFetch>) =>
  JSON.parse(String(f.mock.calls.at(-1)![1]!.body)) as { crew: number };

function Harness({ crew }: { crew: CrewRange }) {
  const s = useSend('the-long-lunch', SAM, () => {}, crew);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void s.submit({ slotIds: ['x'] });
      }}
    >
      <DetailsFields s={s} errors={[]} onFixed={() => {}} />
      <button type="submit">{FLOW.send}</button>
    </form>
  );
}

const group = () => screen.getByRole('group', { name: FLOW.crewLabel });
const fewer = () => within(group()).getByRole('button', { name: DETAILS.crewFewer });
const more = () => within(group()).getByRole('button', { name: DETAILS.crewMore });
const count = () => within(group()).getByTestId('crew-count');

describe('Q9 "How many of you?" (the crew stepper)', () => {
  it('is one labelled group: − 1 +, the number read out politely, starting at 1', () => {
    render(<Harness crew={{ min: 1, max: 3 }} />);
    expect(FLOW.crewLabel).toBe('How many of you?');
    expect(count().textContent).toBe('1');
    expect(count().tagName).toBe('OUTPUT');
    expect(count().getAttribute('aria-live')).toBe('polite');
    expect(fewer().getAttribute('aria-disabled')).toBe('true');
    expect(more().getAttribute('aria-disabled')).toBe('false');
  });

  it('counts up to the dish max and no further; at each end the button keeps focus and does nothing', async () => {
    const user = userEvent.setup();
    render(<Harness crew={{ min: 1, max: 3 }} />);
    await user.click(more());
    await user.click(more());
    expect(count().textContent).toBe('3');
    expect(more().getAttribute('aria-disabled')).toBe('true');
    await user.click(more()); // > max: nothing happens
    expect(count().textContent).toBe('3');
    expect(document.activeElement).toBe(more());
    await user.click(fewer());
    await user.click(fewer());
    await user.click(fewer()); // < min: nothing happens
    expect(count().textContent).toBe('1');
    expect(document.activeElement).toBe(fewer());
  });

  it('works from the keyboard: Tab to a button, Enter or Space', async () => {
    const user = userEvent.setup();
    render(<Harness crew={{ min: 1, max: 15 }} />);
    fewer().focus();
    await user.tab();
    expect(document.activeElement).toBe(more());
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(count().textContent).toBe('3');
    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    expect(count().textContent).toBe('2');
  });

  it('sends the chosen number as crew', async () => {
    const user = userEvent.setup();
    const f = stubFetch();
    render(<Harness crew={{ min: 1, max: 15 }} />);
    for (let i = 0; i < 4; i++) await user.click(more());
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(posted(f).crew).toBe(5);
  });

  it.each([
    ['The Double Date (serves 4: a fixed size)', 'the-double-date', 4],
    ['The Long Distance (a call: just you)', 'the-long-distance', 1],
  ])("%s doesn't ask, and sends its size", async (_name, slug, size) => {
    const user = userEvent.setup();
    const f = stubFetch();
    render(<Harness crew={view(slug).crew} />);
    expect(screen.queryByRole('group', { name: FLOW.crewLabel })).toBeNull();
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    expect(posted(f).crew).toBe(size);
  });

  it("each flow's dish brings its own range (the menu's serves)", () => {
    expect(view('the-flat-white').crew).toEqual({ min: 1, max: 3 });
    expect(view('pitch-me').crew).toEqual({ min: 1, max: 15 });
    expect(view('the-shore-ride').crew).toEqual({ min: 1, max: 6 });
    expect(view('the-double-date').crew).toEqual({ min: 4, max: 4 });
    expect(crewRange({ servesMax: 0 })).toEqual({ min: 1, max: 1 }); // never below 1
  });

  it('a real flow (Pitch Me) shows it and sends it', async () => {
    const user = userEvent.setup();
    const f = stubFetch();
    render(<PitchFlow dish={view('pitch-me')} notices={NONE} guest={SAM} />);
    await user.click(more());
    await user.click(more());
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${FLOW.pitchIdeaLabel}`) }), 'Sailing');
    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${FLOW.pitchWhenLabel}`) }), 'May');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));
    expect(posted(f).crew).toBe(3);
  });

  it('a reload keeps the number (the tab draft); one outside the range is dropped', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PitchFlow dish={view('pitch-me')} notices={NONE} guest={SAM} />);
    await user.click(more());
    await user.click(more());
    unmount();
    render(<PitchFlow dish={view('pitch-me')} notices={NONE} guest={SAM} />);
    expect(await within(group()).findByText('3')).toBeTruthy();
    cleanup();
    const key = Object.keys(sessionStorage).find((k) => k.includes('pitch-me'))!;
    sessionStorage.setItem(key, JSON.stringify({ ...JSON.parse(sessionStorage.getItem(key)!), crew: '40' }));
    render(<PitchFlow dish={view('pitch-me')} notices={NONE} guest={SAM} />);
    await screen.findByRole('group', { name: FLOW.crewLabel });
    expect(count().textContent).toBe('1');
  });
});
