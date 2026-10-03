// src/lib/late-sentry.ts (T4.6.04): browser Sentry, loaded after the page has loaded. The SDK is about 55 KB gzipped;
// fetched and run with the page, it held back the first paint on a slow phone. With no DSN (Sentry off) it is never
// fetched. Errors thrown before it starts are kept (up to MAX_EARLY) and sent once it has started, through the same
// options and scrubber (src/lib/sentry-options.ts). Pure: the window and the SDK import are passed in.

/** The SDK calls this file makes (a subset of @sentry/nextjs). */
export type SentryClient = {
  captureException(error: unknown): unknown;
  captureRouterTransitionStart(href: string, navigationType: string): void;
};

/** The window APIs this needs, so the unit tests can pass fakes. */
export type LateSentryWindow = {
  document: Pick<Document, 'readyState'>;
  addEventListener(type: string, cb: (e: Event) => void, opts?: { once: true }): void;
  removeEventListener(type: string, cb: (e: Event) => void): void;
};

/** The most early errors kept for Sentry; later ones are dropped (a crash loop must not grow memory). */
export const MAX_EARLY = 10;

/**
 * Starts browser Sentry after the load event. `load` imports and initialises the SDK (null = no DSN: nothing loads).
 * Returns Next's onRouterTransitionStart hook, a no-op until the SDK is ready.
 */
export function installLateSentry(
  win: LateSentryWindow,
  load: (() => Promise<SentryClient>) | null,
): { onRouterTransitionStart: (href: string, navigationType: string) => void } {
  let client: SentryClient | undefined;
  const onRouterTransitionStart = (href: string, navigationType: string) =>
    client?.captureRouterTransitionStart(href, navigationType);
  if (!load) return { onRouterTransitionStart };

  const early: unknown[] = [];
  const keep = (e: Event) => {
    const error = 'reason' in e ? (e as PromiseRejectionEvent).reason : (e as ErrorEvent).error;
    if (error !== undefined && early.length < MAX_EARLY) early.push(error);
  };
  win.addEventListener('error', keep);
  win.addEventListener('unhandledrejection', keep);

  const start = () => {
    load().then(
      (sentry) => {
        // From here the SDK's own global handlers report errors.
        win.removeEventListener('error', keep);
        win.removeEventListener('unhandledrejection', keep);
        client = sentry;
        for (const error of early.splice(0)) sentry.captureException(error);
      },
      () => {
        // The SDK chunk failed to load (offline, blocked): the page works without it.
        win.removeEventListener('error', keep);
        win.removeEventListener('unhandledrejection', keep);
        early.length = 0;
      },
    );
  };
  if (win.document.readyState === 'complete') start();
  else win.addEventListener('load', start, { once: true });
  return { onRouterTransitionStart };
}
