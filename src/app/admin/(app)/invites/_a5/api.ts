// src/app/admin/(app)/invites/_a5/api.ts — T2.6.U1: the browser side of A5. Thin JSON calls to the T2.6.03 routes;
// each route checks requireAdmin + Origin itself. Nothing secret lives here.
const INVITES = '/api/admin/invites';

async function json(method: string, url: string, body?: unknown): Promise<{ status: number; data: unknown }> {
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

export type CreateResult =
  { ok: true; name: string } | { ok: false; issues: { path: string; code: string }[] };

/** POST /api/admin/invites. A 400 carries `issues` (Zod path + code) for the boxes. */
export async function createInvite(body: unknown): Promise<CreateResult> {
  const { status, data } = await json('POST', INVITES, body);
  const d = data as { invite?: { name?: string | null }; issues?: unknown } | null;
  if (status === 201) return { ok: true, name: d?.invite?.name ?? '' };
  return {
    ok: false,
    issues: Array.isArray(d?.issues) ? (d.issues as { path: string; code: string }[]) : [],
  };
}

/** POST /api/admin/invites/[id]/revoke (idempotent). */
export async function revokeInvite(id: string): Promise<boolean> {
  return (await json('POST', `${INVITES}/${id}/revoke`)).status === 200;
}

/** POST /api/admin/invites/rotate-general: the old general link goes stale. */
export async function rotateGeneral(): Promise<boolean> {
  return (await json('POST', `${INVITES}/rotate-general`)).status === 200;
}
