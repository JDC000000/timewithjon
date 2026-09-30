'use client';
// src/ui/FocusRoot.tsx (U1): mounted once by the root layout. Installs the page-wide focus rules (src/ui/focus.ts),
// renders the text-size probe (.rem-probe) and the page's one polite live region (#live, used by announce()).
import { useEffect, useRef } from 'react';
import { installFocusGuard } from './focus';

export function FocusRoot() {
  const probe = useRef<HTMLSpanElement>(null);
  useEffect(() => installFocusGuard(probe.current), []);
  return (
    <>
      <span className="rem-probe" aria-hidden="true" ref={probe} />
      <div id="live" className="vh" aria-live="polite" />
    </>
  );
}
