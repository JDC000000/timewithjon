// T3.3.U1 / T3.15.U1: the A7 Calendar group per state (wireframe 09 A7 connected, A7d not connected) and the A7d
// groups list. Connect/Reconnect are plain links to the connect route (it redirects to Google).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFocusGuard } from '@/ui/focus';
import { CalendarPane } from '../CalendarPane';
import type { CalendarStatus } from '../data';
import { SettingsList } from '../SettingsList';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('server-only', () => ({}));

const now = new Date('2026-03-04T22:00:00Z'); // Wed 2 pm Vancouver
const status = (over: Partial<CalendarStatus>): CalendarStatus => ({
  state: 'connected',
  lastOkAt: '2026-03-04T15:00:00Z',
  calendarName: 'Time with Jon',
  canConnect: true,
  ...over,
});
const pane = (s: CalendarStatus) =>
  render(<CalendarPane status={s} say={null} land back={null} mailer="resend" now={now} />);

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
});
afterEach(() => {
  cleanup();
  uninstall();
});

describe('CalendarPane', () => {
  it('connected: the facts, "checked 7 am", Re-sync, no Connect', () => {
    pane(status({}));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Calendar' }));
    expect(screen.getByText('Connected · checked 7 am')).toBeTruthy();
    expect(screen.getByText('Your personal main calendar')).toBeTruthy();
    expect(screen.getByText('Sent from Time with Jon; you’re an attendee')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Re-sync calendar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Connect Google/ })).toBeNull();
  });
  it('broken: not connected, the last good check, .ics meanwhile, Reconnect Google', () => {
    pane(status({ state: 'broken', lastOkAt: '2026-03-03T15:00:00Z' }));
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Tue 7 am')).toBeTruthy();
    expect(screen.getByText('New bookings go out as .ics invites')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reconnect Google' }).getAttribute('href')).toBe(
      '/api/admin/google/connect',
    );
    expect(screen.queryByRole('button', { name: 'Re-sync calendar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disconnect Google' })).toBeNull();
  });
  it('never connected: Connect Google, no last check; no OAuth client: no link', () => {
    pane(status({ state: 'never', lastOkAt: null }));
    expect(screen.getByRole('link', { name: 'Connect Google' })).toBeTruthy();
    expect(screen.queryByText('Last good check')).toBeNull();
    cleanup();
    pane(status({ state: 'never', lastOkAt: null, canConnect: false }));
    expect(screen.queryByRole('link', { name: /Google/ })).toBeNull();
  });
  it('news from Google shows in the pane', () => {
    render(
      <CalendarPane
        status={status({})}
        say="Google is connected."
        land
        back={null}
        mailer="resend"
        now={now}
      />,
    );
    expect(screen.getByText('Google is connected.', { selector: 'p' })).toBeTruthy();
  });
});

describe('SettingsList (A7)', () => {
  it('lists the groups (the A7d banner is the shell’s) and marks the current one', () => {
    render(<SettingsList current="calendar" />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/admin/settings/calendar',
      '/admin/settings/opening-times',
      '/admin/settings/replies',
    ]);
  });
});
