// T3.4.01 / pr39 F2 ruling: the real gateway's J2 attendee is the connected account (account_email), whatever
// JON_PERSONAL_EMAIL says; with no connection the write guard refuses before any Google call.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { realCalendar } from '../gateway'; // vi.mock calls below are hoisted above this import

vi.mock('@/config/env', () => ({ getEnv: () => ({ JON_PERSONAL_EMAIL: 'someone.else@example.com' }) }));
const loadConnection = vi.fn();
vi.mock('../connection', () => ({
  googleAccessToken: vi.fn(async () => 'at'),
  loadConnection: () => loadConnection(),
  forgetAccessToken: vi.fn(),
}));

const event = {
  requestId: '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31',
  summary: 's',
  description: '',
  startsAt: new Date('2027-05-13T19:30:00Z'),
  endsAt: new Date('2027-05-13T20:30:00Z'),
  attendees: ['sam@example.com'],
};

describe('realCalendar', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('J2 = the stored account_email, not JON_PERSONAL_EMAIL', async () => {
    loadConnection.mockResolvedValue({
      calendar_id: 'x@group.calendar.google.com',
      account_email: 'Jon@Example.com',
    });
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await realCalendar.insert(event);
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      attendees: unknown[];
    };
    expect(body.attendees).toEqual([
      { email: 'sam@example.com' },
      { email: 'jon@example.com', responseStatus: 'accepted' },
    ]);
  });

  it('not connected: refused by the write guard before any Google call', async () => {
    loadConnection.mockResolvedValue(null);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(realCalendar.insert(event)).rejects.toMatchObject({ name: 'CalendarWriteGuardError' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
