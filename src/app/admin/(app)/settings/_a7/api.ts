// src/app/admin/(app)/settings/_a7/api.ts — T2.9.U1 / T3.15.U1: the browser side of A7. Thin JSON calls to
// PATCH /api/admin/settings (T2.9.02) and POST /api/admin/google/resync (T3.15.02). Each route checks
// requireAdmin + Origin itself; nothing secret lives here.

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

/** Save A7b/A7c fields: ok, or the route's refusal code (e.g. 'personal_after_general'). */
export async function saveSettings(
  patch: object,
): Promise<{ ok: true } | { ok: false; code: string | null }> {
  const { status, data } = await call('PATCH', '/api/admin/settings', patch);
  if (status === 200) return { ok: true };
  const code = (data as { code?: unknown } | null)?.code;
  return { ok: false, code: typeof code === 'string' ? code : null };
}

/** A7 "Re-sync calendar": the status plus how many bookings were queued and synced inline. */
export async function resyncCalendar(): Promise<{ status: number; queued?: number; synced?: number }> {
  const { status, data } = await call('POST', '/api/admin/google/resync');
  const d = (data ?? {}) as { queued?: number; synced?: number };
  return { status, queued: d.queued, synced: d.synced };
}

/** A7 "Disconnect Google" (T3.3.05): the status, and whether Google heard the revoke. */
export async function disconnectGoogle(): Promise<{ status: number; revoked?: boolean }> {
  const { status, data } = await call('POST', '/api/admin/google/disconnect');
  const revoked = (data as { revoked?: unknown } | null)?.revoked;
  return { status, revoked: typeof revoked === 'boolean' ? revoked : undefined };
}
