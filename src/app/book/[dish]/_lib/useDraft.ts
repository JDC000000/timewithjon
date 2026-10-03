'use client';
// QA M3: keep a flow's draft (draft.ts) across a reload or Back. After hydration the stored draft (if any) is handed
// to `restore` once (the flow drops what is no longer offered); from then on every change is written. Restoring
// after mount, not in the first render, keeps the server and client HTML the same.
import { useEffect, useEffectEvent, useRef } from 'react';
import { draftStore, readDraft, writeDraft, type Draft } from './draft';

export function useDraft(dish: string, draft: Draft, restore: (d: Draft) => void): void {
  const loaded = useRef(false);
  const json = JSON.stringify(draft);
  const onRestore = useEffectEvent(restore);
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      const d = readDraft(draftStore(), dish);
      if (d) onRestore(d);
      return;
    }
    writeDraft(draftStore(), dish, JSON.parse(json) as Draft);
  }, [dish, json]);
}
