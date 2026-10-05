// S04 /menu as rendered (pack v2.2 s04/s05): headings, course nav, rows, sheets, the gate, deep links. Jon
// (2026-10-05): the new subhead, no menu foot, the hike's new name, no Bluebird.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ERRORS } from '@/content';
import { Menu } from '../Menu';
import { menuModel } from '../menu-model';

const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
const native = { showModal: proto.showModal, close: proto.close };
beforeAll(() => {
  proto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterAll(() => {
  proto.showModal = native.showModal;
  proto.close = native.close;
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const model = menuModel(new Date('2027-03-01T12:00:00Z'));
const open = () => document.querySelector('dialog[open]');

describe('S04 /menu', () => {
  it('h1 the page name under its cap, h2 the courses, h3 the 15 dishes; the lead, and no menu foot', () => {
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The Activity Menu');
    expect(screen.getByText('April to June 2027')).toBeTruthy();
    expect(
      screen.getByText(
        'Pick an activity. Tell me when works. I’ll lock one in, and I’m looking forward to seeing you.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Starters',
      'Mains',
      'Big Days',
      'Off the Menu',
    ]);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(15);
    expect(screen.getByText('Weekends are fine. Pick a date, and I’ll confirm.').className).toBe(
      'course-note',
    );
    expect(screen.queryByText('Every activity comes with the same side: time.')).toBeNull();
    expect(screen.queryByText(/Coffee, lunch and the first round are on me/)).toBeNull();
    expect(document.querySelector('.menu-foot')).toBeNull();
  });
  it('the Courses nav links each course by its section id', () => {
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    const nav = screen.getByRole('navigation', { name: 'Courses' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Starters', '#starters'],
      ['Mains', '#mains'],
      ['Big Days', '#big-days'],
      ['Off the Menu', '#off-the-menu'],
    ]);
    for (const id of ['starters', 'mains', 'big-days', 'off-the-menu'])
      expect(document.getElementById(id)?.getAttribute('aria-labelledby')).toBe(`${id}-h`);
  });
  it('rows are links to /book/{slug} with name, line and detail; every dish is a link, no Bluebird', () => {
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    const lunch = screen.getByRole('link', { name: /^The Long Lunch/ });
    expect(lunch.getAttribute('href')).toBe('/book/the-long-lunch');
    expect(lunch.textContent).toContain('2 hr · Thu/Fri, noon–2 pm');
    expect(lunch.querySelector('.nw')?.textContent).toBe('noon–2 pm');
    expect(screen.queryByText(/Bluebird/)).toBeNull();
    expect(screen.queryByText('Back with the snow')).toBeNull();
    expect(screen.getByRole('link', { name: /^A hike or nature moment/ }).getAttribute('href')).toBe(
      '/book/the-grind',
    );
    expect(document.querySelectorAll('li.dish a')).toHaveLength(15);
    expect(document.querySelector('.dish--off')).toBeNull();
  });
  it('a plain click opens the sheet: course cap, title, facts, next, Book {dish}; × closes it', () => {
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    // the click is handled (no navigation): fireEvent returns false when preventDefault ran
    expect(fireEvent.click(screen.getByRole('link', { name: /^The Double Date/ }))).toBe(false);
    const d = open() as HTMLElement;
    expect(d.id).toBe('d-the-double-date');
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('The Double Date');
    expect(within(d).getByText('Mains')).toBeTruthy();
    expect([...d.querySelectorAll('dt')].map((e) => e.textContent)).toEqual(['Length', 'Who', 'Serves']);
    expect([...d.querySelectorAll('dd')].map((e) => e.textContent)).toEqual([
      'an evening',
      'two couples',
      '4',
    ]);
    expect(within(d).getByText('Pick a date or two. Weekends are fine.')).toBeTruthy();
    expect(within(d).getByRole('link', { name: 'Book The Double Date' }).getAttribute('href')).toBe(
      '/book/the-double-date',
    );
    expect(d.querySelector('.sheet-in > .grab + figure.ph--sheet + .sheet-h')).toBeTruthy(); // pack s05 order
    expect(d.querySelector('figure.ph--sheet')?.getAttribute('data-slot')).toBe('double-date');
    fireEvent.click(within(d).getByRole('button', { name: 'Close The Double Date' }));
    expect(open()).toBeNull();
  });
  it('a new-tab click follows the link (no sheet)', () => {
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    expect(fireEvent.click(screen.getByRole('link', { name: /^The Encore/ }), { ctrlKey: true })).toBe(true);
    expect(open()).toBeNull();
  });
  it('the gate line stands where Book was (no invite / stale); off = neither', () => {
    render(<Menu model={model} gate={{ kind: 'note', text: ERRORS.noInvite }} />);
    fireEvent.click(screen.getByRole('link', { name: /^The Flat White/ }));
    const d = open() as HTMLElement;
    expect(within(d).queryByRole('link', { name: /^Book/ })).toBeNull();
    expect(within(d).getByText(ERRORS.noInvite)).toBeTruthy();
    cleanup();
    render(<Menu model={model} gate={{ kind: 'off' }} />);
    fireEvent.click(screen.getByRole('link', { name: /^The Flat White/ }));
    const e = open() as HTMLElement;
    expect(within(e).queryByRole('link', { name: /^Book/ })).toBeNull();
    expect(e.querySelectorAll('p.ui')).toHaveLength(1); // the next line only
  });
  it('/menu#<slug> opens that sheet after hydration; /menu#<section> opens none', async () => {
    window.history.replaceState(null, '', '/menu#pitch-me');
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(open()?.id).toBe('d-pitch-me');
    cleanup();
    window.history.replaceState(null, '', '/menu#big-days');
    render(<Menu model={model} gate={{ kind: 'book' }} />);
    await act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    expect(open()).toBeNull();
  });
  it('T4.6.04: the first dish photo (in the first screen on a phone) loads first; every other row photo is lazy', () => {
    const { container } = render(<Menu model={model} gate={{ kind: 'book' }} />);
    const rows = [...container.querySelectorAll('li.dish img')].map((img) => [
      img.getAttribute('loading'),
      img.getAttribute('fetchpriority'),
    ]);
    expect(rows[0]).toEqual(['eager', 'high']);
    expect(rows.slice(1).every(([loading, priority]) => loading === 'lazy' && priority === null)).toBe(true);
  });
});
