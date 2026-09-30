'use client';
// src/app/admin/(app)/settings/_a7/ResyncButton.tsx — T3.15.U1 (A7 part): "Re-sync calendar" (wireframe 09 A7).
// POST /api/admin/google/resync puts every future locked booking on the calendar exactly once (T3.15.02); the line
// under the button says how many made it now (the tick finishes the rest). Focus stays on the button.
import { useState } from 'react';
import { CALENDAR } from '@/content/ui/admin-season';
import { Button } from '@/ui';
import { announce } from '@/ui/focus';
import { resyncCalendar } from './api';
import { resyncLine } from './model';

export function ResyncButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; line: string } | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    const next = resyncLine(await resyncCalendar());
    setBusy(false);
    setResult(next);
    announce(next.line);
  };

  return (
    <div style={{ marginTop: 'var(--s5)' }}>
      <Button
        onClick={() => void run()}
        busy={busy ? CALENDAR.resyncing : undefined}
        aria-describedby="resync-r"
      >
        {CALENDAR.resync}
      </Button>
      <p id="resync-r" className={result && !result.ok ? 'err' : 'help'} style={{ marginTop: 'var(--s2)' }}>
        {result?.line}
      </p>
    </div>
  );
}
