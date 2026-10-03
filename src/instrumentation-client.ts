// src/instrumentation-client.ts — AD-11: browser Sentry, strict data collection + the scrubber.
// T4.6.04: the SDK loads after the page has loaded (src/lib/late-sentry.ts), and not at all without a DSN.
import { publicEnv } from '@/config/public-env';
import { installLateSentry } from '@/lib/late-sentry';
import { sentryOptions } from '@/lib/sentry-options';

const dsn = publicEnv.NEXT_PUBLIC_SENTRY_DSN;

export const { onRouterTransitionStart } = installLateSentry(
  window,
  dsn
    ? () =>
        import('@sentry/nextjs').then((Sentry) => {
          Sentry.init(sentryOptions(dsn, publicEnv.APP_MODE));
          return Sentry;
        })
    : null,
);
