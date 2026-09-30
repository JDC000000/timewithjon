// src/lib/adapters/gmail/mime.ts — T3.17.01: a pure RFC 5322 / MIME builder for the Gmail API (raw, base64url).
// text/plain, or multipart/alternative (text, then HTML), wrapped in multipart/mixed when there are attachments.
// Every body part is base64 (76-char lines), so no content line can look like a boundary. Header values are one
// line (flattenHeader) and RFC 2047-encoded when not ASCII; extra headers can't replace the structural ones.
import { createHash } from 'node:crypto';
import { flattenHeader } from '@/features/email/headers';
import { MailerInvalidMessageError } from '../errors';
import type { OutgoingEmail } from '../types';

const CRLF = '\r\n';
const ASCII = /^[\x20-\x7e]*$/;
const HEADER_NAME = /^[!-9;-~]+$/; // printable ASCII except ':'
const STRUCTURAL = new Set([
  'from',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'subject',
  'date',
  'message-id',
  'mime-version',
  'content-type',
  'content-transfer-encoding',
  'content-disposition',
]);
const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+(\s*;\s*[\w-]+=("[\w.+ -]*"|[\w.+-]+))*$/;

export type MimeInput = Pick<
  OutgoingEmail,
  'from' | 'to' | 'replyTo' | 'subject' | 'text' | 'html' | 'headers' | 'attachments' | 'idempotencyKey'
> & { date: Date };

export function base64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function wrap76(b64: string): string {
  return (b64.replace(/\s+/g, '').match(/.{1,76}/g) ?? []).join(CRLF);
}

/** RFC 2047 encoded-words (≤ 75 chars each, never splitting a character), folded; ASCII passes through. */
export function encodeWord(value: string): string {
  const v = flattenHeader(value);
  if (ASCII.test(v)) return v;
  const words: string[] = [];
  let chunk = '';
  for (const ch of v) {
    // 39 bytes → a 64-char word, so "Subject: " + the first word stays within RFC 2047's 76 (pr36 F7).
    if (Buffer.byteLength(chunk + ch) > 39) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join(`${CRLF} `);
}

/** "Name <addr>" or a bare address → a safe header address. The name is quoted or encoded. */
export function formatAddress(value: string): string {
  const m = /^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/.exec(flattenHeader(value));
  const addr = m ? m[2]! : flattenHeader(value).trim();
  // ASCII only (a UTF-8 local part would need SMTPUTF8): pr36 F8.
  if (!/^[\x21-\x7e]+$/.test(addr) || !/^[^\s<>"(),;:\\[\]]+@[^\s<>"(),;:\\[\]]+$/.test(addr))
    throw new MailerInvalidMessageError('bad address');
  const name = m?.[1]?.replace(/^"(.*)"$/, '$1') ?? '';
  if (!name) return addr;
  const shown = ASCII.test(name) ? `"${name.replace(/["\\]/g, '')}"` : encodeWord(name);
  return `${shown} <${addr}>`;
}

const BASE64 = /^[A-Za-z0-9+/=\s]*$/;
function base64Content(content: string): string {
  if (!BASE64.test(content)) throw new MailerInvalidMessageError('attachment content is not base64');
  return content;
}

function rfc5322Date(d: Date): string {
  return d.toUTCString().replace(/GMT$/, '+0000');
}

function safeFilename(name: string): string {
  return (
    flattenHeader(name)
      .replace(/[^\w.\- ]/g, '_')
      .slice(0, 100) || 'attachment'
  );
}

function textPart(contentType: string, body: string): string {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(body, 'utf8').toString('base64')),
  ].join(CRLF);
}

function multipart(kind: 'alternative' | 'mixed', boundary: string, parts: string[]): string {
  return [
    `Content-Type: multipart/${kind}; boundary="${boundary}"`,
    '',
    ...parts.map((p) => `--${boundary}${CRLF}${p}`),
    `--${boundary}--`,
    '',
  ].join(CRLF);
}

export function buildMime(m: MimeInput): string {
  const seed = createHash('sha256').update(m.idempotencyKey).digest('hex').slice(0, 24);
  const fromAddr = formatAddress(m.from);
  const domain = /@([^>]+)>?$/.exec(fromAddr)?.[1] ?? 'timewithjon.com';

  let body = m.html
    ? multipart('alternative', `twj-alt-${seed}`, [
        textPart('text/plain', m.text),
        textPart('text/html', m.html),
      ])
    : textPart('text/plain', m.text);
  if (m.attachments?.length) {
    const files = m.attachments.map((a) => {
      const type = CONTENT_TYPE.test(a.contentType) ? a.contentType : 'application/octet-stream';
      const name = safeFilename(a.filename);
      return [
        `Content-Type: ${type}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrap76(base64Content(a.content)),
      ].join(CRLF);
    });
    body = multipart('mixed', `twj-mix-${seed}`, [body, ...files]);
  }

  const extra = Object.entries(m.headers ?? {}).filter(
    ([k]) => HEADER_NAME.test(k) && !STRUCTURAL.has(k.toLowerCase()),
  );
  const headers = [
    `From: ${fromAddr}`,
    `To: ${formatAddress(m.to)}`,
    `Reply-To: ${formatAddress(m.replyTo)}`,
    `Subject: ${encodeWord(m.subject)}`,
    `Date: ${rfc5322Date(m.date)}`,
    `Message-ID: <${m.idempotencyKey.replace(/[^\w.-]/g, '')}@${domain}>`,
    'MIME-Version: 1.0',
    ...extra.map(([k, v]) => `${k}: ${encodeWord(v)}`),
  ];
  return `${headers.join(CRLF)}${CRLF}${body}`;
}
