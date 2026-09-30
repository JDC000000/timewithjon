// src/instrumentation-client.ts — AD-11: browser Sentry, strict data collection + the scrubber.
import * as Sentry from '@sentry/nextjs';
import { publicEnv } from '@/config/public-env';
import { sentryOptions } from '@/lib/sentry-options';

Sentry.init(sentryOptions(publicEnv.NEXT_PUBLIC_SENTRY_DSN, publicEnv.APP_MODE));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
