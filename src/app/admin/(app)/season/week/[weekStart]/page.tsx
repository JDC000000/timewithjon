// src/app/admin/(app)/season/week/[weekStart]/page.tsx — T2.5.U1 / T3.5.U1: A4b, one week (pack a4b-week): the
// season list beside the week pane (a phone shows the week only, with "‹ Season").
import type { Metadata } from 'next';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { notFound } from 'next/navigation';
import { PANES } from '@/content/ui/admin-season';
import { weekPage } from '@/app/admin/_season/data';
import { dateLabel } from '@/app/admin/_season/model';
import { BackRow, Panes, SeasonList } from '@/app/admin/_season/SeasonList';
import { WeekEditor } from '@/app/admin/_season/WeekEditor';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ weekStart: string }> };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { weekStart } = await params;
  if (!ISO_DATE.test(weekStart)) return { title: PANES.titleSeason };
  return { title: PANES.titleWeek(dateLabel(weekStart, 'MMM d')) };
}

export default async function WeekPage({ params }: Props) {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin); // 404 when the flag is off, else to sign-in
  const { weekStart } = await params;
  if (!ISO_DATE.test(weekStart)) notFound();
  const data = await weekPage(weekStart);
  if (!data) notFound();
  return (
    <Panes
      phoneShows="detail"
      list={<SeasonList page={data.page} current={weekStart} />}
      detail={<WeekEditor week={data.week} back={<BackRow />} />}
    />
  );
}
