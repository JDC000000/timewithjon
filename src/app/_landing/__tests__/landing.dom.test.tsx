// Jon decisions 41b/47c + v2.2 "no words on a photo" as DOM order (pr89 F2), and CopyAddress's success-only "Copied" (F4).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLOSING_LINE, WHY_LINE } from '@/content';
import { COPY_ADDRESS } from '@/content/ui/landing';
import { dishBySlug } from '@/content/menu-helpers';
import { landingModel } from '@/features/invites/landing-model';
import { CopyAddress } from '../CopyAddress';
import { Hero } from '../Hero';
import { PersonalHero, type PersonalModel } from '../PersonalHero';
import { Closing, Why } from '../Why';

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

describe('S3 why band (decision 41b)', () => {
  it('the band comes first, full-bleed; the why line sits after it, outside it', () => {
    const { container } = render(<Why />);
    const section = container.querySelector('section.why')!;
    const [first, second] = [...section.children];
    expect(first!.matches('figure.ph.ph--band')).toBe(true);
    expect(first!.getAttribute('data-slot')).toBe('why');
    const line = section.querySelector('p.lead')!;
    expect(line.textContent).toBe(WHY_LINE);
    expect(second!.contains(line)).toBe(true);
    expect(first!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(first!.contains(line)).toBe(false);
  });
});

describe('S14 closing (decision 47c)', () => {
  it('the closing line comes first, then its photo, never on it', () => {
    const { container } = render(<Closing />);
    const section = container.querySelector('section.closing')!;
    const kids = [...section.children];
    expect(kids).toHaveLength(2);
    const line = section.querySelector('p')!;
    expect(line.textContent).toBe(CLOSING_LINE);
    expect(kids[0]!.contains(line)).toBe(true);
    expect(kids[1]!.matches('figure.ph.ph--close')).toBe(true);
    expect(kids[1]!.contains(line)).toBe(false);
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
