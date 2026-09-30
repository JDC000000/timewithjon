// src/ui/List.tsx (T1.1a.U1): a list keyed by a stable id, never by position (INT-06: no lost clicks).
import { Fragment, type ReactNode } from 'react';

export type ListProps<T> = {
  items: readonly T[];
  getKey: (item: T) => string;
  /** returns the row, normally an <li> with the pack's markup */
  render: (item: T) => ReactNode;
  /** pack list classes: 'rows', 'actions', 'picks', 'chips'... */
  className?: string;
  as?: 'ul' | 'ol';
  /** shown instead of the rows when items is empty (an <li>) */
  empty?: ReactNode;
};

export function List<T>({ items, getKey, render, className, as: Tag = 'ul', empty }: ListProps<T>) {
  return (
    <Tag className={className}>
      {items.length ? items.map((item) => <Fragment key={getKey(item)}>{render(item)}</Fragment>) : empty}
    </Tag>
  );
}
