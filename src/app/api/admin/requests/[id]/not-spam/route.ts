// src/app/api/admin/requests/[id]/not-spam/route.ts — T2.9.04: Check these → Not spam: Needs a reply + E2 to Jon
// (TSD T2.9 AC4). Behind FEATURE_ADMIN_AUTH + requireAdmin + the Origin check (AD-7), via spamAction.
import type { NextRequest } from 'next/server';
import { markRequestNotSpam } from '@/features/admin/spam';
import { deliverRequestEmails } from '@/features/email/send';
import { spamAction } from '@/features/admin/spam-http';
import { report } from '@/lib/report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return spamAction(req, ctx, async (id) => {
    const result = await markRequestNotSpam(id);
    // The E2 was queued in the transaction; send it now, after commit (L-3). A failure stays for the tick and
    // never turns the committed change into an error (pr47 F3: a retry would only get a 409).
    if (result === 'ok') {
      try {
        await deliverRequestEmails(id);
      } catch (e) {
        report(e, { area: 'email', step: 'post_commit' });
      }
    }
    return result;
  });
}
