// src/lib/http.ts — shared route-handler helpers.
import { isIP } from 'node:net';
import { NextResponse, type NextRequest } from 'next/server';
import { getEnv } from '@/config/env';

/** Off Vercel there's no trusted client address (Route Handlers don't expose the socket), so every caller
 * shares one bucket: the limits still hold, they're just global. Client-set headers are never trusted. */
export const LOCAL_IP_BUCKET = 'local';

/**
 * AD-9 / T4.2.01a M2: the rate-limit key. On Vercel, the edge OVERWRITES X-Forwarded-For with the real client
 * IP and forwards no external IPs ("to prevent IP spoofing", vercel.com/docs/headers/request-headers), and
 * x-vercel-forwarded-for carries the same value but can't be overwritten by a proxy in front. We read those
 * two only (the rightmost hop, validated as an IP). x-real-ip is never read. Off Vercel: LOCAL_IP_BUCKET.
 */
export function clientIpFrom(headers: Headers, onVercel: boolean): string {
  if (!onVercel) return LOCAL_IP_BUCKET;
  const raw = headers.get('x-vercel-forwarded-for') ?? headers.get('x-forwarded-for') ?? '';
  const hop =
    raw
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
      .pop() ?? '';
  const version = isIP(hop);
  if (version === 6) return ipv6RateLimitKey(hop);
  return version === 4 ? hop : 'unknown';
}

/** A dotted IPv4 tail (`1.2.3.4`) as the two 16-bit hex groups it stands for. */
function dottedToGroups(dotted: string): string[] {
  const [a = 0, b = 0, c = 0, d = 0] = dotted.split('.').map(Number);
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
}

/**
 * Review L12: one IPv6 client normally holds a whole /64, so a per-/128 key would give it unlimited buckets.
 * The key is the /64 prefix in a canonical form (`2001:db8:0:1::/64`). Review L4: an IPv4-mapped address
 * (`::ffff:a.b.c.d`, `::ffff:cb00:7105`, `0:0:0:0:0:ffff:…`) keys as its IPv4, in any spelling.
 */
function ipv6RateLimitKey(ip: string): string {
  const addr = ip.toLowerCase().split('%')[0]!; // drop a zone id
  const groups = (part: string) =>
    part ? part.split(':').flatMap((g) => (g.includes('.') ? dottedToGroups(g) : [g])) : [];
  const [head = '', tail] = addr.split('::');
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const full = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right].map((g) =>
    parseInt(g, 16),
  );
  if (full.slice(0, 5).every((g) => g === 0) && full[5] === 0xffff) {
    return [full[6]! >> 8, full[6]! & 0xff, full[7]! >> 8, full[7]! & 0xff].join('.');
  }
  return `${full
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}
export function clientIp(req: NextRequest): string {
  return clientIpFrom(req.headers, getEnv().VERCEL === '1');
}
/** AD-7 / T2.7: every non-GET must come from our own origin. */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  return origin !== null && origin === new URL(getEnv().NEXT_PUBLIC_SITE_URL).origin;
}
export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, code, message }, { status });
}
/** Sign-in answers carry session cookies or one-time tokens: never cached (T2.1.04 review guarantee 6). */
export function noStore<T extends Response>(res: T): T {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

/** Answers to a request that carried an action token (the manage APIs): never cached, never a Referer (L3). */
export function tokenNoStore<T extends Response>(res: T): T {
  res.headers.set('Referrer-Policy', 'no-referrer');
  return noStore(res);
}

const UNSAFE_PATH = /[\\\u0000-\u001F\u007F]/;
/**
 * `next=` targets (M1): only same-origin relative paths. Refuses protocol-relative (`//x`), backslash tricks
 * (`/\\x`, which browsers and the URL parser treat as `//x`) and control characters, then re-checks the origin.
 */
export function safeRedirectTarget(next: string | null, siteUrl: string): URL {
  const site = new URL(siteUrl);
  const home = new URL('/', site);
  if (!next || !next.startsWith('/') || next.startsWith('//') || UNSAFE_PATH.test(next)) return home;
  const url = new URL(next, site);
  return url.origin === site.origin ? url : home;
}

/**
 * The most a public JSON body may be: the largest real one (a request with every field at its limit, in 3-byte
 * characters) is about 31 KB, so 64 KB leaves room and still stops a body near the platform's 4.5 MB ceiling
 * from being read whole.
 */
export const MAX_JSON_BYTES = 64 * 1024;

/**
 * The body's bytes, or null once it passes `max` bytes. A declared Content-Length over `max` is refused before any
 * read; a chunked body (no Content-Length) is read only up to `max`, never buffered whole.
 */
export async function readBytesAtMost(req: Request, max: number): Promise<Buffer | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** readJson's answer for a body over its limit (the route answers 413 with tooLarge()). */
export const BODY_TOO_LARGE: unique symbol = Symbol('body_too_large');

/**
 * The body parsed as JSON, read through readBytesAtMost: null when it isn't JSON (the route's Zod parse then
 * refuses it, as `req.json().catch(() => null)` did), BODY_TOO_LARGE past `max`.
 */
export async function readJson(req: Request, max = MAX_JSON_BYTES): Promise<unknown> {
  const bytes = await readBytesAtMost(req, max);
  if (bytes === null) return BODY_TOO_LARGE;
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** The 413 answer for a body over its limit. */
export function tooLarge(message: string) {
  return jsonError(413, 'too_large', message);
}
