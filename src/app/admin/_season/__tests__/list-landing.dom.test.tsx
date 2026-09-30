// T2.5.U1, FOC-04 on the A4 list: after a save focus lands on the away card's Edit link (and it's spoken), after
// Back from a week on that week's row; a first visit leaves focus alone.
import { cleanup, render, screen } from '@testing-library/react';
import Link from 'next/link';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { ListLanding } from '../ListLanding';

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.restoreAllMocks();
});

const list = (saved: 'away' | 'off' | null) => (
  <ListLanding saved={saved}>
    <Link href="/admin/season/away">Edit away mode</Link>
    <Link href="/admin/season/week/2027-04-12">Week of Apr 12</Link>
    <Link href="/admin/season/week/2027-04-19">Week of Apr 19</Link>
  </ListLanding>
);

describe('ListLanding', () => {
  it('after away mode saves: the Edit link, and the URL loses ?saved', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    sessionStorage.setItem('twj-season-week', '2027-04-12');
    render(list('away'));
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Edit away mode' }));
    expect(replace).toHaveBeenCalledWith(window.history.state, '', '/admin/season');
  });

  it('after Back from a week: that week, once', () => {
    sessionStorage.setItem('twj-season-week', '2027-04-19');
    render(list(null));
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Week of Apr 19' }));
    expect(sessionStorage.getItem('twj-season-week')).toBeNull();
  });

  it('a first visit leaves focus where it is', () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    render(list(null));
    expect(document.activeElement).toBe(document.body);
    expect(replace).not.toHaveBeenCalled();
  });
});
