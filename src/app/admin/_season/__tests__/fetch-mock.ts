// A tiny fetch double for the A4/A6/A7 pane tests (a non-string body, e.g. a photo, is kept as is): answers by "METHOD path" prefix and records every call.
import { vi } from 'vitest';

export interface Call {
  method: string;
  url: string;
  body: unknown;
}
type Reply = { status?: number; json: unknown };

export function mockFetch(routes: Record<string, Reply | ((c: Call) => Reply)>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const c: Call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    };
    calls.push(c);
    const key = Object.keys(routes)
      .filter((k) => `${c.method} ${url}`.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const r = key ? routes[key]! : { status: 500, json: { ok: false } };
    const reply = typeof r === 'function' ? r(c) : r;
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

/** A text matcher for words KeepWhole splits into spans: the innermost element whose whole text is `t`. */
export const whole = (t: string) => (_: string, el: Element | null) =>
  el?.textContent === t && ![...el.children].some((c) => c.textContent === t);
