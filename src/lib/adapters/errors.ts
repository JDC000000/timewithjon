// src/lib/adapters/errors.ts — mailer errors shared by every Mailer. Names only reach email_log.last_error.

/** The provider refused the send because the daily or monthly quota is used up (AD-5 rule 6). Never retried. */
export class MailerQuotaError extends Error {
  override name = 'MailerQuotaError';
}

/** The provider answered with an error status. `status` lets the send path tell a definite refusal apart. */
export class MailerHttpError extends Error {
  override name = 'MailerHttpError';
  constructor(readonly status: number) {
    super(`mailer HTTP ${status}`);
  }
}

/**
 * The mailer for this mode can't be used (a missing key, an adapter that isn't built yet, or a token Gmail refuses:
 * 401, 403 insufficientPermissions). Never retried; the row stays resendable once fixed (pr36 F3).
 */
export class MailerNotConfiguredError extends Error {
  override name = 'MailerNotConfiguredError';
}

/** The message can never be built as given (a bad address, non-base64 attachment content). Never retried (pr36 F8). */
export class MailerInvalidMessageError extends Error {
  override name = 'MailerInvalidMessageError';
}
