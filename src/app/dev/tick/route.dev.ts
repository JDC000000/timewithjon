// src/app/dev/tick/route.dev.ts — runs the AD-8 pass by hand (prototype build only).
import { type NextRequest, NextResponse } from 'next/server';
import { devGuard } from '@/features/dev/guard';
import { runTick } from '@/features/jobs';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const denied = await devGuard(req);
  if (denied) return denied;
  return NextResponse.json({ ok: true, ...(await runTick()) });
}
