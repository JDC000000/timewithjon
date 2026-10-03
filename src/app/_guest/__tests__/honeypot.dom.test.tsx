// QA L2: the honeypot (AD-9) on the booking and story forms is there for bots only: no person sees, hears, tabs to
// or autofills it ("Leave this empty" was readable page text). It still posts what a bot types into it.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FLOW } from '@/content';
import { STORY_FORM } from '@/content/ui/guest-after';
import { DetailsFields, useSend } from '../../book/[dish]/SendDetails';
import { StoryForm } from '../story-form';

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  document.body.innerHTML = '';
});

function Booking() {
  const s = useSend('pitch-me', { name: 'Sam', email: 'sam@example.com', general: false }, () => {});
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void s.submit({ pitchIdea: 'Sailing', windowText: 'May' });
      }}
    >
      <DetailsFields s={s} errors={[]} onFixed={() => {}} />
      <button type="submit">{FLOW.send}</button>
    </form>
  );
}

const story = () => (
  <StoryForm endpoint="/api/stories" target={{ headers: {} }} maxPhotos={1} before60={false} skipHref="/" />
);

function hiddenField() {
  const input = document.querySelector<HTMLInputElement>('input[name="website"]')!;
  const box = input.closest('.hp')!;
  return { input, box };
}

describe('the honeypot is for bots only (QA L2)', () => {
  for (const [name, ui] of [
    ['booking', () => <Booking />],
    ['story', story],
  ] as const) {
    it(`${name}: out of sight, out of the accessibility tree, the tab order and autofill`, async () => {
      render(ui());
      const { input, box } = hiddenField();
      expect(box).toBeTruthy();
      expect(box.getAttribute('aria-hidden')).toBe('true');
      expect(input.tabIndex).toBe(-1);
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(screen.queryByRole('textbox', { name: STORY_FORM.honeypot })).toBeNull(); // not in the a11y tree
      const user = userEvent.setup();
      const stops: Element[] = [];
      for (let i = 0; i < 12; i++) {
        await user.tab();
        if (document.activeElement) stops.push(document.activeElement);
      }
      expect(stops).not.toContain(input);
    });
  }

  it('the .hp box is off-screen and visibility: hidden (no text a person can read or copy)', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../ui/site.css'), 'utf8');
    const rule = css.match(/\n\.hp\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/left:\s*-\d+px/);
    expect(rule).toMatch(/visibility:\s*hidden/);
    expect(rule).toMatch(/overflow:\s*hidden/);
  });

  it('still works: what a bot types is posted', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    render(<Booking />);
    const user = userEvent.setup();
    await user.type(hiddenField().input, 'spam');
    await user.click(screen.getByRole('button', { name: FLOW.send }));
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({
      hp: 'spam',
    });
  });
});
