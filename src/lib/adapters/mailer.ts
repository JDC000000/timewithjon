// src/lib/adapters/mailer.ts — T3.2.02: the real Mailer for staging and production. It follows
// system_status.mailer_mode ('resend' | 'gmail_api'; default resend in production, gmail_api in staging), read
// at most once a minute, so the operator can flip the AD-5 fallback with no deploy (T3.17 AC2).
import 'server-only';
import { getEnv, type AppMode } from '@/config/env';
import { q } from '@/lib/db';
import { MailerNotConfiguredError } from './errors';
import { createGmailApiMailer } from './gmail/mailer';
import { gmailAccessToken } from './gmail/token';
import { createResendMailer } from './resend/mailer';
import type { Mailer } from './types';

export const MAILER_MODES = ['resend', 'gmail_api'] as const;
export type MailerMode = (typeof MAILER_MODES)[number];
export const MAILER_MODE_KEY = 'mailer_mode';
export const MAILER_MODE_TTL_MS = 60_000;

/** Staging sends from the test Gmail. Prototype mirrors production (its mock stands in for Resend), so the AD-5
 * guard's limits there are Resend's (pr36 F5: the limits follow the mailer mode). */
export function defaultMailerMode(mode: AppMode): MailerMode {
  return mode === 'staging' ? 'gmail_api' : 'resend';
}

let cached: { mode: MailerMode; at: number } | null = null;
/** Tests only. */
export function resetMailerModeCache(): void {
  cached = null;
}

export async function currentMailerMode(now = Date.now()): Promise<MailerMode> {
  if (cached && now - cached.at < MAILER_MODE_TTL_MS) return cached.mode;
  const rows = await q<{ value: string | null }>('select value from system_status where key = $1', [
    MAILER_MODE_KEY,
  ]);
  const stored = rows[0]?.value;
  const mode = MAILER_MODES.find((m) => m === stored) ?? defaultMailerMode(getEnv().APP_MODE);
  cached = { mode, at: now };
  return mode;
}

export function mailerFor(mode: MailerMode): Mailer {
  if (mode === 'resend') {
    const apiKey = getEnv().RESEND_API_KEY;
    if (!apiKey) throw new MailerNotConfiguredError('resend');
    return createResendMailer({ apiKey });
  }
  return createGmailApiMailer({ getAccessToken: gmailAccessToken }); // T3.17
}

/** The Mailer handed out by adapters() outside prototype: picks the sender on every send. */
export const realMailer: Mailer = {
  async send(e) {
    return mailerFor(await currentMailerMode()).send(e);
  },
};
