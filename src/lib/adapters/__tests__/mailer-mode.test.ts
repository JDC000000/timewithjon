// T3.2.02: the real Mailer follows system_status.mailer_mode, cached for 60 s; defaults by APP_MODE.
import '../../../../tests/fixtures/unit-env';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { q } from '@/lib/db';
import { MailerNotConfiguredError } from '@/lib/adapters/errors';
import {
  currentMailerMode,
  defaultMailerMode,
  mailerFor,
  MAILER_MODE_TTL_MS,
  resetMailerModeCache,
} from '@/lib/adapters/mailer';

vi.mock('@/lib/db', () => ({ q: vi.fn() }));
const db = vi.mocked(q);

beforeEach(() => {
  resetMailerModeCache();
  db.mockReset();
});

describe('mailer_mode', () => {
  it('defaults: resend in production, gmail_api in staging; prototype mirrors production (guard limits, pr36 F5)', () => {
    expect(defaultMailerMode('production')).toBe('resend');
    expect(defaultMailerMode('staging')).toBe('gmail_api');
    expect(defaultMailerMode('prototype')).toBe('resend');
  });
  it('reads system_status once a minute', async () => {
    db.mockResolvedValue([{ value: 'resend' }]);
    expect(await currentMailerMode(1_000)).toBe('resend');
    db.mockResolvedValue([{ value: 'gmail_api' }]);
    expect(await currentMailerMode(1_000 + MAILER_MODE_TTL_MS - 1)).toBe('resend');
    expect(db).toHaveBeenCalledTimes(1);
    expect(await currentMailerMode(1_000 + MAILER_MODE_TTL_MS)).toBe('gmail_api');
    expect(db).toHaveBeenCalledTimes(2);
  });
  it('an unknown or missing value falls back to the APP_MODE default', async () => {
    db.mockResolvedValue([{ value: 'smtp' }]);
    expect(await currentMailerMode(0)).toBe(defaultMailerMode('prototype'));
    resetMailerModeCache();
    db.mockResolvedValue([]);
    expect(await currentMailerMode(0)).toBe('resend'); // the unit env is prototype: mirrors production
  });
  it('resend with no RESEND_API_KEY refuses loudly; gmail_api refuses without a gmail.send grant', async () => {
    expect(() => mailerFor('resend')).toThrow(MailerNotConfiguredError);
    db.mockResolvedValue([]); // no oauth_connection row
    await expect(mailerFor('gmail_api').send({} as never)).rejects.toBeInstanceOf(MailerNotConfiguredError);
  });
});
