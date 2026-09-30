// src/ui/Stack.tsx (T1.1a.U1): the pack's .stack rhythm (.stack > * + * { margin-top: var(--s4) }).
import type { CSSProperties, ElementType, ReactNode } from 'react';
import { cx } from './cx';

export type StackProps = {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Stack({ as: Tag = 'div', className, style, children }: StackProps) {
  return (
    <Tag className={cx('stack', className)} style={style}>
      {children}
    </Tag>
  );
}
