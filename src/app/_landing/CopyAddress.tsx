'use client';
// src/app/_landing/CopyAddress.tsx — the #story block's (and S13's) "Copy the address" (pack site.js data-copy): copies, says "Copied" on the
// same button (only when the copy worked) for 2.4 s and announces it once. The button is never re-keyed or swapped (INT-06).
import { useEffect, useRef, useState } from 'react';
import { COPY_ADDRESS } from '@/content/ui/landing';
import { TextButton } from '@/ui';
import { announce } from '@/ui/focus';

export const COPIED_MS = 2400;

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    // Clipboard can be missing (http) or refused (permissions): then the button keeps its label and nothing is
    // announced (no false "Copied"); the address is on screen either way (pack has no failure line).
    const ok = await (navigator.clipboard?.writeText(address).then(
      () => true,
      () => false,
    ) ?? Promise.resolve(false));
    if (!ok) return;
    setCopied(true);
    announce(COPY_ADDRESS.copiedSay(address));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <TextButton onClick={() => void onClick()}>
      {copied ? COPY_ADDRESS.copied : COPY_ADDRESS.label}
    </TextButton>
  );
}
