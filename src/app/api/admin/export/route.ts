// src/app/api/admin/export/route.ts — T3.10.01: POST { consentedOnly = true, includeEmail = false } builds the
// stories zip into the private `exports` bucket and answers a 10-minute signed link. Not a tick job (TSD T3.10).
// Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7). Never cached.
// T3.10.U1: in the prototype only, the bucket is in memory and its link can't be opened, so the answer is the zip
// itself (an attachment, capped by PROTOTYPE_ZIP_MAX_BYTES). Staging and production answer the signed link.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getEnv } from '@/config/env';
import { ERRORS } from '@/content';
import { requireAdmin } from '@/features/admin/auth';
import { prototypeZip } from '@/features/export/prototype-zip';
import { exportFileName, runExport } from '@/features/export/run';
import { exportStore } from '@/lib/adapters/exports';
import { photoStore } from '@/lib/adapters/photos';
import { jsonError, noStore } from '@/lib/http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.strictObject({
  consentedOnly: z.boolean().default(true),
  includeEmail: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof Response) return noStore(admin);
  const raw = await req.text();
  const parsed = Body.safeParse(raw.trim() === '' ? {} : safeJson(raw));
  if (!parsed.success) return noStore(jsonError(400, 'invalid', ERRORS.generic));
  const now = new Date();
  try {
    const out = await runExport(parsed.data, { photos: photoStore(), exports: exportStore() }, now);
    if (!out.ok) return noStore(jsonError(409, 'export_running', ERRORS.generic));
    if (getEnv().APP_MODE === 'prototype') return noStore(zipAnswer(prototypeZip(out.jobId), now));
    return noStore(NextResponse.json(out));
  } catch (e) {
    report(e, { area: 'export' });
    return noStore(jsonError(500, 'export_failed', ERRORS.generic));
  }
}

function zipAnswer(zip: ReturnType<typeof prototypeZip>, now: Date): Response {
  if (zip === 'too_large') return jsonError(413, 'export_too_large', ERRORS.generic);
  if (zip === 'missing') return jsonError(500, 'export_failed', ERRORS.generic);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName(now)}"`,
      'Content-Length': String(zip.length),
    },
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
