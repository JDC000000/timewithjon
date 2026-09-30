// src/app/api/webhooks/resend/route.ts — T3.13.01 (a): Resend's email.bounced / email.complained (and
// email.delivered, which ends polling for that row). Exists only when RESEND_WEBHOOK_SECRET is set (the Free
// plan check, T3.1.10). Svix-verified (5-minute tolerance), deduped on svix-id in the outcome's transaction.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { applyOutcome, type DeliveryEvent } from '@/features/email/outcome';
import { verifySvix } from '@/lib/adapters/resend/webhook';
import { withTx } from '@/lib/db';
import { jsonError } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 64 * 1024;
const EVENTS: Record<string, DeliveryEvent> = {
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.delivered': 'delivered',
};
// pr34 L1: the type first, so a subscribed non-email event (contact.*, domain.*) is acknowledged, not retried.
const Envelope = z.object({ type: z.string() });
const EmailPayload = z.object({ data: z.object({ email_id: z.string().min(1).max(200) }) });

export async function POST(req: NextRequest) {
  const secret = getEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) return jsonError(404, 'not_found', ERRORS.generic);
  // pr34 L3: refuse a declared oversize before buffering; then count bytes, not UTF-16 units.
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY)
    return jsonError(413, 'too_large', ERRORS.generic);
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY) return jsonError(413, 'too_large', ERRORS.generic);
  const svix = {
    id: req.headers.get('svix-id'),
    timestamp: req.headers.get('svix-timestamp'),
    signature: req.headers.get('svix-signature'),
  };
  if (!verifySvix(secret, svix, body)) return jsonError(401, 'bad_signature', ERRORS.generic);

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return jsonError(400, 'bad_payload', ERRORS.generic);
  }
  const envelope = Envelope.safeParse(json);
  if (!envelope.success) return jsonError(400, 'bad_payload', ERRORS.generic);
  const event = EVENTS[envelope.data.type];
  if (!event) return NextResponse.json({ ok: true, ignored: true }); // other event types: acknowledged
  const parsed = EmailPayload.safeParse(json);
  if (!parsed.success) return jsonError(400, 'bad_payload', ERRORS.generic);

  const emailId = parsed.data.data.email_id;
  const outcome = await withTx(async (c) => {
    const fresh = await c.query(`insert into webhook_event (id) values ($1) on conflict do nothing`, [
      svix.id,
    ]);
    if (!fresh.rowCount) return 'duplicate' as const;
    return applyOutcome(c, emailId, event);
  });
  return NextResponse.json({ ok: true, outcome });
}
