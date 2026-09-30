// T3.4.04 (AD-6): the .ics an E4c carries is built at send time from the row alone: same row, same bytes.
import { describe, expect, it, vi } from 'vitest';
import { buildMime } from '@/lib/adapters/gmail/mime';
import { emailAttachments, IcsRenderError } from '../ics-attachment';

const env = vi.hoisted(() => ({ EMAIL_FROM_GUEST: 'Jon <jon@timewithjon.com>' as string | undefined }));
vi.mock('@/config/env', () => ({ getEnv: () => env }));

const ID = '0b7e5f7e-8c55-4a47-9d0a-3f1f6f0e2a11';
const vars = {
  dish: 'The Long Lunch',
  lead: 'x',
  method: 'REQUEST',
  requestId: ID,
  sequence: 2,
  startsAt: '2027-05-13T19:00:00.000Z',
  endsAt: '2027-05-13T21:00:00.000Z',
  summary: 'The Long Lunch: Dave',
  description: 'Crew: 3',
  attendeeName: 'Dave Guest',
};
const stamped = new Date('2026-10-01T12:34:56.000Z');
const ics = (v: Record<string, string | number>, to = 'dave@example.com') => {
  const [a] = emailAttachments('E4c', v, to, stamped)!;
  return { a: a!, text: Buffer.from(a!.content, 'base64').toString('utf8') };
};

describe('emailAttachments (E4c)', () => {
  it('only E4c carries an attachment', () => {
    expect(emailAttachments('E4', vars, 'dave@example.com', stamped)).toBeUndefined();
  });
  it('a REQUEST: the booking from the vars, the row stamp as DTSTAMP, the guest as attendee', () => {
    const { a, text } = ics(vars);
    expect(a.filename).toBe('invite.ics');
    expect(a.contentType).toBe('text/calendar; charset=utf-8; method=REQUEST');
    for (const line of [
      'METHOD:REQUEST',
      `UID:${ID}@timewithjon.com`,
      'SEQUENCE:2',
      'DTSTAMP:20261001T123456Z',
      'DTSTART:20270513T190000Z',
      'DTEND:20270513T210000Z',
      'SUMMARY:The Long Lunch: Dave',
      'DESCRIPTION:Crew: 3',
      'ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com',
      'STATUS:CONFIRMED',
    ])
      expect(text).toContain(`${line}\r\n`);
    expect(text).toContain('ATTENDEE;CN="Dave Guest";');
    expect(text).toContain(':mailto:dave@example.com\r\n');
  });
  it('a CANCEL says so in the file and in the content type', () => {
    const { a, text } = ics({ ...vars, method: 'CANCEL' });
    expect(a.contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
    expect(text).toContain('METHOD:CANCEL\r\n');
    expect(text).toContain('STATUS:CANCELLED\r\n');
  });
  it('the Gmail API mailer (staging, fallback) attaches it as a calendar invite, not an octet-stream', () => {
    const mime = buildMime({
      from: 'Jon <jon@timewithjon.com>',
      to: 'dave@example.com',
      replyTo: 'jon@example.com',
      subject: 'Calendar update: The Long Lunch',
      text: 'x',
      idempotencyKey: 'k',
      attachments: emailAttachments('E4c', vars, 'dave@example.com', stamped),
      date: stamped,
    });
    expect(mime).toContain('Content-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"');
  });
  it('the same row renders byte-identical (a retry sends the same file)', () => {
    expect(ics(vars).a.content).toBe(ics({ ...vars }).a.content);
  });
  it('the organiser is the guest-facing From address, or jon@ when it has none', () => {
    env.EMAIL_FROM_GUEST = 'Time with Jon <hello@example.org>';
    expect(ics(vars).text).toContain(':mailto:hello@example.org\r\n');
    env.EMAIL_FROM_GUEST = undefined;
    expect(ics(vars).text).toContain('ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n');
    env.EMAIL_FROM_GUEST = 'no address here';
    expect(ics(vars).text).toContain('ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n');
    env.EMAIL_FROM_GUEST = 'Jon <jon@timewithjon.com>';
  });
  it.each([
    ['an unknown method', { method: 'PUBLISH' }],
    ['no method', { method: undefined }],
    ['a bad start', { startsAt: 'not a date' }],
    ['an end before the start', { endsAt: '2027-05-13T18:00:00.000Z' }],
    ['a negative sequence', { sequence: -1 }],
    ['a request id that is not a uuid', { requestId: 'r1' }],
  ])('%s is an IcsRenderError (terminal: never sent, never retried)', (_, over) => {
    const v = { ...vars, ...over } as Record<string, string | number>;
    expect(() => emailAttachments('E4c', v, 'dave@example.com', stamped)).toThrow(IcsRenderError);
    try {
      emailAttachments('E4c', v, 'dave@example.com', stamped);
    } catch (e) {
      expect((e as Error).name).toBe('IcsRenderError');
    }
  });
});
