'use client';
// src/ui/Sheet.tsx (T1.1a.U1, R1-06): the pack's dialog.sheet: a bottom sheet on phones, a side panel on wide
// screens. Native modal <dialog> (the page behind is inert), focus lands on the title, Tab stays inside, Esc / × /
// the scrim / any [data-close] closes it, and focus returns to the invoker (src/ui/focus.ts).
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { moveFocus, tabStops, useReturnFocus } from './focus';

export type SheetProps = {
  id: string;
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** the caption above the title (pack s05: the course name) */
  cap?: ReactNode;
  /** the × button's name, e.g. 'Close The Long Lunch' */
  closeLabel: string;
  /** the foot row (pack a3c: Cancel) */
  footer?: ReactNode;
  /** above the title, under the grab bar (pack s05: the dish's sheet photo, a PhotoSlot kind="sheet") */
  media?: ReactNode;
  children?: ReactNode;
};

export function Sheet({ id, open, onClose, title, cap, closeLabel, footer, media, children }: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const openRef = useRef(open);
  /** set while a close WE started is pending: its close event (queued as a task) must not reach the owner */
  const selfClosing = useRef(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    openRef.current = open;
    closeRef.current = onClose;
  });

  useReturnFocus(open); // records the invoker before the effect below moves focus into the sheet
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      moveFocus(heading.current);
    } else if (!open && d.open) {
      selfClosing.current = true;
      d.close();
    }
  }, [open]);

  // Esc: the owner closes it (cancel is prevented), so React state and the dialog never disagree; an Esc followed at
  // once by a click on the opener can't leave `open` true with the dialog shut. If the browser closes it anyway (a
  // cancel it won't let us prevent), the close event tells the owner.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    const onNativeClose = () => {
      if (selfClosing.current) {
        selfClosing.current = false;
        return;
      }
      if (openRef.current) closeRef.current();
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onNativeClose);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onNativeClose);
    };
  }, []);

  const onClick = (e: MouseEvent<HTMLDialogElement>) => {
    const t = e.target as Element;
    if (t === e.currentTarget || t.closest('[data-close]')) onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const stops = tabStops(e.currentTarget);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (!first || !last) return;
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === heading.current)) {
      e.preventDefault();
      moveFocus(last, 'keyboard');
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      moveFocus(first, 'keyboard');
    }
  };

  const h = (
    <h2 className="h2" id={`${id}-h`} tabIndex={-1} ref={heading}>
      {title}
    </h2>
  );
  return (
    <dialog
      className="sheet"
      id={id}
      aria-labelledby={`${id}-h`}
      ref={dialog}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="sheet-in">
        <div className="grab" aria-hidden="true" />
        {media}
        <div className="sheet-h">
          {cap != null ? (
            <div>
              <p className="cap">{cap}</p>
              {h}
            </div>
          ) : (
            h
          )}
          <button className="x" type="button" data-close aria-label={closeLabel}>
            ×
          </button>
        </div>
        {children}
        {footer != null && <p className="sheet-f">{footer}</p>}
      </div>
    </dialog>
  );
}
