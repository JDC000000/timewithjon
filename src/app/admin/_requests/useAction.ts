'use client';
// src/app/admin/_requests/useAction.ts — one admin action from a sheet or a confirm (T2.4/T2.10/T2.9 routes): busy
// while it runs (no double send), the route's own words on a refusal, else the generic line; on success the page
// re-reads the request (router.refresh) and a status line says what happened (wireframe 09 "Sent to Jordan").
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ERRORS } from '@/content';
import { announce } from '@/ui/focus';
import { send, type ApiAnswer } from './api';

export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (
    method: 'POST' | 'DELETE',
    url: string,
    body: unknown,
    done: {
      status: string;
      after?: () => void;
      /** A refusal the caller handles itself (e.g. one that asks for a tick): true = shown there, not here. */
      refused?: (res: ApiAnswer) => boolean;
    },
  ): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setProblem(null);
    const res = await send(method, url, body);
    setBusy(false);
    if (res.status !== 200) {
      if (done.refused?.(res)) return false;
      setProblem(res.status === 409 && res.message ? res.message : ERRORS.generic);
      return false;
    }
    done.after?.();
    announce(done.status);
    router.refresh();
    return true;
  };

  /** The action already went through elsewhere (e.g. the lock route): just say so and re-read. */
  const finished = (status: string) => {
    announce(status);
    router.refresh();
  };

  return { busy, problem, run, finished, clear: () => setProblem(null) };
}
