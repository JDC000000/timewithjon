// src/app/admin/(app)/season/away/page.tsx — T2.5.U1: A4c away mode (pack a4c-away): the season list beside the away
// form (a phone shows the form only, with "‹ Season").
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { PANES } from '@/content/ui/admin-season';
import { AwayForm } from '@/app/admin/_season/AwayForm';
import { seasonPage } from '@/app/admin/_season/data';
import { previewBlock } from '@/features/admin/season';
import { BackRow, Panes, SeasonList } from '@/app/admin/_season/SeasonList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: PANES.titleAway };

export default async function AwayPage() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) notAllowed(admin); // 404 when the flag is off, else to sign-in
  const page = await seasonPage();
  const current = page.rows.find((r) => r.away)?.weekStart;
  const lockedNow = page.away
    ? (await previewBlock(page.away.startDate, page.away.endDate)).affected.length
    : null;
  return (
    <Panes
      phoneShows="detail"
      list={<SeasonList page={page} current={current} />}
      detail={<AwayForm away={page.away} lockedNow={lockedNow} back={<BackRow />} />}
    />
  );
}
