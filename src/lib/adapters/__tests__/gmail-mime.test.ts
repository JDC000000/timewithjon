// T3.17.02: the MIME builder (headers, multipart/alternative, attachments, base64url) and GmailApiMailer.
import { describe, expect, it, vi } from 'vitest';
import { base64url, buildMime, encodeWord, formatAddress, type MimeInput } from '@/lib/adapters/gmail/mime';
import { createGmailApiMailer, GMAIL_SEND_URL } from '@/lib/adapters/gmail/mailer';
import {
  MailerHttpError,
  MailerInvalidMessageError,
  MailerNotConfiguredError,
  MailerQuotaError,
} from '@/lib/adapters/errors';

const BASE: MimeInput = {
  from: 'Jon <jon@timewithjon.com>',
  to: 'dave@example.com',
  replyTo: 'jon.personal@example.com',
  subject: 'Locked in: The Long Lunch, Thu May 13',
  text: 'See you then.\nJon\n',
  idempotencyKey: '7b0c4c1e-1111-4222-8333-944455556666', // gitleaks:allow (test fixture)
  date: new Date('2027-05-01T17:04:05Z'),
};
const headersOf = (mime: string) => mime.split('\r\n\r\n')[0]!;
const header = (mime: string, name: string) =>
  new RegExp(`^${name}: (.*(?:\\r\\n .*)*)$`, 'mi').exec(headersOf(mime))?.[1];
const decodeParts = (mime: string) =>
  [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?:\r\n--|$)/g)].map(
    (m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'),
  );

describe('buildMime', () => {
  it('text only: the headers, CRLF line ends, a base64 text/plain body', () => {
    const mime = buildMime(BASE);
    expect(header(mime, 'From')).toBe('"Jon" <jon@timewithjon.com>');
    expect(header(mime, 'To')).toBe('dave@example.com');
    expect(header(mime, 'Reply-To')).toBe('jon.personal@example.com');
    expect(header(mime, 'Subject')).toBe(BASE.subject);
    expect(header(mime, 'Date')).toBe('Sat, 01 May 2027 17:04:05 +0000');
    expect(header(mime, 'Message-ID')).toBe(`<${BASE.idempotencyKey}@timewithjon.com>`);
    expect(header(mime, 'MIME-Version')).toBe('1.0');
    expect(header(mime, 'Content-Type')).toBe('text/plain; charset=UTF-8');
    expect(mime.replace(/\r\n/g, '')).not.toMatch(/\n|\r/); // every line ends CRLF
    expect(decodeParts(mime)).toEqual([BASE.text]);
  });

  it('text + HTML: multipart/alternative, text first, then HTML', () => {
    const mime = buildMime({ ...BASE, html: '<p>See you then.</p>' });
    const ct = header(mime, 'Content-Type')!;
    const boundary = /boundary="([^"]+)"/.exec(ct)![1]!;
    expect(ct).toMatch(/^multipart\/alternative;/);
    expect(mime.split(`--${boundary}\r\n`)).toHaveLength(3);
    expect(mime.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    expect(mime.indexOf('text/plain')).toBeLessThan(mime.indexOf('text/html'));
    expect(decodeParts(mime)).toEqual([BASE.text, '<p>See you then.</p>']);
  });

  it('attachments: multipart/mixed around the body; the type and filename are sanitised', () => {
    const ics = Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n').toString('base64');
    const mime = buildMime({
      ...BASE,
      html: '<p>x</p>',
      attachments: [
        { filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST' },
        { filename: 'a"b\r\nX-Evil: 1.txt', content: 'QQ==', contentType: 'text/plain\r\nX-Evil: 1' },
      ],
    });
    expect(header(mime, 'Content-Type')).toMatch(/^multipart\/mixed; boundary="twj-mix-/);
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Content-Type: text/calendar; method=REQUEST; name="invite.ics"');
    expect(mime).toContain('Content-Disposition: attachment; filename="invite.ics"');
    expect(mime).toContain('Content-Type: application/octet-stream; name="a_b X-Evil_ 1.txt"');
    expect(mime).not.toMatch(/^X-Evil/m);
    expect(decodeParts(mime)).toContain('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
  });

  it('non-ASCII subject and display name become RFC 2047 words (≤ 75 chars, whole characters)', () => {
    const subject = 'Café with Zoë ☕ '.repeat(6);
    const mime = buildMime({ ...BASE, subject, from: 'Jön Cartwright <jon@timewithjon.com>' });
    const words = header(mime, 'Subject')!.split('\r\n ');
    expect(words.length).toBeGreaterThan(1);
    for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
    const decoded = words.map((w) => Buffer.from(/^=\?UTF-8\?B\?(.+)\?=$/.exec(w)![1]!, 'base64'));
    expect(Buffer.concat(decoded).toString('utf8')).toBe(subject);
    for (const d of decoded) expect(d.toString('utf8')).not.toContain('�'); // no split character
    expect(header(mime, 'From')).toMatch(/^=\?UTF-8\?B\?.+\?= <jon@timewithjon\.com>$/);
    expect(encodeWord('plain')).toBe('plain');
  });

  it('no header injection: line breaks flatten, extra headers cannot replace structural ones', () => {
    const mime = buildMime({
      ...BASE,
      subject: 'Hi\r\nBcc: evil@example.com',
      headers: {
        'X-Entity-Ref-ID': 'r1\r\nBcc: x@y.z',
        Bcc: 'evil@example.com',
        'bad name': 'x',
        'Reply-To': 'e@x.y',
      },
    });
    const h = headersOf(mime);
    expect(h).not.toMatch(/^Bcc:/im);
    expect(header(mime, 'Subject')).toBe('Hi Bcc: evil@example.com');
    expect(header(mime, 'X-Entity-Ref-ID')).toBe('r1 Bcc: x@y.z');
    expect(h.match(/^Reply-To:/gim)).toHaveLength(1);
    expect(h).not.toMatch(/^bad name/m);
  });

  it('addresses: quotes a plain name, refuses a malformed address', () => {
    expect(formatAddress('Time with Jon <admin@timewithjon.com>')).toBe(
      '"Time with Jon" <admin@timewithjon.com>',
    );
    expect(formatAddress('"Jon" <jon@timewithjon.com>')).toBe('"Jon" <jon@timewithjon.com>');
    expect(() => formatAddress('not an address')).toThrow();
    expect(() => formatAddress('a@b.c, evil@x.y')).toThrow();
  });

  it('every body line is at most 76 characters (base64 wrapped)', () => {
    const mime = buildMime({ ...BASE, text: 'x'.repeat(500), html: `<p>${'y'.repeat(500)}</p>` });
    const body = mime.slice(mime.indexOf('\r\n\r\n'));
    for (const line of body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  });

  it('pr36 F4: a crafted display name still yields exactly one recipient', () => {
    const to = formatAddress('a"<x@evil.com>, "b <v@x.com>');
    expect(to).toBe('"a<x@evil.com>, b" <v@x.com>');
    const outsideQuotes = to.replace(/"[^"]*"/g, '');
    expect(outsideQuotes).not.toContain(',');
    expect(outsideQuotes.match(/<[^>]+>/g)).toEqual(['<v@x.com>']); // A quoted non-ASCII name loses its quotes before RFC 2047 encoding (they aren't part of the name).
    const zoe = formatAddress('"Zoë" <z@example.com>');
    const word = /^=\?UTF-8\?B\?(.+)\?= <z@example\.com>$/.exec(zoe)![1]!;
    expect(Buffer.from(word, 'base64').toString('utf8')).toBe('Zoë');
  });

  it('pr36 F4: attachment base64 is wrapped at 76; the Message-ID keeps only safe characters', () => {
    const content = Buffer.alloc(150, 7).toString('base64'); // 200 chars, one line
    const mime = buildMime({
      ...BASE,
      idempotencyKey: 'a b<c>\r\n',
      attachments: [{ filename: 'x.bin', content, contentType: 'application/octet-stream' }],
    });
    for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
    expect(mime).toContain(content.slice(0, 76) + '\r\n' + content.slice(76, 152));
    expect(header(mime, 'Message-ID')).toBe('<abc@timewithjon.com>');
  });

  it('pr36 F7: the first encoded Subject line fits in 76 characters', () => {
    const mime = buildMime({ ...BASE, subject: 'Zoë '.repeat(40) });
    const lines = headersOf(mime).split('\r\n');
    const first = lines.find((l) => l.startsWith('Subject: '))!;
    expect(first.length).toBeLessThanOrEqual(76);
    expect(first.length).toBeGreaterThan(70); // chunks are as large as the limit allows
  });

  it('pr36 F8/F9: a non-ASCII or malformed address, or non-base64 attachment content, is MailerInvalidMessageError', () => {
    expect(() => formatAddress('zoë@example.com')).toThrow(MailerInvalidMessageError);
    expect(() => formatAddress('not an address')).toThrow(MailerInvalidMessageError);
    expect(() =>
      buildMime({
        ...BASE,
        attachments: [{ filename: 'i.ics', content: 'BEGIN:VCALENDAR', contentType: 'text/calendar' }],
      }),
    ).toThrow(MailerInvalidMessageError);
    expect(() =>
      buildMime({
        ...BASE,
        attachments: [{ filename: 'i.ics', content: 'QU\r\nJD', contentType: 'text/calendar' }],
      }),
    ).not.toThrow();
  });

  it('is deterministic for the same email (boundaries come from the idempotency key); base64url has no +/=', () => {
    expect(buildMime({ ...BASE, html: '<p>x</p>' })).toBe(buildMime({ ...BASE, html: '<p>x</p>' }));
    expect(base64url('ÿþ>>?')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('GmailApiMailer', () => {
  const EMAIL = { ...BASE, template: 'E4' as const };
  const make = (res: Response) => {
    const f = vi.fn(async () => res);
    const token = vi.fn(async () => 'ya29.token');
    return {
      f,
      token,
      m: createGmailApiMailer({ getAccessToken: token, fetch: f as never, now: () => BASE.date }),
    };
  };
  it('posts the raw message with the bearer token and returns the Gmail id', async () => {
    const { f, m } = make(new Response(JSON.stringify({ id: 'g123' }), { status: 200 }));
    expect(await m.send(EMAIL)).toEqual({ id: 'gmail:g123' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(GMAIL_SEND_URL);
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ya29.token' });
    const raw = JSON.parse(init.body as string).raw as string;
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toBe(buildMime(BASE));
  });
  it('never retries by itself (Gmail has no idempotency key)', async () => {
    const { f, m } = make(new Response('{}', { status: 503 }));
    const err = await m.send(EMAIL).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerHttpError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('a daily sending limit is a quota error (the next-UTC-day queue); a rate limit is not', async () => {
    const quota = {
      error: {
        code: 429,
        message: 'Daily user sending limit exceeded',
        errors: [{ reason: 'rateLimitExceeded' }],
      },
    };
    await expect(
      make(new Response(JSON.stringify(quota), { status: 429 })).m.send(EMAIL),
    ).rejects.toBeInstanceOf(MailerQuotaError);
    const daily = { error: { errors: [{ reason: 'dailyLimitExceeded' }] } };
    await expect(
      make(new Response(JSON.stringify(daily), { status: 403 })).m.send(EMAIL),
    ).rejects.toBeInstanceOf(MailerQuotaError);
    const rate = {
      error: { message: 'User-rate limit exceeded', errors: [{ reason: 'userRateLimitExceeded' }] },
    };
    const err = await make(new Response(JSON.stringify(rate), { status: 429 }))
      .m.send(EMAIL)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerHttpError);
    const forbidden = await make(new Response('nope', { status: 403 }))
      .m.send(EMAIL)
      .catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(MailerHttpError);
  });
  // SYNTHETIC fixtures (pr36 F6): shaped after Google's documented error bodies. Replace them with responses
  // recorded on staging at T3.17.03 (a 200, the 429 sending limit, a 403 insufficientPermissions).
  it('pr36 F2: the "(Mail sending)" lockout or a retry more than 1 h away is a quota; a short retry is not', async () => {
    const lockout = {
      error: {
        code: 429,
        message: 'User-rate limit exceeded.  Retry after 2027-05-02T09:00:00.000Z (Mail sending)',
        errors: [{ reason: 'rateLimitExceeded' }],
      },
    };
    await expect(
      make(new Response(JSON.stringify(lockout), { status: 429 })).m.send(EMAIL),
    ).rejects.toBeInstanceOf(MailerQuotaError);
    const later = (msg: string, init?: ResponseInit) =>
      make(new Response(JSON.stringify({ error: { message: msg } }), { status: 429, ...init }))
        .m.send(EMAIL)
        .catch((e: unknown) => e);
    // BASE.date = 2027-05-01T17:04:05Z
    expect(await later('Retry after 2027-05-01T18:05:00Z')).toBeInstanceOf(MailerQuotaError);
    expect(await later('Retry after 2027-05-01T18:04:00Z')).toBeInstanceOf(MailerHttpError); // < 1 h
    expect(await later('slow down', { headers: { 'retry-after': '7200' } })).toBeInstanceOf(MailerQuotaError);
    expect(await later('slow down', { headers: { 'retry-after': '60' } })).toBeInstanceOf(MailerHttpError);
    expect(
      await later('slow down', { headers: { 'retry-after': 'Sat, 01 May 2027 19:00:00 GMT' } }),
    ).toBeInstanceOf(MailerQuotaError);
    expect(await later('Your sending limit was reached')).toBeInstanceOf(MailerQuotaError);
    const other = await make(new Response(JSON.stringify(lockout), { status: 500 }))
      .m.send(EMAIL)
      .catch((e: unknown) => e);
    expect(other).toBeInstanceOf(MailerHttpError); // only a 429/403 can be a quota
  });

  it('pr36 F3: 401, or 403 insufficientPermissions/authError, is MailerNotConfiguredError; other 403s are not', async () => {
    const send = (status: number, reason?: string) =>
      make(
        new Response(JSON.stringify({ error: { message: 'x', errors: reason ? [{ reason }] : [] } }), {
          status,
        }),
      )
        .m.send(EMAIL)
        .catch((e: unknown) => e);
    expect(await send(401)).toBeInstanceOf(MailerNotConfiguredError);
    expect(await send(403, 'insufficientPermissions')).toBeInstanceOf(MailerNotConfiguredError);
    expect(await send(403, 'authError')).toBeInstanceOf(MailerNotConfiguredError);
    expect(await send(403, 'forbidden')).toBeInstanceOf(MailerHttpError);
    expect(await send(400, 'insufficientPermissions')).toBeInstanceOf(MailerHttpError);
  });

  it('pr36 F10: a 200 without an id is a 502 (retried), never "gmail:undefined"', async () => {
    for (const body of ['{}', '{"id":""}', '{"id":7}']) {
      const err = await make(new Response(body, { status: 200 }))
        .m.send(EMAIL)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MailerHttpError);
      expect((err as MailerHttpError).status).toBe(502);
    }
  });

  it('no token: nothing is built or sent', async () => {
    const f = vi.fn();
    const m = createGmailApiMailer({
      getAccessToken: async () => Promise.reject(new Error('no token')),
      fetch: f,
    });
    await expect(m.send(EMAIL)).rejects.toThrow('no token');
    expect(f).not.toHaveBeenCalled();
  });
});
