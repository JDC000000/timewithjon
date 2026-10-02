// src/app/admin/(app)/requests/_check/model.ts — T2.9.U2: what a Check these answer (T2.9.04 routes) means for the
// optimistic screen. 'done' keeps the optimistic state; 'rollback' puts the buttons back with an error.
// Both answers are idempotent: Not spam on a row another tab already cleared (409 not_spam_suspect) and Delete on a
// row that is already gone (404) are what Jon asked for, so they are 'done', never an error.
import type { ApiAnswer } from '@/app/admin/_requests/api';

export type CheckAction = 'not-spam' | 'delete';
export type CheckOutcome = 'done' | 'rollback';

export const checkUrl = (action: CheckAction, requestId: string) =>
  action === 'not-spam'
    ? { method: 'POST' as const, url: `/api/admin/requests/${requestId}/not-spam` }
    : { method: 'DELETE' as const, url: `/api/admin/requests/${requestId}/spam` };

export function checkOutcome(action: CheckAction, res: Pick<ApiAnswer, 'status' | 'code'>): CheckOutcome {
  if (res.status === 200) return 'done';
  if (action === 'not-spam' && res.status === 409 && res.code === 'not_spam_suspect') return 'done';
  if (action === 'delete' && res.status === 404) return 'done';
  return 'rollback'; // 0 (offline), 401/403, 409 (a real row is never deleted), 5xx
}
