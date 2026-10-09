// src/features/calendar/ics-attachment.ts — T3.4.04 (AD-6 fallback): the .ics an E4c carries, built at SEND time
// from the row's vars (a snapshot of the booking taken when it was queued) and stamped with the row's created_at,
// so a retry sends the byte-identical file under the same provider idempotency key (like the pr40 H1 links).
// CR-07: the ORGANIZER is the address the guest sees the email come from, which depends on the mailer that sends
// it: Resend sends from the guest-facing From address; Gmail rewrites From to the connected account, so under
// gmail_api the organiser is that account (else Gmail and Outlook show the invite as sent by someone other than its
// organiser, and replies go elsewhere). It is worked out once per booking, when its first .ics is queued, and kept
// in the vars (organizerEmail, ics-email.ts): every later update or cancel of the same UID, and every retry, keeps
// that organiser even if the mailer is switched in between. Rows queued before that carry none and are worked out
// at send time, as before.
import 'server-only';
import { getEnv } from '@/config/env';
import type { TemplateId } from '@/content/emails';
import { currentMailerMode } from '@/lib/adapters/mailer';
import type { OutgoingEmail } from '@/lib/adapters/types';
import { loadConnection } from './connection';
import { buildIcs } from './ics';

/** An E4c whose vars can't make a valid .ics: terminal like any other render failure (pr31 M3). */
export class IcsRenderError extends Error {
  override name = 'IcsRenderError';
}

/**
 * The calendar name every invite shows as its organiser (NAMING.md), at the address the email comes from: the
 * connected Google account under the Gmail mailer (it rewrites From to it), else the guest-facing From address.
 */
const ICS_ORGANIZER_NAME = 'Time with Jon';

export async function icsOrganizer(): Promise<{ name: string; email: string }> {
  const name = ICS_ORGANIZER_NAME;
  if ((await currentMailerMode()) === 'gmail_api') {
    const account = (await loadConnection())?.account_email;
    if (account) return { name, email: account };
  }
  const from = getEnv().EMAIL_FROM_GUEST ?? '';
  const email = /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? 'jon@timewithjon.com';
  return { name, email };
}

export async function emailAttachments(
  template: TemplateId,
  vars: Record<string, string | number>,
  to: string,
  stampedAt: Date,
): Promise<OutgoingEmail['attachments']> {
  if (template !== 'E4c') return undefined;
  const stored = typeof vars.organizerEmail === 'string' && vars.organizerEmail ? vars.organizerEmail : null;
  // a DB error in icsOrganizer() is not a render error: the row stays retryable
  const organizer = stored ? { name: ICS_ORGANIZER_NAME, email: stored } : await icsOrganizer();
  const method = vars.method;
  if (method !== 'REQUEST' && method !== 'CANCEL') throw new IcsRenderError('method');
  let ics: string;
  try {
    ics = buildIcs({
      method,
      requestId: String(vars.requestId),
      sequence: Number(vars.sequence),
      startsAt: new Date(String(vars.startsAt)),
      endsAt: new Date(String(vars.endsAt)),
      summary: String(vars.summary ?? ''),
      description: String(vars.description ?? ''),
      organizer,
      attendee: { name: String(vars.attendeeName ?? ''), email: to },
      now: stampedAt,
    });
  } catch (e) {
    throw new IcsRenderError(e instanceof Error ? e.message : 'ics');
  }
  return [
    {
      filename: 'invite.ics',
      content: Buffer.from(ics, 'utf8').toString('base64'),
      contentType: `text/calendar; charset=utf-8; method=${method}`,
    },
  ];
}
