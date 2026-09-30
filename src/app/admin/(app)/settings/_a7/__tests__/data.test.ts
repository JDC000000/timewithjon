// T3.3.U1: the Calendar group's state from oauth_connection (the same "broken" rule as the E14 banner:
// BROKEN_REASONS), and that only a state and a time leave (no account, token or calendar id).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock('@/lib/db', () => ({ q: db.q, withTx: vi.fn(), pool: vi.fn() }));
vi.mock('@/features/calendar/connection', async (orig) => ({
  ...(await orig<object>()),
  calendarName: () => 'Time with Jon (test)',
}));
const oauth = vi.hoisted(() => ({ configured: true }));
vi.mock('@/lib/adapters/google/oauth', () => ({ googleConfigured: () => oauth.configured }));

import { calendarStatus } from '../data';

const row = (over: Partial<{ connected: boolean; last_ok_at: Date | null; last_error: string | null }>) => [
  { connected: true, last_ok_at: new Date('2027-03-03T15:00:00Z'), last_error: null, ...over },
];

beforeEach(() => {
  db.q.mockReset();
  oauth.configured = true;
});

describe('calendarStatus', () => {
  it('no row = never connected (nothing to fix yet)', async () => {
    db.q.mockResolvedValue([]);
    expect(await calendarStatus()).toEqual({
      state: 'never',
      lastOkAt: null,
      calendarName: 'Time with Jon (test)',
      canConnect: true,
    });
    expect(String(db.q.mock.calls[0]![0])).not.toMatch(/account_email|calendar_id|refresh_token_enc\s*,/);
  });
  it('a healthy grant, and a passing hiccup (http_503), are connected', async () => {
    db.q.mockResolvedValue(row({}));
    expect(await calendarStatus()).toMatchObject({
      state: 'connected',
      lastOkAt: '2027-03-03T15:00:00.000Z',
    });
    db.q.mockResolvedValue(row({ last_error: 'http_503' }));
    expect((await calendarStatus()).state).toBe('connected');
  });
  it('a dead grant is broken; a dropped token is disconnected', async () => {
    db.q.mockResolvedValue(row({ last_error: 'invalid_grant' }));
    expect((await calendarStatus()).state).toBe('broken');
    db.q.mockResolvedValue(row({ connected: false, last_error: 'invalid_grant' }));
    expect((await calendarStatus()).state).toBe('disconnected');
  });
  it('without an OAuth client there is no Connect button', async () => {
    oauth.configured = false;
    db.q.mockResolvedValue([]);
    expect((await calendarStatus()).canConnect).toBe(false);
  });
});
