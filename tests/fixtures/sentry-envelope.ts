// Shared by the Sentry envelope tests (T4.2.01a H1/M1). One Sentry.init per test FILE: re-initialising the
// SDK in the same process doesn't reliably reinstall its OpenTelemetry pipeline.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

export const CANARIES = [
  'k7q2m9xp', // the invite secret in ?for=dave-k7q2m9xp
  'leak-q@example.com',
  'dave@example.com',
  '203.0.113.9',
  'twj_invite=abc123',
  'bag-k7q2m9xp', // only in the attacker's inbound baggage (N2)
  'sentry-evil', // an unknown baggage key (N2)
];

// An inbound trace from a client that asks to be sampled, with hostile baggage (T4.2.01a N1/N2).
const INBOUND = {
  sentryTrace: '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
  baggage:
    'sentry-trace_id=0123456789abcdef0123456789abcdef,sentry-public_key=public,sentry-sampled=true,' +
    'sentry-sample_rate=1,sentry-transaction=GET%20%2F%3Ffor%3Dbag-k7q2m9xp,sentry-evil=bag-k7q2m9xp',
};

/** Real SDK, capturing transport (no network). Returns every envelope serialised as sent. */
export function initCapturing(overrides: Record<string, unknown> = {}): string[] {
  const envelopes: string[] = [];
  Sentry.init({
    ...sentryOptions('https://public@o1.ingest.sentry.io/1', 'prototype'),
    ...overrides,
    transport: () => ({
      send: async (envelope: unknown) => {
        envelopes.push(JSON.stringify(envelope));
        return {};
      },
      flush: async () => true,
    }),
  } as Parameters<typeof Sentry.init>[0]);
  return envelopes;
}

/** A guest-link request span with PII everywhere, an error inside it, and a message outside it. */
export async function sendTraffic(): Promise<void> {
  // N3: free text in console breadcrumbs, tags, extra and exception values.
  console.info('fetching /?for=dave-k7q2m9xp for 203.0.113.9');
  Sentry.setTag('path', '/?for=dave-k7q2m9xp');
  Sentry.setExtra('seen', 'dave@example.com at 203.0.113.9');
  Sentry.startSpan(
    {
      name: 'GET /?for=dave-k7q2m9xp',
      attributes: {
        'http.target': '/api/availability?dish=the-long-lunch&email=leak-q@example.com&for=dave-k7q2m9xp',
        'url.full': 'https://timewithjon.com/?for=dave-k7q2m9xp',
        'url.query': 'for=dave-k7q2m9xp',
        'http.request.header.cookie': 'twj_invite=abc123',
        'http.request.header.x_real_ip': '203.0.113.9',
        'http.request.header.user_agent': 'Mozilla/5.0',
        'client.address': '203.0.113.9',
        'app.note': 'from dave@example.com',
      },
    },
    () => {
      Sentry.captureException(new Error('duplicate key: Key (email)=(dave@example.com) already exists'));
      Sentry.captureException(new Error('lookup failed for /?for=dave-k7q2m9xp from 203.0.113.9'));
    },
  );
  // N1/N2: a request that arrives with a sampled sentry-trace and hostile baggage.
  Sentry.continueTrace(INBOUND, () =>
    Sentry.startSpan(
      { name: 'GET /api/availability', attributes: { 'http.target': '/api/availability' } },
      () => {
        Sentry.captureException(new Error('inside an inbound trace'));
      },
    ),
  );
  Sentry.captureMessage('send to leak-q@example.com failed');
  await Sentry.flush(2000);
}
