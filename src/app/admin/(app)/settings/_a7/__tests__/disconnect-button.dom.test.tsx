// dec 55a: A7 "Disconnect Google": asks first, then POST /api/admin/google/disconnect; success lands on A7 with
// /admin/settings?google=… (the pane's notice, like the OAuth callback), a failure stays with a line. Cancel sends nothing.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERRORS } from '@/content';
import { CALENDAR } from '@/content/ui/admin-season';
import { installFocusGuard } from '@/ui/focus';
import { DisconnectButton } from '../DisconnectButton';
import { disconnectOutcome, googleResultLine } from '../model';

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

let uninstall = () => {};
beforeEach(() => {
  uninstall = installFocusGuard(null);
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  uninstall();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  router.replace.mockReset();
  router.refresh.mockReset();
});

const open = (mailer: 'resend' | 'gmail_api' = 'resend') => {
  render(<DisconnectButton mailer={mailer} />);
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Google' }));
};

describe('DisconnectButton', () => {
  it('asks first; "Keep it connected" sends nothing and brings the button back', () => {
    open();
    expect(screen.getByText(/^Disconnect Google\? New bookings go out as \.ics/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it connected' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeTruthy();
  });

  it('Yes: POSTs the disconnect route, then lands on A7 with the disconnected notice', async () => {
    answer(200, { ok: true, revoked: true });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin/settings?google=disconnected'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/google/disconnect',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it('revoked false (only forgotten here): lands on /admin/settings with the disconnected_here hint', async () => {
    answer(200, { ok: true, revoked: false });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/admin/settings?google=disconnected_here'),
    );
  });

  it('mailer gmail_api: the ask warns that emails and invites stop too (pr95 F3)', () => {
    open('gmail_api');
    expect(
      screen.getByText('Disconnect Google? Emails and invites stop sending until you reconnect.'),
    ).toBeTruthy();
    expect(screen.queryByText(/\.ics invites/)).toBeNull();
  });

  it('503 (Google not told): stays connected, says try again, the Yes button is live again', async () => {
    answer(503, { ok: false, code: 'revoke_unavailable' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await screen.findByText(/Google didn’t answer, so it’s still connected/);
    expect(router.replace).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Yes, disconnect' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('401 (session gone): the generic error line, no navigation', async () => {
    answer(401, { ok: false, code: 'unauthorized' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }));
    await waitFor(() => expect(document.getElementById('disconnect-r')?.className).toBe('err'));
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('disconnectOutcome', () => {
  it('maps the route answer to the A7 notice or a line', () => {
    expect(disconnectOutcome({ status: 200, revoked: true })).toEqual({ ok: true, google: 'disconnected' });
    expect(disconnectOutcome({ status: 200, revoked: false })).toEqual({
      ok: true,
      google: 'disconnected_here',
    });
    expect(disconnectOutcome({ status: 200 })).toEqual({ ok: true, google: 'disconnected' });
    expect(disconnectOutcome({ status: 503 })).toEqual({ ok: false, line: CALENDAR.disconnectRetry });
    expect(disconnectOutcome({ status: 0 })).toEqual({ ok: false, line: ERRORS.generic });
    expect(disconnectOutcome(null)).toMatchObject({ ok: false });
    expect(googleResultLine('disconnected')).toBe('Google is disconnected.');
    expect(googleResultLine('disconnected_here')).toMatch(/myaccount\.google\.com\/permissions/);
  });
});
