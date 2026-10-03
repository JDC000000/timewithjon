// src/ui/late-italic.ts (T4.6.04): Newsreader's italic face, added to the voice family after the page has loaded.
// On a slow phone the 145 KB italic otherwise downloads with the page's main photo and holds back its paint. Until the
// face arrives, italic text shows in the roman face (the accepted italic swap). Once the face has loaded, this browser
// has it cached: later page loads add it straight away, before the first paint in practice, so the swap is a
// first-visit effect.

/** The italic file, emitted by the bundler with a content hash (long-cached under /_next/static/media). */
export const ITALIC_URL = new URL('../../public/fonts/newsreader-italic.woff2', import.meta.url).href;
/** localStorage key: this browser has loaded the italic face before (no personal data). */
export const ITALIC_SEEN_KEY = 'twj_italic';

/** The browser APIs this needs, so the unit tests can pass fakes. */
export type LateItalicEnv = {
  document: Pick<Document, 'readyState' | 'documentElement' | 'fonts'>;
  getComputedStyle: (el: Element) => Pick<CSSStyleDeclaration, 'getPropertyValue'>;
  FontFace: typeof FontFace;
  localStorage: Pick<Storage, 'getItem' | 'setItem'>;
  addEventListener: (type: 'load', cb: () => void, opts: { once: true }) => void;
  removeEventListener: (type: 'load', cb: () => void) => void;
  requestIdleCallback?: (cb: () => void, opts: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

/** The voice family next/font named (the first name in --font-newsreader), or null before the font CSS applies. */
export function voiceFamily(env: Pick<LateItalicEnv, 'document' | 'getComputedStyle'>): string | null {
  const value = env.getComputedStyle(env.document.documentElement).getPropertyValue('--font-newsreader');
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  return first ? first : null;
}

function seen(env: LateItalicEnv): boolean {
  try {
    return env.localStorage.getItem(ITALIC_SEEN_KEY) === '1';
  } catch {
    return false; // storage blocked: treat as a first visit
  }
}

function addFace(env: LateItalicEnv): void {
  const family = voiceFamily(env);
  if (!family) return;
  const face = new env.FontFace(family, `url(${ITALIC_URL}) format("woff2")`, {
    style: 'italic',
    weight: '200 800',
    display: 'swap',
  });
  env.document.fonts.add(face);
  // The browser fetches the face the first time italic text needs it; remember it once it has arrived.
  face.loaded.then(
    () => {
      try {
        env.localStorage.setItem(ITALIC_SEEN_KEY, '1');
      } catch {
        // storage blocked: the next visit is a first visit again
      }
    },
    () => {}, // a failed fetch keeps the roman face for italic text; nothing to report
  );
}

/**
 * Adds the italic face: straight away when this browser has loaded it before, otherwise once the page has loaded
 * and the main thread is idle. Returns a cleanup that cancels a pending add (React effect cleanup).
 */
export function installLateItalic(env: LateItalicEnv): () => void {
  if (seen(env)) {
    addFace(env);
    return () => {};
  }
  let idle: number | undefined;
  let timer: number | undefined;
  const whenIdle = () => {
    if (env.requestIdleCallback) idle = env.requestIdleCallback(() => addFace(env), { timeout: 2000 });
    else timer = env.setTimeout(() => addFace(env), 200);
  };
  if (env.document.readyState === 'complete') whenIdle();
  else env.addEventListener('load', whenIdle, { once: true });
  return () => {
    env.removeEventListener('load', whenIdle);
    if (idle !== undefined) env.cancelIdleCallback?.(idle);
    if (timer !== undefined) env.clearTimeout(timer);
  };
}
