'use client';
// src/ui/Menu.tsx (T1.1a.U1, pack a3c from 600 px): the ⋯ APG menu button. Arrow keys / Home / End move, Esc closes
// back to ⋯, Tab and Shift+Tab close and move on from ⋯ (FOC-03, never to the skip link), a click outside closes.
// It opens below ⋯ (right edges aligned, 8 px gap) and flips up only when the room below is short; at 200% text it
// opens on the roomier side and scrolls inside (the pack's place()).
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from './cx';
import { moveFocus, nextTabStop, onTextSize } from './focus';

export type MenuItem = { key: string; label: ReactNode } & ({ href: string } | { onSelect: () => void });
export type MenuProps = {
  id: string;
  /** the ⋯ button's name, e.g. 'More for Priya' */
  buttonLabel: string;
  items: readonly MenuItem[];
  className?: string;
  /** rendered first inside .more-wrap (pack a3: the phone ⋯ button, .more--m, that opens a Sheet) */
  before?: ReactNode;
};

const GAP_PX = 8;

export function Menu({ id, buttonLabel, items, className, before }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [limit, setLimit] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const itemEls = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<number | null>(null);

  const itemAt = (i: number) => {
    const item = items[(i + items.length) % items.length];
    return item ? (itemEls.current.get(item.key) ?? null) : null;
  };

  const place = useCallback(() => {
    const b = button.current?.getBoundingClientRect();
    const m = menu.current;
    if (!b || !m) return;
    const h = m.scrollHeight;
    let floor = window.innerHeight;
    const tabbar = document.querySelector('.tabbar');
    if (
      tabbar instanceof HTMLElement &&
      tabbar.offsetHeight &&
      getComputedStyle(tabbar).position === 'fixed'
    ) {
      floor = Math.min(floor, tabbar.getBoundingClientRect().top);
    }
    const below = floor - b.bottom;
    if (below >= h + GAP_PX) {
      setUp(false);
      setLimit({});
    } else if (b.top - h - GAP_PX >= 0) {
      setUp(true);
      setLimit({});
    } else {
      const roomBelow = below - 2 * GAP_PX;
      const roomAbove = b.top - 2 * GAP_PX;
      setUp(roomAbove > roomBelow);
      setLimit({ maxHeight: Math.max(roomAbove, roomBelow), overflowY: 'auto' });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const off = onTextSize(place);
    window.addEventListener('resize', place);
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('click', outside);
    return () => {
      off();
      window.removeEventListener('resize', place);
      document.removeEventListener('click', outside);
    };
  }, [open, place]);

  // focus the requested item once the menu is shown
  useEffect(() => {
    if (!open || pendingFocus.current === null) return;
    moveFocus(itemAt(pendingFocus.current));
    pendingFocus.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = (i: number) => {
    if (open) {
      moveFocus(itemAt(i));
      return;
    }
    pendingFocus.current = i;
    setOpen(true);
  };
  const close = (back: boolean) => {
    setOpen(false);
    if (back) moveFocus(button.current);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      show(-1);
    }
  };

  const onItemKey = (i: number) => (e: KeyboardEvent<HTMLElement>) => {
    const k = e.key;
    let next: HTMLElement | null = null;
    if (k === 'ArrowDown') next = itemAt(i + 1);
    else if (k === 'ArrowUp') next = itemAt(i - 1);
    else if (k === 'Home') next = itemAt(0);
    else if (k === 'End') next = itemAt(items.length - 1);
    else if (k === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    } else if (k === 'Tab') {
      e.preventDefault();
      const from = button.current;
      const target = from ? (nextTabStop(from, e.shiftKey ? -1 : 1) ?? from) : null;
      close(false);
      moveFocus(target, 'keyboard');
      return;
    } else if (k === ' ' && e.currentTarget.tagName === 'A') {
      e.preventDefault();
      e.currentTarget.click();
      return;
    }
    if (next) {
      e.preventDefault();
      moveFocus(next, 'keyboard');
    }
  };

  const ref = (key: string) => (el: HTMLElement | null) => {
    if (el) itemEls.current.set(key, el);
    else itemEls.current.delete(key);
  };

  return (
    <span className={cx('more-wrap', className)}>
      {before}
      <button
        className="btn more more--d"
        type="button"
        id={`${id}-btn`}
        ref={button}
        aria-label={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close(true) : show(0))}
        onKeyDown={onButtonKey}
      >
        ⋯
      </button>
      <ul
        className={cx('popmenu', up && 'up')}
        role="menu"
        id={id}
        aria-labelledby={`${id}-btn`}
        hidden={!open}
        ref={menu}
        style={limit}
      >
        {items.map((item, i) => (
          <li role="none" key={item.key}>
            {'href' in item ? (
              <Link
                role="menuitem"
                tabIndex={-1}
                href={item.href}
                ref={ref(item.key)}
                onKeyDown={onItemKey(i)}
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                role="menuitem"
                tabIndex={-1}
                type="button"
                ref={ref(item.key)}
                onKeyDown={onItemKey(i)}
                onClick={() => {
                  item.onSelect();
                  close(true);
                }}
              >
                {item.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </span>
  );
}
