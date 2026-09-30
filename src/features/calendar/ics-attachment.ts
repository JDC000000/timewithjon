// src/features/calendar/ics-attachment.ts — T3.4.04 (AD-6 fallback): the .ics an E4c carries, built at SEND time
// from the row's vars (a snapshot of the booking taken when it was queued) and stamped with the row's created_at,
// so a retry sends the byte-identical file under the same provider idempotency key (like the pr40 H1 links).
import { getEnv } from '@/config/env';
import type { TemplateId } from '@/content/emails';
import type { OutgoingEmail } from '@/lib/adapters/types';
import { buildIcs } from './ics';

/** An E4c whose vars can't make a valid .ics: terminal like any other render failure (pr31 M3). */
export class IcsRenderError extends Error {
  override name = 'IcsRenderError';
}

/** The calendar name every invite shows as its organiser (NAMING.md), at the guest-facing From address. */
function organizer(): { name: string; email: string } {
  const from = getEnv().EMAIL_FROM_GUEST ?? '';
  const email = /<([^<>\s]+@[^<>\s]+)>/.exec(from)?.[1] ?? 'jon@timewithjon.com';
  return { name: 'Time with Jon', email };
}

export function emailAttachments(
  template: TemplateId,
  vars: Record<string, string | number>,
  to: string,
  stampedAt: Date,
): OutgoingEmail['attachments'] {
  if (template !== 'E4c') return undefined;
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
      organizer: organizer(),
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
