'use client';
// src/app/admin/sign-in/useTurnstile.ts — T2.1.U1 (AD-9): Cloudflare Turnstile on the sign-in email step,
// `interaction-only` (invisible unless Cloudflare needs a click). Each token is single-use, so every send takes
// the current one and resets the widget for the next ("Send a new code"). With no site key (local dev) there is
// no widget and no token: the server fails open only when its own secret is missing too.
import { useCallback, useEffect, useRef, useState } from 'react';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_WAIT_MS = 8000;

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    let s = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!s) {
      s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject()));
    s.addEventListener('error', () => reject());
  });
}

export function useTurnstile(siteKey: string | undefined) {
  // A callback ref (state), so the widget renders once its box exists and no ref is read during render.
  const [el, setContainer] = useState<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | undefined>(undefined);
  const waiters = useRef<((t: string | undefined) => void)[]>([]);

  useEffect(() => {
    if (!siteKey || !el) return;
    let gone = false;
    const settle = (t: string | undefined) => {
      token.current = t;
      if (t) waiters.current.splice(0).forEach((w) => w(t));
    };
    loadScript()
      .then((api) => {
        if (gone) return;
        widget.current = api.render(el, {
          sitekey: siteKey,
          appearance: 'interaction-only',
          callback: (t: string) => settle(t),
          'expired-callback': () => settle(undefined),
          'error-callback': () => settle(undefined),
        });
      })
      .catch(() => settle(undefined)); // blocked script: the server decides (a bot-check answer)
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, el]);

  /** The current token (waits briefly for Cloudflare), then resets the widget so the next send gets a new one. */
  const takeToken = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    const t =
      token.current ??
      (await new Promise<string | undefined>((resolve) => {
        waiters.current.push(resolve);
        setTimeout(() => resolve(token.current), TOKEN_WAIT_MS);
      }));
    token.current = undefined;
    if (widget.current) window.turnstile?.reset(widget.current);
    return t;
  }, [siteKey]);

  return { setContainer, takeToken };
}
