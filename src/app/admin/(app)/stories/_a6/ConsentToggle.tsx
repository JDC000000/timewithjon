'use client';
// src/app/admin/(app)/stories/_a6/ConsentToggle.tsx — T2.9.U1: A6 "OK for the book" (wireframe 09 A6), Jon's consent
// (T2.9.01, consent_source = 'jon'). The box shows the new state at once; a refusal puts it back and says so. The
// list's meta line follows via router.refresh (the checkbox keeps its key, so a refresh never rebuilds it: INT-06).
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ERRORS } from '@/content';
import { STORIES } from '@/content/ui/admin-season';
import { announce, moveFocus } from '@/ui/focus';
import { setConsent } from './api';

export function ConsentToggle({
  storyId,
  who,
  consent,
  land = false,
}: {
  storyId: string;
  who: string;
  consent: boolean;
  /** arriving from "Not spam": focus lands on the box, and a reload doesn't repeat it (the query goes) */
  land?: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(consent);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const errId = `consent-${storyId}-e`;
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!land) return;
    moveFocus(box.current);
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [land]);

  const change = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem(false);
    setChecked(next);
    const ok = await setConsent(storyId, next);
    setBusy(false);
    if (!ok) {
      setChecked(!next);
      setProblem(true);
      return;
    }
    announce(STORIES.consentSaved(who, next));
    router.refresh();
  };

  return (
    <>
      <label className="check" style={{ marginTop: 'var(--s4)' }}>
        <input
          ref={box}
          type="checkbox"
          checked={checked}
          aria-describedby={errId}
          aria-invalid={problem || undefined}
          onChange={(e) => void change(e.target.checked)}
        />
        <span>{STORIES.ok}</span>
      </label>
      <p className="err" id={errId} role="alert" hidden={!problem}>
        {problem ? ERRORS.generic : null}
      </p>
    </>
  );
}
