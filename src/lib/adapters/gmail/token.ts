// src/lib/adapters/gmail/token.ts — the access token GmailApiMailer sends with (pr36 F1). It comes from the Google
// connection (T3.3, #35): the test Gmail on staging, Jon's account in production after the gmail.send re-consent
// (GOOGLE_GMAIL_SEND=1). No grant with gmail.send, no connection, or a refused refresh (invalid_grant) is a config
// error: MailerNotConfiguredError (failed on the first try, slot refunded, resendable once fixed). A transient
// refresh failure is rethrown as is (retried by the tick).
import 'server-only';
import { gmailSendGranted, googleAccessToken, GoogleNotConnectedError } from '@/features/calendar/connection';
import { MailerNotConfiguredError } from '../errors';
import { GoogleApiError } from '../google/http';

export async function gmailAccessToken(): Promise<string> {
  if (!(await gmailSendGranted()))
    throw new MailerNotConfiguredError('gmail_api: the Google grant has no gmail.send scope');
  try {
    return await googleAccessToken();
  } catch (e) {
    if (e instanceof GoogleNotConnectedError)
      throw new MailerNotConfiguredError('gmail_api: Google not connected');
    if (e instanceof GoogleApiError && (e.reason === 'invalid_grant' || e.status === 401))
      throw new MailerNotConfiguredError('gmail_api: the Google grant was refused');
    throw e;
  }
}
