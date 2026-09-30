// FOC-04 on the A6/A7 panes: arriving on a detail lands on its heading and remembers it; news is spoken once and
// the query dropped; Back to the list lands on the remembered row; a pane that isn't the arrival leaves focus alone.
import { cleanup, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { LandingHeading, ListReturn } from '../Landing';

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  sessionStorage.clear();
  document.body.insertAdjacentHTML('beforeend', '<div id="live"></div>');
});
afterEach(() => {
  cleanup();
  uninstall();
  document.getElementById('live')?.remove();
  vi.restoreAllMocks();
});

describe('LandingHeading', () => {
  it('lands on the heading and remembers the detail', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(
      <LandingHeading returnKey="k" href="/admin/stories/s1">
        Priya
      </LandingHeading>,
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Priya' }));
    expect(sessionStorage.getItem('k')).toBe('/admin/stories/s1');
    expect(replace).not.toHaveBeenCalled();
  });

  it('speaks its news once and drops the query', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(
      <LandingHeading returnKey="k" href="/admin/stories/s1" say="Added to the book pile.">
        Priya
      </LandingHeading>,
    );
    expect(document.getElementById('live')!.textContent).toBe('Added to the book pile.');
    expect(replace).toHaveBeenCalledWith(window.history.state, '', window.location.pathname);
  });

  it('land={false}: focus and the remembered detail stay as they were', () => {
    sessionStorage.setItem('k', '/admin/settings/replies');
    render(
      <LandingHeading returnKey="k" href="/admin/settings/calendar" land={false}>
        Calendar
      </LandingHeading>,
    );
    expect(document.activeElement).toBe(document.body);
    expect(sessionStorage.getItem('k')).toBe('/admin/settings/replies');
  });
});

describe('ListReturn', () => {
  const list = () => (
    <ListReturn returnKey="k">
      <h1 tabIndex={-1}>Stories</h1>
      <Link href="/admin/stories/s1">Priya</Link>
      <Link href="/admin/stories/s2">Alex</Link>
    </ListReturn>
  );
  it('after Back: that row, once', () => {
    sessionStorage.setItem('k', '/admin/stories/s2');
    render(list());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Alex' }));
    expect(sessionStorage.getItem('k')).toBeNull();
  });
  it('after Back from a deleted story: the list title', () => {
    sessionStorage.setItem('k', '/admin/stories/s9');
    render(list());
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Stories' }));
  });
  it('a first visit leaves focus where it is', () => {
    render(list());
    expect(document.activeElement).toBe(document.body);
  });
});
