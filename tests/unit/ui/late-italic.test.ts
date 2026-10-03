// T4.6.04: the late italic face (src/ui/late-italic.ts): added straight away for a browser that has loaded it before,
// otherwise only once the page has loaded and the main thread is idle; joined to the family next/font named.
import { describe, expect, it, vi } from 'vitest';
import {
  installLateItalic,
  ITALIC_SEEN_KEY,
  ITALIC_URL,
  voiceFamily,
  type LateItalicEnv,
} from '@/ui/late-italic';

function fakeEnv(
  opts: { seen?: boolean; readyState?: DocumentReadyState; idle?: boolean; family?: string } = {},
) {
  const added: { family: string; source: string; descriptors: FontFaceDescriptors }[] = [];
  const store = new Map<string, string>(opts.seen ? [[ITALIC_SEEN_KEY, '1']] : []);
  let resolveLoaded: () => void = () => {};
  const listeners: (() => void)[] = [];
  const idles: (() => void)[] = [];
  const timers: (() => void)[] = [];
  class FakeFontFace {
    loaded = new Promise<void>((r) => (resolveLoaded = r));
    constructor(
      public family: string,
      public source: string,
      public descriptors: FontFaceDescriptors,
    ) {}
  }
  const env: LateItalicEnv = {
    document: {
      readyState: opts.readyState ?? 'loading',
      documentElement: {} as HTMLElement,
      fonts: { add: (f: FakeFontFace) => added.push(f) } as unknown as FontFaceSet,
    },
    getComputedStyle: () => ({
      getPropertyValue: () => opts.family ?? `'newsreader', 'newsreader Fallback', ui-serif, Georgia, serif`,
    }),
    FontFace: FakeFontFace as unknown as typeof FontFace,
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    addEventListener: (_t, cb) => void listeners.push(cb),
    removeEventListener: vi.fn(),
    requestIdleCallback: opts.idle === false ? undefined : (cb) => idles.push(cb),
    cancelIdleCallback: vi.fn(),
    setTimeout: (cb) => timers.push(cb),
    clearTimeout: vi.fn(),
  };
  return { env, added, store, listeners, idles, timers, loaded: () => resolveLoaded() };
}

describe('voiceFamily', () => {
  it("reads the first family of --font-newsreader, quotes removed; null when it isn't set yet", () => {
    expect(voiceFamily(fakeEnv().env)).toBe('newsreader');
    expect(voiceFamily(fakeEnv({ family: '"__newsreader_abc123", serif' }).env)).toBe('__newsreader_abc123');
    expect(voiceFamily(fakeEnv({ family: '' }).env)).toBeNull();
  });
});

describe('installLateItalic', () => {
  it('first visit: nothing before the load event, then the italic once the main thread is idle', async () => {
    const f = fakeEnv();
    installLateItalic(f.env);
    expect(f.added).toHaveLength(0);
    f.listeners.forEach((cb) => cb());
    expect(f.added).toHaveLength(0);
    f.idles.forEach((cb) => cb());
    expect(f.added).toEqual([
      expect.objectContaining({
        family: 'newsreader',
        source: `url(${ITALIC_URL}) format("woff2")`,
        descriptors: { style: 'italic', weight: '200 800', display: 'swap' },
      }),
    ]);
    expect(f.store.has(ITALIC_SEEN_KEY)).toBe(false);
    f.loaded();
    await Promise.resolve();
    expect(f.store.get(ITALIC_SEEN_KEY)).toBe('1');
  });

  it('a page that has already loaded waits only for idle; no requestIdleCallback falls back to a timer', () => {
    const f = fakeEnv({ readyState: 'complete', idle: false });
    installLateItalic(f.env);
    expect(f.listeners).toHaveLength(0);
    expect(f.added).toHaveLength(0);
    f.timers.forEach((cb) => cb());
    expect(f.added).toHaveLength(1);
  });

  it('a browser that has loaded the italic before gets it straight away', () => {
    const f = fakeEnv({ seen: true });
    installLateItalic(f.env);
    expect(f.added).toHaveLength(1);
    expect(f.listeners).toHaveLength(0);
  });

  it('cleanup before load cancels the pending add', () => {
    const f = fakeEnv();
    const cleanup = installLateItalic(f.env);
    cleanup();
    expect(f.env.removeEventListener).toHaveBeenCalledWith('load', expect.any(Function));
  });

  it('blocked storage counts as a first visit and never throws', () => {
    const f = fakeEnv({ readyState: 'complete' });
    f.env.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => installLateItalic(f.env)).not.toThrow();
    expect(f.added).toHaveLength(0);
    f.idles.forEach((cb) => cb());
    expect(f.added).toHaveLength(1);
  });
});
