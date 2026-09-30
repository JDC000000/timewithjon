// src/lib/sentry-options.ts — AD-11 Sentry options shared by the server and browser init. Pure.
// Sentry v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect EVERYTHING (user info,
// cookies, headers, bodies, query strings, DB query data, stack locals). We turn all of it off, keep 4 harmless
// headers, and run the scrubber on top as a second layer. No Replay integration, ever.
import type { AppMode } from '@/config/env';
import { scrubBreadcrumb, scrubDsc, scrubEnvelopeHeader, scrubEvent, scrubSpan } from './sentry-scrub';

export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: ['user-agent', 'content-type', 'accept', 'accept-language'] },
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0, // no source lines around frames: they can quote literals
} as const;

/** Registers the DSC scrubber (createDsc) and the envelope-header scrubber (beforeEnvelope) on the client. */
const scrubDscIntegration = {
  name: 'TwjScrubDsc',
  setup(client: {
    on(hook: 'createDsc', cb: (dsc: { transaction?: string }) => void): unknown;
    on(hook: 'beforeEnvelope', cb: (envelope: [Record<string, unknown>, unknown]) => void): unknown;
  }) {
    client.on('createDsc', scrubDsc);
    client.on('beforeEnvelope', (envelope) =>
      scrubEnvelopeHeader(envelope[0] as { trace?: Record<string, unknown> }),
    );
  },
};

export function sentryOptions(dsn: string | undefined, environment: AppMode) {
  return {
    dsn, // undefined = Sentry stays off (e.g. before T0.1.10 stores the DSN)
    // T0.1.16: without this the SDK reports NODE_ENV ("production") for every build, so proto, staging and
    // production events were indistinguishable in the one Sentry project.
    environment,
    dataCollection: {
      ...SENTRY_DATA_COLLECTION,
      httpHeaders: {
        request: { allow: [...SENTRY_DATA_COLLECTION.httpHeaders.request.allow] },
        response: false,
      },
      httpBodies: [],
    },
    // T4.2.01a H1: no performance tracing (AD-11 doesn't need it), so no spans are sent at all. beforeSendSpan
    // is defence in depth for the day someone raises this: v11 streams spans past beforeSend.
    // T4.2.01a N1: a sampler, not a rate. With only `tracesSampleRate: 0`, an inbound `sentry-trace: …-1`
    // header re-enabled spans (the parent's decision is inherited), so anyone could burn the Sentry quota
    // and get real errors dropped. A sampler always decides, and it ignores `parentSampled`.
    tracesSampler: () => 0,
    integrations: <I>(defaults: I[]) => [...defaults, scrubDscIntegration as unknown as I],
    beforeSendSpan: <S extends Parameters<typeof scrubSpan>[0]>(span: S) => scrubSpan(span),
    beforeSend: <E extends Parameters<typeof scrubEvent>[0]>(event: E) => scrubEvent(event),
    beforeBreadcrumb: <B extends Parameters<typeof scrubBreadcrumb>[0]>(breadcrumb: B) =>
      scrubBreadcrumb(breadcrumb),
  };
}
