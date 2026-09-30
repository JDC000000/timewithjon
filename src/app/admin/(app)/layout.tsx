// src/app/admin/(app)/layout.tsx (U1, AdminShell): every signed-in admin page lives in this route group. Flag off ->
// 404; not signed in (or not on the allowlist) -> the sign-in page. Pages still call requireAdmin() themselves
// (AGENTS.md rule 4: never rely on a layout alone). Markup = the pack's adm_page() shell (a2). T3.3.U1 (lane U6):
// the Google banner (wireframe 09 A7d) above the panes when Google needs Jon, read only after requireAdmin passes.
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ADMIN_SHELL, MARK } from '@/content/ui/foundation';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { listRequests } from '@/features/admin/inbox';
import { googleBanner } from '@/features/calendar/alerts';
import { googleConfigured } from '@/lib/adapters/google/oauth';
import { GoogleBanner } from '@/app/admin/_season/GoogleBanner';
import { AdminNav } from '@/ui/AdminNav';
import { ROUTES } from '@/ui/routes';

export const dynamic = 'force-dynamic';

/** The Needs a reply count for the nav badge; the shell still renders if the count can't be read. */
async function needsReplyCount(): Promise<number | null> {
  try {
    const { cards } = await listRequests('needs_reply');
    return cards.length;
  } catch {
    return null;
  }
}

/** Whether Google needs Jon (a dead grant or a dropped token); the shell still renders if it can't be read. */
async function googleNeedsJon(): Promise<boolean> {
  try {
    return (await googleBanner()) !== null;
  } catch {
    return false;
  }
}

export default async function AdminShell({ children }: { children: ReactNode }) {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) redirect(ROUTES.admin.signIn);
  const [needs, google] = await Promise.all([needsReplyCount(), googleNeedsJon()]);
  return (
    <div className="adm">
      <header className="adm-top">
        <span className="mark">{MARK}</span>
        <Link className="textbtn" href={ROUTES.admin.settings}>
          {ADMIN_SHELL.settings}
        </Link>
      </header>
      <div className="adm-shell">
        <AdminNav variant="side" email={admin.email} needs={needs} />
        <main id="main" className="adm-main">
          {google ? <GoogleBanner canConnect={googleConfigured()} /> : null}
          {children}
        </main>
      </div>
      <AdminNav variant="tabbar" needs={needs} />
    </div>
  );
}
