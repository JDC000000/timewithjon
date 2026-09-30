// T2.2.U1 A2 filter tabs (APG tabs, FOC-06 roving focus), driven by user-event only (never element.focus()).
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { FilterTabs, type FilterTab } from './FilterTabs';

const tabs: FilterTab[] = [
  { key: 'needs', label: 'Needs a reply', count: 2, panel: <a href="#p1">Priya</a> },
  { key: 'waiting', label: 'Waiting on them', count: 1, panel: <a href="#p2">Jamie</a> },
  { key: 'locked', label: 'Locked in', count: 0, panel: <p>None</p> },
];

let uninstall: () => void = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  window.history.replaceState(null, '', '/admin');
});
afterEach(() => {
  uninstall();
  cleanup(); // unmount React roots first: a live root's scheduler would fire after jsdom teardown
  document.body.innerHTML = '';
});

const renderTabs = (initial: FilterTab['key'] = 'needs') =>
  render(<FilterTabs head={<h1>Requests</h1>} tabs={tabs} label="Show" initial={initial} />);

describe('FilterTabs', () => {
  it('one tab stop: Tab lands on the selected tab, then goes to its panel', async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Needs a reply/ }));
    expect(screen.getByRole('tab', { name: /Needs a reply/ }).getAttribute('aria-selected')).toBe('true');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Priya' }));
  });

  it('arrows move and select (wrapping), Home/End jump; only the selected panel shows; the hash follows', async () => {
    const user = userEvent.setup();
    renderTabs();
    await user.tab();
    await user.keyboard('{ArrowRight}');
    const waiting = screen.getByRole('tab', { name: /Waiting on them/ });
    expect(document.activeElement).toBe(waiting);
    expect(waiting.getAttribute('aria-selected')).toBe('true');
    expect(waiting.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: /Needs a reply/ }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tabpanel', { name: /Waiting on them/ }).closest('[hidden]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Priya' })).toBeNull(); // hidden panel is out of the a11y tree
    expect(window.location.hash).toBe('#waiting');
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Locked in/ }));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Needs a reply/ }));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Locked in/ }));
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Needs a reply/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('a click selects without a history step; a deep link (#locked) opens that filter', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/admin#locked');
    const before = window.history.length;
    renderTabs();
    expect(screen.getByRole('tab', { name: /Locked in/ }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('tab', { name: /Waiting on them/ }));
    expect(screen.getByRole('tab', { name: /Waiting on them/ }).getAttribute('aria-selected')).toBe('true');
    expect(window.history.length).toBe(before);
  });

  it('each tab names its count; the list is labelled', () => {
    renderTabs();
    expect(screen.getByRole('tablist', { name: 'Show' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Needs a reply2' })).toBeTruthy();
  });
});
