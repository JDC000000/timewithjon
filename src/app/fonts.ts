// src/app/fonts.ts (U1, T1.1b.U2): the three pack typefaces, self-hosted through next/font/local (served from our own
// origin, no Google request: G1 decision 15a). The CSS variables feed --font-voice / --font-ui in src/ui/tokens.css.
// Both faces are SIL OFL 1.1: the licences ship next to the files (public/fonts/OFL-*.txt).
import localFont from 'next/font/local';

export const newsreader = localFont({
  src: [
    { path: '../../public/fonts/newsreader-roman.woff2', style: 'normal', weight: '200 800' },
    { path: '../../public/fonts/newsreader-italic.woff2', style: 'italic', weight: '200 800' },
  ],
  variable: '--font-newsreader',
  display: 'swap',
  // a serif fallback while the face loads (the default is Arial): the voice stays a serif and the metrics barely shift
  adjustFontFallback: 'Times New Roman',
  fallback: ['ui-serif', 'Georgia', 'Times New Roman', 'serif'],
});

export const schibsted = localFont({
  src: [{ path: '../../public/fonts/schibsted-grotesk.woff2', style: 'normal', weight: '400 900' }],
  variable: '--font-schibsted',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});
