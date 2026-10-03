'use client';
// src/ui/LateItalic.tsx (T4.6.04): mounted once by the root layout; adds Newsreader's italic after the page has loaded
// (src/ui/late-italic.ts). Renders nothing.
import { useEffect } from 'react';
import { installLateItalic } from './late-italic';

export function LateItalic() {
  useEffect(
    () =>
      installLateItalic({
        document,
        getComputedStyle: (el) => window.getComputedStyle(el),
        FontFace: window.FontFace,
        localStorage: window.localStorage,
        addEventListener: (type, cb, opts) => window.addEventListener(type, cb, opts),
        removeEventListener: (type, cb) => window.removeEventListener(type, cb),
        requestIdleCallback: window.requestIdleCallback?.bind(window),
        cancelIdleCallback: window.cancelIdleCallback?.bind(window),
        setTimeout: (cb, ms) => window.setTimeout(cb, ms),
        clearTimeout: (id) => window.clearTimeout(id),
      }),
    [],
  );
  return null;
}
