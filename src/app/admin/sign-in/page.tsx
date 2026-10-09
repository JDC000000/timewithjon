// src/app/admin/sign-in/page.tsx — T2.1.U1: A1 admin sign-in (email + Turnstile, then one code field), outside
// the AdminShell. Behind FEATURE_ADMIN_AUTH (off = 404, like every admin route); a signed-in admin goes to /admin.
// Never cached; nothing about the admin's address is on the page.
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getEnv } from '@/config/env';
import { requireAdmin } from '@/features/admin/auth';
import { safeAdminNext } from '@/features/admin/next-path';
import { AdminSolo } from '@/ui';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { SignInFlow } from './SignInFlow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SIGN_IN.pageTitle };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const env = getEnv();
  if (env.FEATURE_ADMIN_AUTH !== '1') notFound();
  const { error, next } = await searchParams;
  const admin = await requireAdmin();
  // EML-11: a signed-in admin goes where the link was going (a safe admin page only), else the inbox.
  if (!(admin instanceof Response)) redirect(safeAdminNext(next) ?? '/admin');

  return (
    <AdminSolo>
      <Suspense>
        <SignInFlow
          siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
          notice={error === 'link' ? SIGN_IN.linkSpent : error === 'unavailable' ? SIGN_IN.unavailable : null}
        />
      </Suspense>
    </AdminSolo>
  );
}
