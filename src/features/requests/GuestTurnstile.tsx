'use client';
// T1.7.U3 the guest form's Turnstile (AD-9), general invite only: `interaction-only` (invisible unless Cloudflare
// needs a click), `refresh-expired: auto` (an expired token refreshes itself), inside a box whose height is reserved
// from first paint so Send never shifts when a challenge appears. A token is single-use: `reset()` is called after
// ANY answer that is not a saved request (L11: a full slot, a validation error, a bot check, or no answer at all),
// so the next Send carries a fresh one. With no site key (local, mock mode) or on a personal invite there is no box.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TurnstileAction } from '@/lib/turnstile-actions';

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
/** How long Send waits for Cloudflare's token before posting without one (the server then answers bot_check). */
const TOKEN_WAIT_MS = 8000;

/** The widget options the contract fixes (exported for the test). */
export const GUEST_TURNSTILE_OPTS = {
  appearance: 'interaction-only',
  'refresh-expired': 'auto',
} as const;

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

/** `siteKey` undefined (a personal invite, or no key configured) = no widget, no token, `box` null. */
export function useGuestTurnstile(siteKey: string | undefined, action: TurnstileAction) {
  // A callback ref (state), so the widget renders once its box exists and no ref is read during render.
  const [el, setEl] = useState<HTMLDivElement | null>(null);
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
          ...GUEST_TURNSTILE_OPTS,
          action, // the route checks it: a token from another form is refused
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
  }, [siteKey, el, action]);

  /** The current token, waiting briefly for Cloudflare. Taken once: the next Send needs `reset()` first. */
  const takeToken = useCallback(async (): Promise<string | undefined> => {
    if (!siteKey) return undefined;
    const t =
      token.current ??
      (await new Promise<string | undefined>((resolve) => {
        const done = (v: string | undefined) => {
          waiters.current = waiters.current.filter((w) => w !== done);
          resolve(v);
        };
        waiters.current.push(done);
        setTimeout(() => done(token.current), TOKEN_WAIT_MS);
      }));
    token.current = undefined;
    return t;
  }, [siteKey]);

  /** L11: after any refusal (or no answer) the used token is dead; Cloudflare issues a new one. */
  const reset = useCallback(() => {
    token.current = undefined;
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);

  return { box: siteKey ? setEl : null, takeToken, reset };
}

/** The reserved box (site.css `.ts-slot`: the widget's full height from first paint, so Send never moves). */
export function TurnstileSlot({ box }: { box: (el: HTMLDivElement | null) => void }) {
  return <div className="ts-slot" ref={box} data-testid="turnstile-slot" />;
}
