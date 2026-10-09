// src/features/requests/propose.ts — T2.4.08 the guest proposes new times or dates from an S18 page: an offer that
// doesn't suit (take_offer token) or a weather call (pick_new_date token). §6: `requested` / `needs_new_time` /
// `standby` → `requested`, updating the SAME row and replacing its choices, E16 to Jon, `awaiting_jon_since` = now.
// It reuses L3's re-request (T2.7.05): checkRerequest() before the transaction (it may read Google free/busy), then
// one transaction in the lock order (host →) request → action_token → offer (pr46-review M1): a joined guest's host
// row first, as every other action on a joined guest takes it (side-effects.ts lockHostOf), the request row FOR UPDATE,
// the single-use token spent (exactly one caller wins), then rerequestTx() (releases the live offers, E16).
// A refusal inside rerequestTx rolls everything back, so the token stays usable. A spent, released or expired
// link answers with the current state (the route reads L3's page models).
import 'server-only';
import { z } from 'zod';
import { consumeToken, findToken, tokenState } from '@/features/invites/action-tokens';
import { pool, withTx } from '@/lib/db';
import {
  checkRerequest,
  choicesHash,
  RerequestBody,
  replayOf,
  rerequestTx,
  type RerequestResult,
} from './rerequest';
import { lockHostOf, runAfterCommit } from './side-effects';

export const ProposeBody = RerequestBody.extend({ token: z.string().max(100) }).strict();
export type ProposeBody = z.infer<typeof ProposeBody>;

/** 'spent': the link is used, released or unknown (the route answers from the page model). */
export type ProposeResult = RerequestResult | { ok: false; status: 400; reason: 'invalid' } | 'spent';

const PROPOSE_PURPOSES = new Set(['take_offer', 'pick_new_date']);
const PROPOSABLE = new Set(['requested', 'needs_new_time', 'standby']);
export const PROPOSE_ACTION = 'times_proposed';

/** Rolls the transaction back with the refusal (the token is un-spent with it). */
class Refused extends Error {
  constructor(readonly result: RerequestResult) {
    super('refused');
  }
}

export async function proposeTimes(b: ProposeBody, spam = false, now = new Date()): Promise<ProposeResult> {
  const { token, clientKey } = b;
  const choices = {
    slotIds: b.slotIds,
    dates: b.dates,
    windowText: b.windowText,
    overnight: b.overnight,
    overnightNight: b.overnightNight,
  };
  const found = await findToken(token); // read only: which request, which page
  if (!found) return 'spent';
  if (!PROPOSE_PURPOSES.has(found.purpose)) return { ok: false, status: 400, reason: 'invalid' };
  // pr56-review F2: the same clientKey again gets the original success, not "that one went"; ENG-14: other
  // choices under it are refused, never answered as if they went.
  const hash = choicesHash(choices);
  const replay = await replayOf(pool(), found.request_id, PROPOSE_ACTION, clientKey, hash);
  if (replay === 'same') return { ok: true };
  if (replay === 'conflict') return { ok: false, status: 409, reason: 'replay_conflict' };
  // F3: a used or expired link answers with the state before any engine or Google free/busy read.
  if (tokenState(found, now) !== 'valid') return 'spent';
  const checked = await checkRerequest(found.request_id, choices, now);
  if ('code' in checked) {
    return checked.code === 'request_not_found'
      ? { ok: false, status: 404, reason: 'request_not_found' }
      : { ok: false, status: 409, reason: checked.code };
  }
  let out;
  try {
    out = await withTx(async (c) => {
      // Host first, then this row: a weather-called joined guest still names its host, and Promote to host on a
      // sibling takes the host before the joined rows.
      await lockHostOf(c, found.request_id);
      const {
        rows: [r],
      } = await c.query<{ status: string }>(`select r.status from request r where r.id = $1 for update`, [
        found.request_id,
      ]);
      const again = await replayOf(c, found.request_id, PROPOSE_ACTION, clientKey, hash);
      if (again === 'same') return { result: { ok: true } as const, after: null };
      if (again === 'conflict') throw new Refused({ ok: false, status: 409, reason: 'replay_conflict' });
      const t = await consumeToken(c, token);
      if (!t) return 'spent' as const;
      // pr56-review F1: from an offer or weather-call page only `requested` / `needs_new_time` / `standby` →
      // `requested` (§6). A locked booking is changed from its manage page (Ask for another time), never here.
      if (!r || !PROPOSABLE.has(r.status))
        throw new Refused({ ok: false, status: 409, reason: 'not_changeable' });
      const res = await rerequestTx(c, {
        requestId: t.request_id,
        checked,
        now,
        clientKey,
        payloadHash: hash,
        action: PROPOSE_ACTION,
        spam,
      });
      if (!res.result.ok) throw new Refused(res.result);
      return res;
    });
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
  if (out === 'spent') return 'spent';
  if (out.after) await runAfterCommit(out.after, 'propose');
  return out.result;
}
