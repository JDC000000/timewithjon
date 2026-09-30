// src/lib/sentry-scrub.ts — AD-11 scrubber used by beforeSend/beforeBreadcrumb. Pure.
const SENSITIVE = /surprise_plan|note|phone|email|body|story|token|for/i;

export function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const i = url.indexOf('?');
  return i === -1 ? url : url.slice(0, i);
}
/** Sensitive keys become '[scrubbed]'; every other string leaf loses query strings, emails and IPs (N3). */
export function scrubObject<T>(v: T): T {
  if (typeof v === 'string') return scrubSpanText(v) as T;
  if (Array.isArray(v)) return v.map(scrubObject) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = SENSITIVE.test(k) ? '[scrubbed]' : scrubObject(x);
    return out as T;
  }
  return v;
}
const EMAIL = /[^\s@<>()"']+@[^\s@<>()"']+\.[^\s@<>()"']+/g;
const PG_KEY_DETAIL = /(Key \([^)]*\)=)\([^)]*\)/g;
/** Exception messages can quote row values (e.g. pg "Key (email)=(dave@...)"): redact emails and key values. */
export function scrubText(text: string): string {
  return text.replace(PG_KEY_DETAIL, '$1([scrubbed])').replace(EMAIL, '[email]');
}
/** Only these request headers survive (no IPs, no cookies, no referers, no auth). */
const HEADER_ALLOWLIST = new Set(['user-agent', 'content-type', 'accept', 'accept-language']);

// Spans (T4.2.01a H1). Sentry v11 streams spans past beforeSend, and Next.js's own span attributes (http.target,
// the span name) carry the raw path + query, which includes the invite secret (?for=) and any query-string PII.
const QUERY_IN_TEXT = /\?[^\s#"']*/g; // "GET /?for=x" -> "GET /"
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6 = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{0,4}\b/gi;
const SPAN_KEY_DROP =
  /cookie|authorization|client\.address|peer\.address|net\.sock\.peer|client_ip|real[_-]ip|forwarded|^user\.|url\.query|\.query$|referer/i;
const SPAN_HEADER = /^http\.(request|response)\.header\.(.+)$/i;

/** Query strings, emails, pg key values and IPs out of any free text that describes a request. */
export function scrubSpanText(text: string): string {
  return scrubText(text.replace(QUERY_IN_TEXT, '')).replace(IPV4, '[ip]').replace(IPV6, '[ip]');
}
function scrubSpanValue(v: unknown): unknown {
  if (typeof v === 'string') return scrubSpanText(v);
  if (Array.isArray(v)) return v.map(scrubSpanValue);
  if (v && typeof v === 'object' && 'value' in v)
    return { ...v, value: scrubSpanValue((v as { value: unknown }).value) };
  return v;
}
function keepSpanKey(key: string): boolean {
  const header = SPAN_HEADER.exec(key);
  if (header) return HEADER_ALLOWLIST.has(header[2]!.toLowerCase().replace(/_/g, '-'));
  return !SPAN_KEY_DROP.test(key);
}
/** beforeSendSpan: strip query strings, emails, IPs and sensitive attributes from a streamed span. */
export function scrubSpan<S extends { name: string; attributes?: Record<string, unknown> }>(span: S): S {
  span.name = scrubSpanText(span.name);
  if (span.attributes) {
    span.attributes = Object.fromEntries(
      Object.entries(span.attributes)
        .filter(([k]) => keepSpanKey(k))
        .map(([k, v]) => [k, scrubSpanValue(v)]),
    );
  }
  return span;
}

type Ev = {
  transaction?: string;
  tags?: Record<string, unknown>;
  user?: unknown;
  contexts?: unknown;
  exception?: { values?: { value?: string }[] };
  message?: string;
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: Record<string, string>;
  };
  extra?: Record<string, unknown>;
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
};
export function scrubEvent<E extends Ev>(event: E): E {
  delete event.user; // IP address, email
  delete event.contexts; // free-form; can hold form state
  if (event.request) {
    delete event.request.data;
    delete event.request.query_string;
    delete event.request.cookies;
    if (event.request.headers) {
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers).filter(([k]) => HEADER_ALLOWLIST.has(k.toLowerCase())),
      );
    }
    event.request.url = scrubUrl(event.request.url);
  }
  if (event.exception?.values)
    for (const v of event.exception.values) if (v.value) v.value = scrubSpanText(v.value); // N3: + queries, IPs
  if (event.message) event.message = scrubSpanText(event.message);
  if (event.tags) event.tags = scrubObject(event.tags);
  if (event.transaction) event.transaction = scrubSpanText(event.transaction); // "GET /?for=..." (T4.2.01a)
  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b));
  return event;
}
export function scrubBreadcrumb<B extends { message?: string; data?: Record<string, unknown> }>(b: B): B {
  if (b.message) b.message = scrubSpanText(b.message); // console breadcrumbs carry the logged text (N3)
  if (b.data) {
    b.data = scrubObject(b.data); // includes console `arguments`
    if (typeof b.data.url === 'string') b.data.url = scrubUrl(b.data.url);
  }
  return b;
}

/**
 * The dynamic sampling context rides in the header of EVERY envelope, errors included, and its `transaction` is the
 * root span name ("GET /?for=<invite secret>"). Found by the envelope test (T4.2.01a). Scrub it as it's created.
 */
export function scrubDsc(dsc: { transaction?: string }): void {
  if (dsc.transaction) dsc.transaction = scrubSpanText(dsc.transaction);
}

const DSC_KEEP = new Set([
  'trace_id',
  'public_key',
  'environment',
  'release',
  'sampled',
  'sample_rate',
  'sample_rand',
  'org_id',
  'transaction',
]);
/**
 * N2: an inherited ("frozen") DSC from inbound `baggage` never passes through createDsc, so it could echo
 * anything a requester sent. At the envelope level, keep only the known DSC keys and scrub the transaction.
 */
export function scrubEnvelopeHeader(header: { trace?: Record<string, unknown> }): void {
  if (!header.trace) return;
  const kept = Object.fromEntries(Object.entries(header.trace).filter(([k]) => DSC_KEEP.has(k)));
  if (typeof kept.transaction === 'string') kept.transaction = scrubSpanText(kept.transaction);
  header.trace = kept;
}
