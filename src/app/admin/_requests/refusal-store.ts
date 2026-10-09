// src/app/admin/_requests/refusal-store.ts — QA4 H1 (c): a lock refused after its undo window, while Jon was already
// on another page (the keepalive POST answered after A3 unmounted), is never silent: its words wait in this tab's
// sessionStorage and A3 shows them when Jon opens that request again. The request itself stays in Needs a reply
// (a refused lock changes nothing). Survives client navigation; a full page unload can lose the answer itself.
const key = (requestId: string) => `twj_lock_refused:${requestId}`;
const EVENT = 'twj:lock-refused';

export function saveRefusal(requestId: string, message: string): void {
  try {
    sessionStorage.setItem(key(requestId), message);
  } catch {
    // private mode: nothing to keep it in
  }
  window.dispatchEvent(new Event(EVENT));
}

export function readRefusal(requestId: string): string | null {
  try {
    return sessionStorage.getItem(key(requestId));
  } catch {
    return null;
  }
}

export function clearRefusal(requestId: string): void {
  try {
    sessionStorage.removeItem(key(requestId));
  } catch {
    // nothing kept
  }
  window.dispatchEvent(new Event(EVENT));
}

export function onRefusal(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}
