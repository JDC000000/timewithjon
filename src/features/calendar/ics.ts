// src/features/calendar/ics.ts — T3.4.03 (AD-6 fallback): an RFC 5545 iTIP invite for when Google can't be
// reached. UID `<request.id>@timewithjon.com` never changes for a booking, so a later REQUEST (SEQUENCE bumped)
// moves the same entry in the guest's calendar and a CANCEL removes it. Pure: no clock, no env, no I/O.

export type IcsMethod = 'REQUEST' | 'CANCEL';

export interface IcsInput {
  method: IcsMethod;
  requestId: string;
  sequence: number;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  description: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  /** DTSTAMP: when this version was made. */
  now: Date;
}

export const icsUid = (requestId: string) => `${requestId}@timewithjon.com`;

/** 20270513T193000Z */
export function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * TEXT values (RFC 5545 3.3.11): backslash, semicolon, comma and newlines are escaped; every other control
 * character (3.3.11 forbids them; TAB is allowed) is dropped, so a strict client never rejects the file (pr39 F6).
 */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A parameter value (CN): no control characters or DQUOTE; quoted, so ':' ';' ',' are safe (3.2). */
function paramValue(s: string): string {
  return `"${s.replace(/[\u0000-\u001f\u007f"]/g, '')}"`;
}

/** A mailto address: nothing that could end the line or the property. */
function mailto(email: string): string {
  return `mailto:${email.replace(/[\u0000-\u0020\u007f;:,"<>]/g, '')}`;
}

/** Fold at 75 octets (3.1), never inside a UTF-8 character; continuation lines start with one space. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = out.length === 0 ? 75 : 74; // a continuation's leading space counts toward its 75
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function buildIcs(i: IcsInput): string {
  if (!UUID.test(i.requestId)) throw new RangeError('UID needs a uuid request id');
  if (!Number.isInteger(i.sequence) || i.sequence < 0)
    throw new RangeError('SEQUENCE must be a whole number >= 0');
  if (!(i.endsAt > i.startsAt)) throw new RangeError('the event must end after it starts');
  const cancel = i.method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Time with Jon//timewithjon.com//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${i.method}`,
    'BEGIN:VEVENT',
    `UID:${icsUid(i.requestId)}`,
    `SEQUENCE:${i.sequence}`,
    `DTSTAMP:${icsDate(i.now)}`,
    `DTSTART:${icsDate(i.startsAt)}`,
    `DTEND:${icsDate(i.endsAt)}`,
    `SUMMARY:${escapeText(i.summary)}`,
    ...(i.description ? [`DESCRIPTION:${escapeText(i.description)}`] : []),
    `ORGANIZER;CN=${paramValue(i.organizer.name)}:${mailto(i.organizer.email)}`,
    `ATTENDEE;CN=${paramValue(i.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=${cancel ? 'FALSE' : 'TRUE'}:${mailto(i.attendee.email)}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
