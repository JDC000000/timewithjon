// sentry.server.config.ts — AD-11: server Sentry, strict data collection + the scrubber. Without a DSN it's off.
import * as Sentry from '@sentry/nextjs';
import { getEnv } from '@/config/env';
import { sentryOptions } from '@/lib/sentry-options';

const env = getEnv();
Sentry.init(sentryOptions(env.NEXT_PUBLIC_SENTRY_DSN, env.APP_MODE));
