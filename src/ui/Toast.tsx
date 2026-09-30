'use client';
// src/ui/Toast.tsx (T1.1a.U1, pack a3b; FOC-01, FOC-05, INT-09): the undo toast. It reserves room at the foot of the
// page, lands focus on Undo with the toast in view, and counts down ONLY while at least half of it is on screen.
// Hover or the user's own focus inside pauses it (and resets the count); the programmatic landing never does.
// Undo is ignored for 600 ms (a double tap on the button that opened it can't land on Undo).
// What Undo and the end DO (the server call, the page swap, focus after) belongs to the screen that renders it.
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { keepVisible, moveFocus, onTextSize, resizeMayKeep, useInView } from './focus';

export type ToastProps = {
  message: ReactNode;
  /** the count line, e.g. (s) => `Invite goes out in ${s} s.` */
  sub: (secondsLeft: number) => ReactNode;
  /** shown instead of message + sub while paused */
  pausedText: ReactNode;
  undoLabel: string;
  /** visually hidden rest of Undo's name, e.g. ' lock-in for Priya' */
  undoVh?: string;
  seconds?: number;
  onUndo: () => void;
  onExpire: () => void;
  /** a status line that must stay above the toast, never under it (pack a3b 'Sending…', INT-09) */
  keepAbove?: RefObject<HTMLElement | null>;
  /** the region's accessible name; default: named by the message line (aria-labelledby) */
  label?: string;
};

const ARM_MS = 600;
const TICK_MS = 1000;
const GAP_PX = 8;

/** Room at the foot for a pinned toast (html.toast-on + --toast-clear); `above` ("Sending…") scrolled clear of it. */
function clearRoom(toast: HTMLElement | null, above: HTMLElement | null | undefined, noScroll = false) {
  const root = document.documentElement;
  if (!toast) return;
  if (getComputedStyle(toast).position !== 'fixed') {
    root.classList.remove('toast-on');
    return;
  }
  root.style.setProperty('--toast-clear', `${Math.ceil(toast.getBoundingClientRect().height)}px`);
  root.classList.add('toast-on');
  const r = above?.getBoundingClientRect();
  const t = toast.getBoundingClientRect();
  if (!noScroll && r && r.height && r.bottom > t.top - GAP_PX) {
    window.scrollBy({ top: Math.ceil(r.bottom - t.top + GAP_PX), behavior: 'instant' });
  }
}

export function Toast({
  message,
  sub,
  pausedText,
  undoLabel,
  undoVh,
  seconds = 10,
  onUndo,
  onExpire,
  keepAbove,
  label,
}: ToastProps) {
  const ids = useId();
  const msgId = `${ids}-msg`;
  const subId = `${ids}-sub`;
  const toast = useRef<HTMLDivElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const seen = useInView(toast, 0.5);
  const [left, setLeft] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const flags = useRef({
    over: false,
    mine: false,
    landing: false,
    landed: false,
    armed: false,
    ended: false,
    armTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  });

  // mount: room + the toast in view; a reload during the window lands like a first load
  useEffect(() => {
    const prev = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    clearRoom(toast.current, keepAbove?.current);
    keepVisible(toast.current);
    const root = document.documentElement;
    return () => {
      history.scrollRestoration = prev;
      root.classList.remove('toast-on');
      root.style.removeProperty('--toast-clear');
    };
  }, [keepAbove]);

  // the first time it is half on screen: focus on Undo (script focus, doesn't pause), and Undo arms 600 ms later.
  // The count runs whenever it is half on screen and not paused.
  useEffect(() => {
    const f = flags.current;
    if (!seen || f.landed) return;
    f.landed = true;
    f.landing = true;
    moveFocus(undo.current);
    f.landing = false;
    keepVisible(toast.current);
    f.armTimer = setTimeout(() => (f.armed = true), ARM_MS);
  }, [seen]);
  useEffect(() => {
    const f = flags.current;
    return () => clearTimeout(f.armTimer);
  }, []);

  useEffect(() => {
    if (paused || !seen) return;
    const tick = setInterval(() => setLeft((s) => s - 1), TICK_MS);
    return () => clearInterval(tick);
  }, [paused, seen]);

  useEffect(() => {
    const f = flags.current;
    if (left > 0 || f.ended) return;
    f.ended = true;
    document.documentElement.classList.remove('toast-on');
    onExpire();
  }, [left, onExpire]);

  // a resize or a text-size change mid-count: re-measure the room; scroll only per the shared resize rule
  useEffect(() => {
    const refit = (resize: boolean) => {
      const el = toast.current;
      if (flags.current.ended || !el?.isConnected) return;
      const a = document.activeElement;
      if (resize) {
        const keep = !!a && el.contains(a) && resizeMayKeep(a);
        clearRoom(el, keepAbove?.current, !keep);
        if (keep) {
          keepVisible(el);
          keepVisible(a);
        }
        return;
      }
      clearRoom(el, keepAbove?.current);
      if (!a || a === document.body || el.contains(a)) {
        keepVisible(el);
        if (a && el.contains(a)) keepVisible(a);
      }
    };
    const onResize = () => requestAnimationFrame(() => refit(true));
    const off = onTextSize(() => requestAnimationFrame(() => refit(false)));
    window.addEventListener('resize', onResize);
    return () => {
      off();
      window.removeEventListener('resize', onResize);
    };
  }, [keepAbove]);

  const pause = () => {
    if (flags.current.ended || flags.current.landing) return;
    setPaused(true);
    setLeft(seconds);
  };
  const resume = () => {
    const f = flags.current;
    if (f.ended || f.over || f.mine) return;
    setPaused(false);
  };

  return (
    <div
      className="toast"
      role="region"
      aria-label={label}
      aria-labelledby={label ? undefined : msgId}
      ref={toast}
      onMouseEnter={() => {
        flags.current.over = true;
        pause();
      }}
      onMouseLeave={() => {
        flags.current.over = false;
        resume();
      }}
      onFocus={() => {
        if (flags.current.landing) return;
        flags.current.mine = true;
        pause();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        flags.current.mine = false;
        setTimeout(resume, 0);
      }}
    >
      <p>
        {/* the message keeps the region's name steady (aria-labelledby reads it even while hidden) */}
        <span data-toast-msg="" id={msgId} hidden={paused}>
          {message}
        </span>
        {paused && <span data-toast-msg="">{pausedText}</span>}{' '}
        <span className="sub" data-toast-sub="" id={subId} hidden={paused}>
          {sub(left)}
        </span>
      </p>
      <button
        className="btn btn--sm"
        type="button"
        ref={undo}
        aria-describedby={`${msgId} ${subId}`}
        onClick={() => {
          const f = flags.current;
          if (!f.armed || f.ended) return;
          f.ended = true;
          document.documentElement.classList.remove('toast-on');
          onUndo();
        }}
      >
        {undoLabel}
        {undoVh && <span className="vh">{undoVh}</span>}
      </button>
    </div>
  );
}
