// T4.6.04: browser Sentry starts after the load event (src/lib/late-sentry.ts), never without a DSN, and errors thrown
// before it starts reach it once it has.
import { describe, expect, it, vi } from 'vitest';
import { installLateSentry, MAX_EARLY, type LateSentryWindow, type SentryClient } from '@/lib/late-sentry';

function fakeWindow(readyState: DocumentReadyState = 'loading') {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const win: LateSentryWindow = {
    document: { readyState },
    addEventListener: (type, cb) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type, cb) => void listeners.get(type)?.delete(cb),
  };
  const fire = (type: string, e: object = {}) => listeners.get(type)?.forEach((cb) => cb(e as Event));
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  return { win, fire, count };
}

function fakeSentry(): SentryClient & { captured: unknown[]; nav: [string, string][] } {
  const captured: unknown[] = [];
  const nav: [string, string][] = [];
  return {
    captured,
    nav,
    captureException: (e) => captured.push(e),
    captureRouterTransitionStart: (h, t) => void nav.push([h, t]),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('installLateSentry', () => {
  it('no DSN: nothing loads, nothing listens, the router hook is a no-op', () => {
    const w = fakeWindow();
    const { onRouterTransitionStart } = installLateSentry(w.win, null);
    expect(w.count('load') + w.count('error') + w.count('unhandledrejection')).toBe(0);
    expect(() => onRouterTransitionStart('/menu', 'push')).not.toThrow();
  });

  it('loads the SDK only after the load event, then sends the errors thrown before it', async () => {
    const w = fakeWindow();
    const sentry = fakeSentry();
    const load = vi.fn(async () => sentry);
    const { onRouterTransitionStart } = installLateSentry(w.win, load);
    const boom = new Error('early');
    w.fire('error', { error: boom });
    w.fire('unhandledrejection', { reason: 'rejected' });
    onRouterTransitionStart('/menu', 'push'); // before the SDK: dropped
    expect(load).not.toHaveBeenCalled();
    w.fire('load');
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(sentry.captured).toEqual([boom, 'rejected']);
    expect(w.count('error') + w.count('unhandledrejection')).toBe(0); // the SDK's own handlers take over
    onRouterTransitionStart('/sent', 'replace');
    expect(sentry.nav).toEqual([['/sent', 'replace']]);
  });

  it('a page that has already loaded starts it straight away', async () => {
    const w = fakeWindow('complete');
    const load = vi.fn(async () => fakeSentry());
    installLateSentry(w.win, load);
    expect(load).toHaveBeenCalledOnce();
    expect(w.count('load')).toBe(0);
  });

  it(`keeps at most ${MAX_EARLY} early errors`, async () => {
    const w = fakeWindow();
    const sentry = fakeSentry();
    installLateSentry(w.win, async () => sentry);
    for (let i = 0; i < MAX_EARLY + 5; i++) w.fire('error', { error: new Error(String(i)) });
    w.fire('load');
    await settle();
    expect(sentry.captured).toHaveLength(MAX_EARLY);
  });

  it('an SDK that fails to load stops listening and never throws', async () => {
    const w = fakeWindow('complete');
    installLateSentry(w.win, () => Promise.reject(new Error('offline')));
    await settle();
    expect(w.count('error') + w.count('unhandledrejection')).toBe(0);
  });
});
