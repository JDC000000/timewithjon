'use client';
// src/app/admin/auth/callback/ConfirmButton.tsx — A1c's one commit: "Sign me in", then "Sending…" once (pack
// VD3-15); a second press can't post twice. The browser's Back restoring the page resets it (pack B-1).
import { useEffect, useState } from 'react';
import { Button } from '@/ui';

export function ConfirmButton({ label, busyLabel }: { label: string; busyLabel: string }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  return (
    <Button
      variant="commit"
      block
      type="submit"
      busy={busy ? busyLabel : undefined}
      onClick={(e) => {
        if (busy) e.preventDefault();
        else setBusy(true);
      }}
    >
      {label}
    </Button>
  );
}
