// src/app/dev/axe/focus/page.dev.tsx (U1): the focus helper's test bench (tests/unit/ui/focus.pw.ts drives it with
// real keyboard and mouse in Chromium and WebKit). Prototype build only; the twj_dev cookie like every /dev page.
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DEV_COOKIE, devCookieOk } from '@/features/dev/guard';
import { FocusLab } from './FocusLab';

export const dynamic = 'force-dynamic';

export default async function FocusBench({ searchParams }: { searchParams: Promise<{ bar?: string }> }) {
  if (!devCookieOk((await cookies()).get(DEV_COOKIE)?.value)) notFound();
  const { bar } = await searchParams;
  return <FocusLab bar={bar === 'send' ? 'send' : 'toast'} />;
}
