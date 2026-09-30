// src/app/admin/_season/api.ts — T2.5.U1: the browser side of the A4 panes. Thin JSON calls to the existing admin
// routes (src/app/api/admin/season/**, T2.5.01-.05; the stand-by offer, T2.4.04). Every route checks requireAdmin +
// Origin itself; nothing secret lives here.

export interface Affected {
  id: string;
  contactName: string;
  startsAt: string;
  endsAt: string;
}

export interface BlockRange {
  startDate: string;
  endDate: string;
  kind: 'blocked' | 'away';
  confirmBy?: string | null;
}

export type ApiResult =
  | { ok: true; underWay: Affected[] }
  | { ok: false; locked: true; affected: Affected[]; underWay: Affected[] }
  | { ok: false; locked: false };

async function call(method: string, url: string, body?: unknown): Promise<ApiResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, locked: false };
  }
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    code?: string;
    affected?: Affected[];
    underWay?: Affected[];
  } | null;
  if (res.ok && data?.ok) return { ok: true, underWay: data.underWay ?? [] };
  if (res.status === 409 && data?.code === 'locked_bookings') {
    return { ok: false, locked: true, affected: data.affected ?? [], underWay: data.underWay ?? [] };
  }
  return { ok: false, locked: false };
}

const SEASON = '/api/admin/season';

/** What a block over these dates would move (`affected`) and leave to finish (`underWay`, T2.5.05). */
export async function previewBlock(
  startDate: string,
  endDate: string,
): Promise<{ affected: Affected[]; underWay: Affected[] } | null> {
  try {
    const qs = new URLSearchParams({ startDate, endDate });
    const res = await fetch(`${SEASON}/blocks/preview?${qs}`, { cache: 'no-store' });
    const data = (await res.json()) as { ok?: boolean; affected?: Affected[]; underWay?: Affected[] };
    return res.ok && data.ok ? { affected: data.affected ?? [], underWay: data.underWay ?? [] } : null;
  } catch {
    return null;
  }
}

export const addBlock = (b: BlockRange) => call('POST', `${SEASON}/blocks`, { confirmBy: null, ...b });

/** Block over locked bookings: each goes to needs_new_time with E5b and no times (orchestrator ruling Q3). */
export const confirmBlock = (b: BlockRange, bookings: Affected[]) =>
  call('POST', `${SEASON}/blocks/confirm`, {
    block: { confirmBy: null, ...b },
    bookings: bookings.map((x) => ({ requestId: x.id })),
  });

export const removeBlock = (id: string) => call('DELETE', `${SEASON}/blocks/${id}`);

export const setCap = (weekStart: string, capOverride: number | null) =>
  call('PATCH', `${SEASON}/weeks/${weekStart}`, { capOverride });

export const offerStandby = (requestId: string, slotId: string) =>
  call('POST', `/api/admin/requests/${requestId}/standby-offer`, { slotId });
