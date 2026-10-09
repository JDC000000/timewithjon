// src/app/api/requests/route.ts — T1.7 POST: validate, one transaction, THEN awaited E1/E2, then capability.
import { NextResponse, type NextRequest } from 'next/server';
import { ERRORS, FLOW } from '@/content';
import { dishBySlug, inSentence } from '@/content/menu-helpers';
import { setRequestCapability } from '@/features/invites/capability';
import { deliverRequestEmails } from '@/features/email/send';
import { getBusy } from '@/features/availability/busy';
import { engineInput, loadEngineData } from '@/features/availability/load';
import { openWindows } from '@/features/availability/openWindows';
import { clientIp, jsonError, sameOrigin } from '@/lib/http';
import { isReleased, opensAt } from '@/features/invites/release';
import { requireInvite } from '@/features/invites/require';
import { limitByIp } from '@/lib/ratelimit';
import {
  createRequest,
  findRecentDuplicate,
  findReplay,
  ReplayConflictError,
} from '@/features/requests/create';
import { report } from '@/lib/report';
import { VALIDATION_MESSAGE } from '@/features/requests/messages';
import { RequestBody } from '@/features/requests/schema';
import { storableBody, validateRequest } from '@/features/requests/validate';
import { isHoneypotFilled } from '@/lib/honeypot';
import { loadSettings } from '@/lib/settings';
import { verifyTurnstile } from '@/lib/turnstile';
import { formatInTimeZone } from 'date-fns-tz';
import { TZ } from '@/lib/time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError(403, 'bad_origin', ERRORS.generic);
  const limited = await limitByIp(req, 'requestSend'); // T3.8.02: before the invite check, so probes count too
  if (limited) return limited;
  const gate = await requireInvite();
  if ('response' in gate) return gate.response;
  const ip = clientIp(req);

  const parsed = RequestBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const emailBad = parsed.error.issues.some((i) => i.path[0] === 'email');
    return jsonError(
      400,
      emailBad ? 'email_invalid' : 'invalid',
      emailBad ? ERRORS.badEmail : ERRORS.generic,
    );
  }
  const body = parsed.data;
  const { invite } = gate;
  const settings = await loadSettings();
  if (!isReleased(invite.kind, settings)) {
    return jsonError(
      403,
      'not_released',
      FLOW.opensOn(formatInTimeZone(opensAt(invite.kind, settings), TZ, 'MMMM d')),
    );
  }
  const dish = dishBySlug(body.dish);
  if (!dish) return jsonError(400, 'unknown_dish', ERRORS.generic);
  if (invite.kind === 'general' && !(await verifyTurnstile(body.turnstileToken, ip)))
    return jsonError(400, 'bot_check', ERRORS.botCheck);

  // ENG-03: a retry of a saved request (same key, same body) gets that request back BEFORE the engine is asked:
  // the time may have gone, or the week reopened, since it was saved.
  const stored = storableBody(body, dish);
  let requestId: string | null;
  try {
    // QA4b M1: or the same request again under a new key (Back after Send, then Send).
    requestId = (await findReplay(stored, invite.id)) ?? (await findRecentDuplicate(stored, invite.id));
  } catch (e) {
    if (e instanceof ReplayConflictError) return jsonError(409, 'replay_conflict', ERRORS.generic);
    throw e;
  }
  if (requestId) return answer(requestId, body.email);

  const loaded = await loadEngineData();
  const busy = await getBusy({ start: settings.season_start, end: settings.season_end });
  const engine = openWindows(engineInput(loaded, busy, invite.kind, dish.windows));
  const v = validateRequest(body, dish, engine, { start: settings.season_start, end: settings.season_end });
  if (!v.ok) return jsonError(409, v.code, VALIDATION_MESSAGE[v.code]);

  const spam = isHoneypotFilled(body.hp); // AD-9: stored, never refused
  try {
    ({ requestId } = await createRequest({
      body: stored,
      inviteId: invite.id,
      isTest: invite.is_test,
      spam,
      mode: v.mode,
      status: v.status,
      countsToward: v.countsToward,
      bigCrew: v.bigCrew,
      dishName: inSentence(dish), // E1/E2's {dish}, inside a sentence
      capGuestEmails: invite.kind === 'general',
    }));
  } catch (e) {
    if (e instanceof ReplayConflictError) return jsonError(409, 'replay_conflict', ERRORS.generic);
    throw e;
  }
  return answer(requestId, body.email);
}

/**
 * Committed. Send the queued emails now, awaited (AD-1, L-3). This also covers an idempotent replay whose first
 * attempt died before sending. A send problem never turns a saved request into an error: the row stays
 * 'pending'/'failed' and the tick's email-retry job re-sends it. `sentTo` is the stored address: a replay's body is
 * the saved one (ENG-01).
 */
async function answer(requestId: string, sentTo: string): Promise<Response> {
  try {
    await deliverRequestEmails(requestId);
  } catch (e) {
    report(e, { area: 'email', step: 'post_commit' });
  }
  const res = NextResponse.json({ ok: true, sentTo });
  setRequestCapability(res, requestId);
  return res;
}
