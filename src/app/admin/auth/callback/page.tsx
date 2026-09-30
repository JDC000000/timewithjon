// src/app/admin/auth/callback/page.tsx — T2.1.U1 A1c (V5, g1 #20 (a)): the emailed sign-in link opens this one-tap
// page. The GET has NO side effects: it never calls Auth, so a link scanner, a prefetch or a HEAD can't spend the
// one-time token. Only the POST (/api/admin/auth/confirm, same-origin, with this page's CSRF token) signs in.
// A malformed link (not exactly one type=email and one token_hash) is a 404. Never cached (dynamic).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { adminFeatureOff } from '@/features/admin/auth';
import { AdminSolo } from '@/ui';
import { SIGN_IN } from '@/content/ui/admin-requests';
import { linkTokenHash, signConfirm } from '../confirm-token';
import { ConfirmButton } from './ConfirmButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SIGN_IN.confirmPageTitle };

type Search = Record<string, string | string[] | undefined>;

function toParams(sp: Search): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of [v ?? []].flat()) out.append(k, x);
  return out;
}

export default async function ConfirmSignInPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (adminFeatureOff()) notFound();
  const tokenHash = linkTokenHash(toParams(await searchParams));
  if (!tokenHash) notFound();
  return (
    <AdminSolo>
      <h1 className="h1">{SIGN_IN.confirmTitle}</h1>
      <p className="ui" style={{ marginTop: 'var(--s3)', color: 'var(--c-ink)' }}>
        {SIGN_IN.confirmLine}
      </p>
      <form method="post" action="/api/admin/auth/confirm">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="csrf" value={signConfirm(tokenHash)} />
        <p className="send">
          <ConfirmButton label={SIGN_IN.confirmButton} busyLabel={SIGN_IN.sending} />
        </p>
      </form>
      <p className="help">{SIGN_IN.confirmHelp}</p>
    </AdminSolo>
  );
}
