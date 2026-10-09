'use client';
// src/ui/Button.tsx (T1.1a.U1): the pack's .btn (square, 52 px, ONE commit per screen), .textbtn and .link.
// Disabled = aria-disabled (stays focusable and announced); the click is swallowed, so a submit never fires.
import Link from 'next/link';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from './cx';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'disabled' | 'className' | 'children'>;

export type ButtonProps = Native & {
  /** 'gold': the open landing's one call to action (Jon, 2026-10-09), a gilt fill behind ink */
  variant?: 'default' | 'commit' | 'gold';
  size?: 'sm';
  block?: boolean;
  /** two-part label (<span>Lock in</span> <span>date</span>) */
  dt?: boolean;
  /** renders a next/link <a class="btn"> */
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  /** busy label (e.g. 'Sending…'): replaces the label and disables */
  busy?: string;
  className?: string;
  children?: ReactNode;
};

export function Button({
  variant = 'default',
  size,
  block,
  dt,
  href,
  type = 'button',
  disabled,
  busy,
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const cls = cx(
    'btn',
    variant === 'commit' && 'btn--commit',
    variant === 'gold' && 'btn--gold',
    size === 'sm' && 'btn--sm',
    block && 'btn--block',
    dt && 'btn--dt',
    className,
  );
  const off = disabled || busy !== undefined;
  const label = busy ?? children;
  const guard = (e: MouseEvent<HTMLElement>) => {
    if (off) {
      e.preventDefault();
      return;
    }
    onClick?.(e as MouseEvent<HTMLButtonElement>);
  };
  if (href !== undefined) {
    const { id, ...aria } = rest;
    return (
      <Link
        className={cls}
        href={href}
        id={id}
        aria-disabled={off || undefined}
        onClick={guard}
        {...(aria as object)}
      >
        {label}
      </Link>
    );
  }
  return (
    <button type={type} className={cls} aria-disabled={off || undefined} onClick={guard} {...rest}>
      {label}
    </button>
  );
}

export type TextButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & {
  type?: 'button' | 'submit';
  className?: string;
};

/** A secondary action as a text button (.textbtn, 44 px hit area). */
export function TextButton({ type = 'button', className, ...rest }: TextButtonProps) {
  return <button type={type} className={cx('textbtn', className)} {...rest} />;
}

/** An inline text link (.link). */
export function TextLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link className={cx('link', className)} href={href}>
      {children}
    </Link>
  );
}
