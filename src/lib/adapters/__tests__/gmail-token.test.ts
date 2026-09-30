// pr36 F1: the Gmail mailer's token needs a Google grant that includes gmail.send; config problems fail closed.
import '../../../../tests/fixtures/unit-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailerNotConfiguredError } from '@/lib/adapters/errors';
import { GoogleApiError } from '@/lib/adapters/google/http';

const conn = vi.hoisted(() => ({ granted: vi.fn(), token: vi.fn() }));
vi.mock('@/features/calendar/connection', () => {
  class GoogleNotConnectedError extends Error {
    override name = 'GoogleNotConnectedError';
  }
  return { gmailSendGranted: conn.granted, googleAccessToken: conn.token, GoogleNotConnectedError };
});
const { gmailAccessToken } = await import('@/lib/adapters/gmail/token');
const { GoogleNotConnectedError } = await import('@/features/calendar/connection');

beforeEach(() => {
  conn.granted.mockReset();
  conn.token.mockReset();
});

describe('gmailAccessToken (pr36 F1)', () => {
  it('no gmail.send in the grant: MailerNotConfiguredError, and no token is fetched', async () => {
    conn.granted.mockResolvedValue(false);
    await expect(gmailAccessToken()).rejects.toBeInstanceOf(MailerNotConfiguredError);
    expect(conn.token).not.toHaveBeenCalled();
  });
  it('granted: the connection access token', async () => {
    conn.granted.mockResolvedValue(true);
    conn.token.mockResolvedValue('ya29.x');
    expect(await gmailAccessToken()).toBe('ya29.x');
  });
  it('not connected, invalid_grant or 401 is a config error; a 5xx stays retryable', async () => {
    conn.granted.mockResolvedValue(true);
    conn.token.mockRejectedValueOnce(new GoogleNotConnectedError('x'));
    await expect(gmailAccessToken()).rejects.toBeInstanceOf(MailerNotConfiguredError);
    conn.token.mockRejectedValueOnce(new GoogleApiError(400, 'invalid_grant', 'refresh'));
    await expect(gmailAccessToken()).rejects.toBeInstanceOf(MailerNotConfiguredError);
    conn.token.mockRejectedValueOnce(new GoogleApiError(401, '', 'refresh'));
    await expect(gmailAccessToken()).rejects.toBeInstanceOf(MailerNotConfiguredError);
    const e503 = new GoogleApiError(503, '', 'refresh');
    conn.token.mockRejectedValueOnce(e503);
    await expect(gmailAccessToken()).rejects.toBe(e503);
  });
});
