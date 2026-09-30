// src/app/admin/_requests/api.ts — the admin screens' one way to call their own JSON routes from the browser.
// Every admin route answers { ok: true, ... } or { ok: false, code, message } (src/lib/http.ts jsonError), checks
// Origin on writes, and is never cached. No secrets and no tokens pass through here.

export interface ApiAnswer<T = Record<string, unknown>> {
  /** 0 = the request never finished (offline, aborted). */
  status: number;
  /** The route's refusal code, e.g. 'bot_check', 'time_taken'. */
  code?: string;
  /** The route's own words for a refusal (e.g. REFUSAL_MESSAGE on a 409), when it sends any. */
  message?: string;
  data?: T;
}

export type Send = <T = Record<string, unknown>>(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  opts?: { keepalive?: boolean },
) => Promise<ApiAnswer<T>>;

export const send: Send = async <T>(
  method: string,
  url: string,
  body?: unknown,
  opts: { keepalive?: boolean } = {},
) => {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      // a save that must outlive the page (a note edit as the admin leaves): pr77-review F3
      keepalive: opts.keepalive ?? false,
    });
    const json = (await res.json().catch(() => null)) as
      ({ ok?: boolean; code?: string; message?: string } & Record<string, unknown>) | null;
    if (res.ok) return { status: res.status, data: (json ?? {}) as T };
    return { status: res.status, code: json?.code, message: json?.message };
  } catch {
    return { status: 0 };
  }
};
