// src/app/dev/state/route.dev.ts — POST {scenario} (prototype build only; refuses unless settings.env='prototype').
import { type NextRequest, NextResponse } from 'next/server';
import { withTx } from '@/lib/db';
import { devGuard } from '@/features/dev/guard';
import { applyScenario, SCENARIOS, type Scenario } from '@/features/dev/scenarios';

export const runtime = 'nodejs';
export async function POST(req: NextRequest) {
  const denied = await devGuard(req);
  if (denied) return denied;
  const { scenario } = (await req.json().catch(() => ({}))) as { scenario?: string };
  if (!SCENARIOS.includes(scenario as Scenario))
    return NextResponse.json({ ok: false, scenarios: SCENARIOS }, { status: 400 });
  await withTx((c) => applyScenario(c, scenario as Scenario));
  return NextResponse.json({ ok: true, scenario });
}
