// T3.4.04 (AD-6): the .ics an E4c carries is built at send time from the row alone: same row, same bytes.
// CR-07: its ORGANIZER is the address the email comes from under the mailer that sends it.
import { describe, expect, it, vi } from 'vitest';
import { buildMime } from '@/lib/adapters/gmail/mime';
import { emailAttachments, IcsRenderError } from '../ics-attachment';

const env = vi.hoisted(() => ({ EMAIL_FROM_GUEST: 'Jon <jon@timewithjon.com>' as string | undefined }));
vi.mock('@/config/env', () => ({ getEnv: () => env }));
const mailer = vi.hoisted(() => ({
  mode: 'resend' as 'resend' | 'gmail_api',
  account: 'sender@example.com' as string | null,
}));
vi.mock('@/lib/adapters/mailer', () => ({ currentMailerMode: async () => mailer.mode }));
vi.mock('../connection', () => ({
  loadConnection: async () => (mailer.account ? { account_email: mailer.account } : null),
}));

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
const ics = async (v: Record<string, string | number>, to = 'dave@example.com') => {
  const [a] = (await emailAttachments('E4c', v, to, stamped))!;
  return { a: a!, text: Buffer.from(a!.content, 'base64').toString('utf8') };
};

describe('emailAttachments (E4c)', () => {
  it('only E4c carries an attachment', async () => {
    expect(await emailAttachments('E4', vars, 'dave@example.com', stamped)).toBeUndefined();
  });
  it('a REQUEST: the booking from the vars, the row stamp as DTSTAMP, the guest as attendee', async () => {
    const { a, text } = await ics(vars);
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
  it('a CANCEL says so in the file and in the content type', async () => {
    const { a, text } = await ics({ ...vars, method: 'CANCEL' });
    expect(a.contentType).toBe('text/calendar; charset=utf-8; method=CANCEL');
    expect(text).toContain('METHOD:CANCEL\r\n');
    expect(text).toContain('STATUS:CANCELLED\r\n');
  });
  it('the Gmail API mailer (staging, fallback) attaches it as a calendar invite, not an octet-stream', async () => {
    const mime = buildMime({
      from: 'Jon <jon@timewithjon.com>',
      to: 'dave@example.com',
      replyTo: 'jon@example.com',
      subject: 'Calendar update: The Long Lunch',
      text: 'x',
      idempotencyKey: 'k',
      attachments: await emailAttachments('E4c', vars, 'dave@example.com', stamped),
      date: stamped,
    });
    expect(mime).toContain('Content-Type: text/calendar; charset=utf-8; method=REQUEST; name="invite.ics"');
  });
  it('the same row renders byte-identical (a retry sends the same file)', async () => {
    expect((await ics(vars)).a.content).toBe((await ics({ ...vars })).a.content);
  });
  it('under Resend the organiser is the guest-facing From address, or jon@ when it has none', async () => {
    env.EMAIL_FROM_GUEST = 'Time with Jon <hello@example.org>';
    expect((await ics(vars)).text).toContain(':mailto:hello@example.org\r\n');
    env.EMAIL_FROM_GUEST = undefined;
    expect((await ics(vars)).text).toContain('ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n');
    env.EMAIL_FROM_GUEST = 'no address here';
    expect((await ics(vars)).text).toContain('ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n');
    env.EMAIL_FROM_GUEST = 'Jon <jon@timewithjon.com>';
  });
  it('CR-07: under the Gmail mailer the organiser is the connected account, the address Gmail sends from', async () => {
    mailer.mode = 'gmail_api';
    try {
      expect((await ics(vars)).text).toContain('ORGANIZER;CN="Time with Jon":mailto:sender@example.com\r\n');
      // No connection (the send then fails as not configured anyway): the From address, as under Resend.
      mailer.account = null;
      expect((await ics(vars)).text).toContain('ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n');
    } finally {
      mailer.mode = 'resend';
      mailer.account = 'sender@example.com';
    }
  });
  it('a stored organiser (the first .ics of the booking) wins over the mailer of the moment, either way', async () => {
    const pinned = { ...vars, organizerEmail: 'jon@timewithjon.com' };
    const line = 'ORGANIZER;CN="Time with Jon":mailto:jon@timewithjon.com\r\n';
    mailer.mode = 'gmail_api'; // would give the connected account if worked out now
    try {
      expect((await ics(pinned)).text).toContain(line);
      expect((await ics({ ...pinned, method: 'CANCEL' })).text).toContain(line);
      const other = { ...vars, organizerEmail: 'sender@example.com' };
      mailer.mode = 'resend'; // would give the From address if worked out now
      expect((await ics(other)).text).toContain('ORGANIZER;CN="Time with Jon":mailto:sender@example.com\r\n');
      // A row from before (no stored organiser) is still worked out at send time.
      expect((await ics(vars)).text).toContain(line);
      mailer.mode = 'gmail_api';
      expect((await ics(vars)).text).toContain(':mailto:sender@example.com\r\n');
    } finally {
      mailer.mode = 'resend';
    }
  });
  it.each([
    ['an unknown method', { method: 'PUBLISH' }],
    ['no method', { method: undefined }],
    ['a bad start', { startsAt: 'not a date' }],
    ['an end before the start', { endsAt: '2027-05-13T18:00:00.000Z' }],
    ['a negative sequence', { sequence: -1 }],
    ['a request id that is not a uuid', { requestId: 'r1' }],
  ])('%s is an IcsRenderError (terminal: never sent, never retried)', async (_, over) => {
    const v = { ...vars, ...over } as Record<string, string | number>;
    await expect(emailAttachments('E4c', v, 'dave@example.com', stamped)).rejects.toThrow(IcsRenderError);
    await expect(emailAttachments('E4c', v, 'dave@example.com', stamped)).rejects.toMatchObject({
      name: 'IcsRenderError',
    });
  });
});
