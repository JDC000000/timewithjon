// src/app/manage/_lib/sent-lines.ts — S17: what /manage lists under "When" while nothing is locked. Server-only.
import 'server-only';
import type { ManageModel } from '@/features/invites/manage-model';
import { loadRequestLines } from '../../sent/model';

type Open = Extract<ManageModel, { kind: 'manage' }>;

/**
 * QA L7: while nothing is locked, the times (or dates, window, stand-by days) the guest sent, as /sent lists them.
 * QA4b M3: not after the booking they joined fell through: their pick was that booking's time, which is off now.
 */
export async function sentLines(model: Open): Promise<string[]> {
  const waiting = ['requested', 'needs_new_time', 'standby'].includes(model.status);
  return !model.when && waiting && !model.hostLeft ? loadRequestLines(model.requestId) : [];
}
