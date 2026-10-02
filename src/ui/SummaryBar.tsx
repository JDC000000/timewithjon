'use client';
// src/ui/SummaryBar.tsx (T1.7.U5, pack .sbar, components.md StickyBar): the phone-only sticky bar at the foot of a
// booking form. "N times picked · Your details ↓" jumps to the details; once the details are in view it switches to
// "Send", a submit of the same form (render it INSIDE the <form>). It hides while the keyboard is open (focus in a
// text field, or the visual viewport shrunk by a keyboard). Safe area + 400 % zoom + ≥1024 px: site.css .sbar.
import { useEffect, useState, type MouseEvent } from 'react';
import { Button } from './Button';
import { moveFocus } from './focus';

export interface SummaryBarProps {
  /** "2 times picked"; null hides the bar (nothing picked yet, as the pack draws it) */
  count: string | null;
  /** the id of the details block the link jumps to and whose arrival switches the bar to Send */
  detailsId: string;
  /** the field the jump lands on (a collapsed "Sending as" has none: the first control in the details instead) */
  jumpTo: string;
  /** "Your details ↓" (the arrow is decoration: hidden from assistive tech) */
  detailsLabel: string;
  sendLabel: string;
  /** the rest of Send's accessible name, visually hidden: the form's own Send keeps the plain name */
  sendRest: string;
  /** busy label while the form is sending (same as the form's Send) */
  busy?: string;
}

/** A keyboard takes this share of the layout viewport or more (visualViewport shrinks; innerHeight does not). */
const KEYBOARD_SHARE = 0.25;

/** Text entry opens an on-screen keyboard; checkboxes, radios and buttons do not. */
export function opensKeyboard(el: EventTarget | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'hidden', 'range', 'color', 'file'].includes(
    el.type,
  );
}

function keyboardUp(): boolean {
  const vv = window.visualViewport;
  return !!vv && vv.height < window.innerHeight * (1 - KEYBOARD_SHARE);
}

/** Focus in a text field or a shrunk visual viewport. A focusout during a press waits for the release, so the bar
 *  never appears under a pointer between down and up (the click would land on the bar, INT-06). */
function useKeyboardOpen(): boolean {
  const [typing, setTyping] = useState(false);
  const [shrunk, setShrunk] = useState(false);
  useEffect(() => {
    let pressing = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      pending = false;
      setTyping(opensKeyboard(document.activeElement));
    };
    const onIn = (e: FocusEvent) => {
      if (opensKeyboard(e.target)) setTyping(true);
    };
    const onOut = () => {
      if (pressing) pending = true;
      else {
        clearTimeout(timer);
        timer = setTimeout(settle, 0);
      }
    };
    const onDown = () => {
      pressing = true;
    };
    const onUp = () => {
      pressing = false;
      if (pending) {
        clearTimeout(timer);
        timer = setTimeout(settle, 0); // after the click that follows this release
      }
    };
    const onResize = () => setShrunk(keyboardUp());
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onUp, true);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onResize);
    onResize();
    settle(); // focus may already sit in a field (a restored page)
    return () => {
      clearTimeout(timer);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onUp, true);
      vv?.removeEventListener('resize', onResize);
    };
  }, []);
  return typing || shrunk;
}

/** The details are "in view" once they reach the top 65 % of the screen (pack site.js rootMargin). */
function useDetailsInView(id: string): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = document.getElementById(id);
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), {
      rootMargin: '0px 0px -35% 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [id]);
  return inView;
}

export function SummaryBar({
  count,
  detailsId,
  jumpTo,
  detailsLabel,
  sendLabel,
  sendRest,
  busy,
}: SummaryBarProps) {
  const keyboard = useKeyboardOpen();
  const inView = useDetailsInView(detailsId);
  const arrow = detailsLabel.match(/\s*↓$/)?.[0] ?? '';
  const words = detailsLabel.slice(0, detailsLabel.length - arrow.length);

  function jump(e: MouseEvent<HTMLAnchorElement>) {
    const details = document.getElementById(detailsId);
    const field =
      document.getElementById(jumpTo) ??
      details?.querySelector<HTMLElement>('input:not([type=hidden]):not([tabindex="-1"]), button, textarea');
    if (!field) return;
    e.preventDefault();
    field.scrollIntoView({ block: 'center' });
    moveFocus(field, 'script');
  }

  return (
    <div className="sbar" hidden={count === null || keyboard} data-mode={inView ? 'send' : 'details'}>
      <span className="count">{count}</span>
      {inView ? (
        // busy: the same 'Sending…' as the form's Send, disabled (aria-disabled swallows the click), name kept apart
        <Button size="sm" type="submit" disabled={busy !== undefined}>
          {busy ?? sendLabel}
          {busy === undefined && <span className="vh">{sendRest}</span>}
        </Button>
      ) : (
        <a className="btn btn--sm" href={`#${detailsId}`} onClick={jump}>
          {words}
          {arrow && <span aria-hidden="true">{arrow}</span>}
        </a>
      )}
    </div>
  );
}
