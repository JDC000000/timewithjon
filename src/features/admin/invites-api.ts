// src/features/admin/invites-api.ts — T2.6.03 handlers for /api/admin/invites/**. Each one: requireAdmin (feature
// flag, Origin on writes, session) → Zod → the invite service → JSON. Never cached: links carry secrets.
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { ERRORS } from '@/content';
import { withTx } from '@/lib/db';
import { jsonError, noStore } from '@/lib/http';
import { requireAdmin } from './auth';
import { createInvite, CreateInviteBody, listInvites, revokeInvite, rotateGeneral } from './invites';
import { parseInviteCsv } from './invites-import';

/** A 500-row guest list is well under this; anything bigger is not a guest list. */
const IMPORT_MAX_BYTES = 256 * 1024;

/** GET /api/admin/invites: every invite with its link, copy text, open count and request status. */
export async function getInvites(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  return noStore(NextResponse.json({ ok: true, invites: await listInvites() }));
}

/**
 * POST /api/admin/invites: a personal invite. A bad "our things" phrase (5 words, 41 characters, a comma, a 4th
 * phrase) is a 400 naming the problem (`issues`: the Zod messages, e.g. four_words_max) so A5 can point at it.
 */
export async function postInvite(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const parsed = CreateInviteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.message }));
    return noStore(
      NextResponse.json({ ok: false, code: 'invalid', message: ERRORS.generic, issues }, { status: 400 }),
    );
  }
  return noStore(NextResponse.json({ ok: true, invite: await createInvite(parsed.data) }, { status: 201 }));
}

/** POST /api/admin/invites/[id]/revoke (any link; idempotent). */
export async function postRevoke(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const { id } = await ctx.params;
  const res = z.uuid().safeParse(id).success ? await revokeInvite(id) : { ok: false as const };
  if (!res.ok) return noStore(jsonError(404, 'not_found', ERRORS.generic));
  return noStore(NextResponse.json(res));
}

/** POST /api/admin/invites/rotate-general: the old general link goes stale, the new one is returned. */
export async function postRotateGeneral(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  return noStore(NextResponse.json({ ok: true, invite: await rotateGeneral() }));
}

/**
 * POST /api/admin/invites/import (T5.1.02): a `text/csv` body with header `name,email,dish` → one personal invite
 * per row through createInvite, our_things always []. All-or-nothing: every row is checked before any is written,
 * and any problem is a 400 listing `errors` [{line, reason}] with 0 rows written; the rows are then written in ONE
 * transaction, so a failure part way through writes none (a re-upload never duplicates). 200 {ok, created}.
 */
export async function postInviteImport(req: NextRequest): Promise<Response> {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (type !== 'text/csv') return noStore(jsonError(415, 'unsupported_media_type', ERRORS.generic));
  const text = await req.text();
  if (Buffer.byteLength(text) > IMPORT_MAX_BYTES) return noStore(jsonError(413, 'too_large', ERRORS.generic));
  const { rows, errors } = parseInviteCsv(text);
  if (errors.length) {
    return noStore(
      NextResponse.json({ ok: false, code: 'invalid', message: ERRORS.generic, errors }, { status: 400 }),
    );
  }
  const now = new Date();
  await withTx(async (c) => {
    for (const row of rows) await createInvite(row, now, c);
  });
  return noStore(NextResponse.json({ ok: true, created: rows.length }));
}
