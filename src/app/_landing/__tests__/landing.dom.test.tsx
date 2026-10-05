// Jon decisions 41b/47c + v2.2 "no words on a photo" as DOM order (pr89 F2), and CopyAddress's success-only "Copied" (F4).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_ADDRESS } from '@/content/ui/landing';
import { dishBySlug } from '@/content/menu-helpers';
import { landingModel } from '@/features/invites/landing-model';
import { CopyAddress } from '../CopyAddress';
import { Hero } from '../Hero';
import { PersonalHero, type PersonalModel } from '../PersonalHero';
import { Closing, StoryBlock, Why } from '../Why';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type OpenModel = Extract<ReturnType<typeof landingModel>, { variant: 'open' }>;
const personalModel = landingModel({
  state: 'valid',
  invite: {
    id: 'i',
    kind: 'personal',
    is_test: true,
    name_slug: 'dave',
    display_name: 'Dave',
    our_things: ['the Seymour lap'],
    picked_dish: 'the-shore-ride',
    prefill_name: null,
    prefill_email: null,
    revoked_at: null,
  },
}) as PersonalModel;

describe('the why band (decision 41b), then the one story block (Jon, 2026-10-05)', () => {
  it('the why band is the photo alone, full-bleed', () => {
    const { container } = render(<Why />);
    const section = container.querySelector('section.why')!;
    expect([...section.children].map((c) => c.matches('figure.ph.ph--band'))).toEqual([true]);
    expect(section.textContent).toBe('');
  });

  it('#story: three body paragraphs, Jon’s words; the address a mailto link and "(Copy the address)" inline', () => {
    const { container } = render(<StoryBlock />);
    const section = container.querySelector('section#story')!;
    expect(section.querySelector('h1, h2, h3, .h1, .display, .cap, .lead')).toBeNull(); // one face throughout
    const ps = [...section.querySelectorAll('p')];
    expect(ps.map((p) => p.className)).toEqual(['body measure', 'body measure', 'body measure']);
    const [why, invite, signOff] = ps;
    expect(why!.textContent).toBe(
      'At a party I get a hug, a drink and half a story before someone pulls you away. This time I’d like the whole story. A table, a couple of hours, and nowhere else to be.',
    );
    expect(invite!.textContent).toBe(
      `Can’t make a date? How about you email me a photo from way back and a few lines. Any story, any length, I’d love to hear from you. stories@timewithjon.com (${COPY_ADDRESS.label})`,
    );
    expect(invite!.querySelector('a')!.getAttribute('href')).toBe('mailto:stories@timewithjon.com');
    expect(invite!.querySelector('button')!.textContent).toBe(COPY_ADDRESS.label);
    expect(signOff!.textContent).toBe('As always, looking forward to whatever is next! - Jon');
  });
});

describe('the closing photo (decision 47c; its line is gone, Jon 2026-10-05)', () => {
  it('is the photo alone, no words', () => {
    const { container } = render(<Closing />);
    const section = container.querySelector('section.closing')!;
    expect([...section.children].map((c) => c.matches('figure.ph.ph--close'))).toEqual([true]);
    expect(section.textContent).toBe('');
  });
});

describe('no words on a photo (v2.2)', () => {
  it('every .ph on the landing (open + personal hero, why, closing) holds no text', () => {
    const { container } = render(
      <>
        <Hero model={landingModel({ state: 'none' }) as OpenModel} />
        <PersonalHero
          model={personalModel}
          dish={dishBySlug('the-shore-ride') ?? null}
          gate={{ kind: 'book' }}
        />
        <Why />
        <Closing />
      </>,
    );
    const figures = [...container.querySelectorAll('.ph')];
    expect(figures.length).toBeGreaterThanOrEqual(4);
    for (const f of figures) {
      expect(f.textContent).toBe('');
      expect(f.querySelector('p, h1, h2, h3, span, a, button')).toBeNull();
    }
  });
});

describe('CopyAddress (pr89 F4)', () => {
  const address = 'stories@timewithjon.com';
  const live = () => document.getElementById('live')!;
  const setClipboard = (clipboard: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
  const setup = () => {
    document.body.innerHTML = '<div id="live"></div>';
    render(<CopyAddress address={address} />);
    return screen.getByRole('button');
  };
  const click = async (button: HTMLElement) => {
    fireEvent.click(button);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  it('says "Copied" and announces it only after the clipboard took it, then goes back after 2.4 s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    const button = setup();
    expect(button.textContent).toBe(COPY_ADDRESS.label);
    await click(button);
    expect(writeText).toHaveBeenCalledWith(address);
    expect(button.textContent).toBe(COPY_ADDRESS.copied);
    expect(live().textContent).toBe(COPY_ADDRESS.copiedSay(address));
    expect(screen.getByRole('button')).toBe(button);
    act(() => void vi.advanceTimersByTime(2399));
    expect(button.textContent).toBe(COPY_ADDRESS.copied);
    act(() => void vi.advanceTimersByTime(1));
    expect(button.textContent).toBe(COPY_ADDRESS.label);
  });

  it('with no clipboard (http) or a refused one: keeps its label and announces nothing', async () => {
    for (const clipboard of [undefined, { writeText: () => Promise.reject(new Error('denied')) }]) {
      setClipboard(clipboard);
      const button = setup();
      await click(button);
      expect(button.textContent).toBe(COPY_ADDRESS.label);
      expect(live().textContent).toBe('');
      cleanup();
    }
  });
});
