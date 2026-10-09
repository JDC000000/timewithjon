// tests/unit/ui/primitives.dom.test.tsx (U1): the shared components' markup contract and their non-layout
// behaviour, driven by user-event. Sheet, Menu placement and Toast-in-view run in real browsers
// (tests/e2e/ui/primitives.spec.ts).
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import * as ui from '@/ui';
import { Button, Field, FieldGroup, KeepWhole, List, Menu, PhotoSlot, SiteFooter, Toast } from '@/ui';
import { AdminNav } from '@/ui/AdminNav';
import { PHOTO_SLOTS, type Photo } from '@/ui/photo-slots';

const nav = vi.hoisted(() => ({ path: '/admin' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.path,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.useRealTimers();
});

describe('Button', () => {
  it('maps variants to the pack classes', () => {
    render(
      <>
        <Button variant="commit" block dt>
          Commit
        </Button>
        <Button size="sm" className="sug">
          Small
        </Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Commit' }).className).toBe(
      'btn btn--commit btn--block btn--dt',
    );
    expect(screen.getByRole('button', { name: 'Small' }).className).toBe('btn btn--sm sug');
    expect(screen.getByRole('button', { name: 'Commit' }).getAttribute('type')).toBe('button');
  });

  it('disabled: stays focusable, aria-disabled, swallows the click and never submits', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled onClick={onClick}>
          Send
        </Button>
      </form>,
    );
    const b = screen.getByRole('button', { name: 'Send' });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    expect(b.hasAttribute('disabled')).toBe(false);
    await user.tab();
    expect(document.activeElement).toBe(b);
    await user.click(b);
    await user.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('busy: shows the busy label, is disabled; enabled: clicks and submits', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { rerender } = render(
      <form onSubmit={onSubmit}>
        <Button type="submit" busy="Sending…">
          Send
        </Button>
      </form>,
    );
    const b = screen.getByRole('button', { name: 'Sending…' });
    expect(b.getAttribute('aria-disabled')).toBe('true');
    await user.click(b);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(
      <form onSubmit={onSubmit}>
        <Button type="submit">Send</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('aria-disabled')).toBe(false);
  });

  it('href renders a link with the button classes', () => {
    render(<Button href="/x">Go</Button>);
    const a = screen.getByRole('link', { name: 'Go' });
    expect(a.getAttribute('href')).toBe('/x');
    expect(a.className).toBe('btn');
  });
});

describe('Field', () => {
  it('label, hint, help, error, aria wiring and input classes', () => {
    render(
      <>
        <Field
          id="f1"
          label="Your email"
          hint="So I can send the invite."
          help="Help line"
          error="Check your email."
          inputClassName="code-in"
        />
        <Field id="f2" label="Note" multiline />
      </>,
    );
    const email = screen.getByRole('textbox', { name: 'Your email So I can send the invite.' });
    expect(email.className).toBe('input code-in');
    expect(email.getAttribute('aria-invalid')).toBe('true');
    expect(email.getAttribute('aria-describedby')).toBe('f1-h f1-e');
    expect(document.getElementById('f1-e')!.textContent).toBe('Check your email.');
    expect(document.getElementById('f1-e')!.hidden).toBe(false);
    expect(email.closest('.field')!.className).toBe('field bad');
    const note = screen.getByRole('textbox', { name: 'Note' });
    expect(note.tagName).toBe('TEXTAREA');
    expect(note.className).toBe('textarea');
    expect(note.hasAttribute('aria-invalid')).toBe(false);
    expect(note.getAttribute('aria-describedby')).toBe('f2-e');
    expect(document.getElementById('f2-e')!.hidden).toBe(true);
    expect(note.hasAttribute('multiline')).toBe(false);
  });

  it('FieldGroup hands its label and hint ids to the group', () => {
    render(
      <FieldGroup id="crew" label="Who's coming?" hint="Just you is perfect.">
        {({ labelId, hintId }) => <div role="group" aria-labelledby={labelId} aria-describedby={hintId} />}
      </FieldGroup>,
    );
    const g = screen.getByRole('group', { name: "Who's coming?" });
    expect(g.getAttribute('aria-describedby')).toBe('crew-h');
  });
});

describe('List, KeepWhole, PhotoSlot', () => {
  it('List renders rows by key, or the empty row', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const { rerender } = render(
      <List
        className="rows"
        items={items}
        getKey={(i) => i.id}
        render={(i) => <li>{i.id}</li>}
        empty={<li>none</li>}
      />,
    );
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['a', 'b']);
    rerender(
      <List
        className="rows"
        items={[{ id: 'c' }]}
        getKey={(i) => i.id}
        render={(i) => <li>{i.id}</li>}
        empty={<li>none</li>}
      />,
    );
    expect(screen.getByRole('listitem').textContent).toBe('c');
    rerender(
      <List
        className="rows"
        items={[]}
        getKey={(i: { id: string }) => i.id}
        render={() => null}
        empty={<li>none</li>}
      />,
    );
    expect(screen.getByRole('listitem').textContent).toBe('none');
    expect(screen.getByRole('list').className).toBe('rows');
  });

  it('KeepWhole wraps dates in .nw, the weekday outside the date', () => {
    const { container } = render(
      <p>
        <KeepWhole text="Locked in: Fri May 14 · noon–2 pm." />
      </p>,
    );
    expect(container.innerHTML).toBe(
      '<p>Locked in: <wbr><span class="nw">Fri <span class="nw">May 14</span></span> · <wbr><span class="nw">noon–2 pm</span>.</p>',
    );
  });

  it('PhotoSlot with no photo yet is the empty v2.0 slot markup, hidden from AT', () => {
    const { container } = render(<PhotoSlot slot="sample" kind="dish" alt="Jon on the trail" />);
    expect(container.innerHTML).toBe(
      '<figure class="ph ph--dish" data-slot="sample" data-alt="Jon on the trail" aria-hidden="true"></figure>',
    );
  });

  it('PhotoSlot with a photo renders its <img> (lazy by default), the alt spoken, the focal point kept (pr73 F8)', () => {
    const { container } = render(<PhotoSlot slot="close" kind="close" alt="Dusk on the water" />);
    const fig = container.querySelector('figure')!;
    expect(fig.getAttribute('class')).toBe('ph ph--close');
    expect(fig.hasAttribute('aria-hidden')).toBe(false);
    expect(fig.hasAttribute('data-alt')).toBe(false);
    const img = screen.getByRole('img', { name: 'Dusk on the water' });
    expect(img.getAttribute('src')).toBe('/img/close-480.webp');
    expect(img.getAttribute('srcset')).toBe(
      '/img/close-480.webp 480w, /img/close-800.webp 800w, /img/close-1200.webp 1200w, /img/close-1600.webp 1600w',
    );
    expect(img.getAttribute('sizes')).toBe('100vw');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.hasAttribute('fetchpriority')).toBe(false);
    expect(img.style.objectPosition).toBe(''); // dec 48: Jon's photo is cropped around its focal point at build time
    cleanup();
    const table = PHOTO_SLOTS as Record<string, Photo>;
    table['t-pos'] = { file: 't', w: [480], alt: '', pos: '50% 60%' };
    try {
      render(<PhotoSlot slot="t-pos" kind="close" alt="x" />);
      expect(screen.getByRole('img', { name: 'x' }).style.objectPosition).toBe('50% 60%');
    } finally {
      delete table['t-pos'];
    }
  });

  it("PhotoSlot takes the slot's own alt ('' = decorative) and 'eager' loads without a fetch priority", () => {
    const { container } = render(<PhotoSlot slot="why" kind="band" priority="eager" />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.hasAttribute('fetchpriority')).toBe(false);
    expect(img.hasAttribute('style')).toBe(false);
  });
});

describe('AdminNav', () => {
  it('marks the current section and names the badge', () => {
    nav.path = '/admin/requests/abc';
    render(
      <>
        <AdminNav variant="side" email="jon@example.com" needs={6} />
        <AdminNav variant="tabbar" needs={6} />
      </>,
    );
    const [side, tabbar] = screen.getAllByRole('navigation', { name: 'Admin' });
    expect(
      within(side!)
        .getByRole('link', { name: /^Requests\s?6\s?need a reply$/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(tabbar!)
        .getByRole('link', { name: /^Requests\s?6\s?need a reply$/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(within(tabbar!).getByRole('link', { name: 'More' }).getAttribute('href')).toBe('/admin/settings');
    expect(within(side!).getByRole('link', { name: 'Season' }).hasAttribute('aria-current')).toBe(false);
    expect(side!.textContent).toContain('Signed in as jon@example.com');
    expect(tabbar!.textContent).not.toContain('Signed in');
  });

  it('prefix matches only whole segments; no badge at 0 or unknown', () => {
    nav.path = '/admin/seasonal';
    render(<AdminNav variant="tabbar" needs={0} />);
    expect(screen.getByRole('link', { name: 'Season' }).hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('link', { name: 'Requests' }).hasAttribute('aria-current')).toBe(false);
    nav.path = '/admin';
  });
});

describe('Menu (keyboard, no layout)', () => {
  it('opens on click with focus on the first item; arrows wrap; Esc closes back to ⋯; select closes', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        id="m"
        buttonLabel="More for Priya"
        items={[
          { key: 'a', label: 'Move to stand-by', href: '/x' },
          { key: 'b', label: 'Copy their email', onSelect },
        ]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'More for Priya' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[1]);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('a click outside closes it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Menu id="m2" buttonLabel="More" items={[{ key: 'a', label: 'A', onSelect: () => {} }]} />
        <p>Outside</p>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByText('Outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Toast (jsdom: always in view)', () => {
  const props = {
    message: 'Locked in: Priya.',
    sub: (s: number) => `Invite goes out in ${s} s.`,
    pausedText: 'Paused.',
    undoLabel: 'Undo',
    undoVh: ' lock-in for Priya',
  };

  it('a named region; focus lands on Undo; counts down and expires once', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    render(<Toast {...props} seconds={3} onUndo={() => {}} onExpire={onExpire} />);
    const region = screen.getByRole('region', { name: 'Locked in: Priya.' });
    expect(document.activeElement).toBe(
      within(region).getByRole('button', { name: /^Undo\s?lock-in for Priya$/ }),
    );
    expect(region.textContent).toContain('Invite goes out in 3 s.');
    act(() => vi.advanceTimersByTime(1000));
    expect(region.textContent).toContain('Invite goes out in 2 s.');
    act(() => vi.advanceTimersByTime(2000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('Undo is ignored for 600 ms, then works once', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(<Toast {...props} label="Undo lock-in" onUndo={onUndo} onExpire={() => {}} />);
    const undo = screen.getByRole('button', { name: /^Undo\s?lock-in for Priya$/ });
    expect(screen.getByRole('region', { name: 'Undo lock-in' })).toBeTruthy();
    act(() => undo.click());
    expect(onUndo).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    act(() => undo.click());
    act(() => undo.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('hover pauses (paused text, count reset); leaving resumes', async () => {
    const user = userEvent.setup();
    render(<Toast {...props} seconds={10} onUndo={() => {}} onExpire={() => {}} />);
    const region = screen.getByRole('region');
    await act(() => new Promise((r) => setTimeout(r, 1100)));
    expect(region.textContent).toContain('9 s.');
    await user.hover(region);
    expect(region.textContent).toContain('Paused.');
    await user.unhover(region);
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(region.textContent).toContain('Invite goes out in 10 s.');
  });
});

describe('Toast under a still pointer (UX-07)', () => {
  const props = {
    message: 'Locked in: Priya.',
    sub: (s: number) => `Invite goes out in ${s} s.`,
    pausedText: 'Paused.',
    undoLabel: 'Undo',
    undoVh: ' lock-in for Priya',
  };
  it('appearing under the pointer that pressed Lock in, it keeps counting; a real move then pauses it', () => {
    vi.useFakeTimers();
    render(<Toast {...props} seconds={10} onUndo={() => {}} onExpire={() => {}} />);
    const region = screen.getByRole('region');
    // the enter the browser reports as the toast lands under the pointer, and its same-place layout moves
    fireEvent.mouseEnter(region);
    fireEvent.mouseMove(region, { clientX: 200, clientY: 700 });
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseMove(region, { clientX: 200, clientY: 700 });
    expect(region.textContent).toContain('Invite goes out in 8 s.');
    expect(region.textContent).not.toContain('Paused.');
    fireEvent.mouseMove(region, { clientX: 210, clientY: 690 }); // the pointer really moves over it: a hover
    expect(region.textContent).toContain('Paused.');
    fireEvent.mouseLeave(region);
    act(() => vi.advanceTimersByTime(20));
    expect(region.textContent).toContain('Invite goes out in 10 s.');
  });
});

describe('SiteFooter (Jon, 2026-10-05)', () => {
  it('is one line: "Questions? Text me." stays; the place line and the photo credits are gone', () => {
    const { container } = render(<SiteFooter />);
    expect([...container.querySelectorAll('footer.site-f p')].map((p) => p.textContent)).toEqual([
      'Questions? Text me. You’ve got the number.',
    ]);
    expect(container.textContent).not.toMatch(/North Shore|Stand-in|Unsplash|Photos: Jon/);
    expect('SiteFooter' in ui).toBe(true);
  });

  it('closes every guest page, /menu included', () => {
    const pages = [
      'src/app/page.tsx',
      'src/app/menu/page.tsx',
      'src/app/book/[dish]/page.tsx',
      'src/app/sent/page.tsx',
      'src/app/manage/page.tsx',
      'src/app/offer/frame.tsx',
      'src/app/story/page.tsx',
      'src/app/tag/page.tsx',
      'src/app/not-found.tsx',
    ];
    for (const f of pages) expect(readFileSync(f, 'utf8'), f).toContain('<SiteFooter />');
  });
});
