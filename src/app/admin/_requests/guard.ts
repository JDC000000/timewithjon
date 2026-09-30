// src/app/admin/_requests/guard.ts — AGENTS.md rule 4: every admin page calls requireAdmin() itself (not only the
// AdminShell layout); this maps its refusal for a page: flag off (404) = the admin doesn't exist; no session or not
// the admin = the sign-in page.
import 'server-only';
import { notFound, redirect } from 'next/navigation';

export function notAllowed(refusal: Response): never {
  if (refusal.status === 404) notFound();
  redirect('/admin/sign-in');
}
