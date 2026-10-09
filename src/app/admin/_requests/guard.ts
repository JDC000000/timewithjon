// src/app/admin/_requests/guard.ts — AGENTS.md rule 4: every admin page calls requireAdmin() itself (not only the
// AdminShell layout); this maps its refusal for a page: flag off (404) = the admin doesn't exist; no session or not
// the admin = the sign-in page, carrying the page asked for (EML-11) so sign-in returns there.
import 'server-only';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ADMIN_PATH_HEADER, signInHref } from '@/features/admin/next-path';

/** The sign-in page with ?next= for the admin page this request is for (src/proxy.ts sets the header). */
export async function signInHere(): Promise<string> {
  let here: string | null = null;
  try {
    here = (await headers()).get(ADMIN_PATH_HEADER);
  } catch {
    // outside a request (a unit test): plain sign-in
  }
  return signInHref(here);
}

export async function notAllowed(refusal: Response): Promise<never> {
  if (refusal.status === 404) notFound();
  redirect(await signInHere());
}
