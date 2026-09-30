// src/app/admin/_requests/pending-lock.ts — PR-G (Jon's re-run, request 532722a3): the A3b lock that waits out its
// 10 s Undo window. Before, the POST went only when the window ended, so a reload, a link or a hidden tab inside
// it meant no lock at all, silently. Now leaving COMMITS it: pagehide, the tab going hidden and the pane unmounting
// all send the pending lock at once (keepalive, so it outlives the page). Undo still cancels inside the window.
// One commit per window, whoever fires first: the others get the same answer (or null if it was undone). No React.

export interface PendingCommit<P, R> {
  /** Opens a window for `payload`; false if one is already open (the second tap does nothing). */
  start(payload: P): boolean;
  /** Undo inside the window: true if it cancelled; false once it was committed (too late) or never opened. */
  undo(): boolean;
  /** Sends the pending payload once. null when nothing is pending (idle, undone, or already committed). */
  commit(): Promise<R> | null;
  pending(): boolean;
}

export function createPendingCommit<P, R>(send: (payload: P) => Promise<R>): PendingCommit<P, R> {
  let payload: P | null = null;
  return {
    start(p) {
      if (payload !== null) return false;
      payload = p;
      return true;
    },
    undo() {
      if (payload === null) return false;
      payload = null;
      return true;
    },
    commit() {
      if (payload === null) return null;
      const p = payload;
      payload = null;
      return send(p);
    },
    pending: () => payload !== null,
  };
}

/** Commits the pending lock when the page goes away or out of sight; returns the cleanup. */
export function commitOnLeave(
  commit: () => void,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> = document,
): () => void {
  const onHide = () => {
    if (doc.visibilityState === 'hidden') commit();
  };
  win.addEventListener('pagehide', commit);
  doc.addEventListener('visibilitychange', onHide);
  return () => {
    win.removeEventListener('pagehide', commit);
    doc.removeEventListener('visibilitychange', onHide);
  };
}
