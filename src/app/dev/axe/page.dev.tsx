// src/app/dev/axe/page.dev.tsx (U1, T1.1a.U2): every shared primitive on one page, for the axe check
// (0 violations). Prototype build only; the twj_dev cookie like every /dev page. Dev-only sample labels.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEV_COOKIE, devCookieOk } from '@/features/dev/guard';
import { AxeSamples } from './AxeSamples';

export const dynamic = 'force-dynamic';

export default async function AxePage() {
  if (!devCookieOk((await cookies()).get(DEV_COOKIE)?.value)) notFound();
  return <AxeSamples />;
}
