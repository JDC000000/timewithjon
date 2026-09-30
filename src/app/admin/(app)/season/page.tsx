// src/app/admin/(app)/season/page.tsx — T2.5.U1 / T3.5.U1: A4 season view (pack a4-season). The list pane with every
// season week; the detail pane asks Jon to pick a week (a phone shows the list only).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { PANES, SEASON } from '@/content/ui/admin-season';
import { seasonPage } from '@/app/admin/_season/data';
import { ListLanding } from '@/app/admin/_season/ListLanding';
import { Panes, SeasonList } from '@/app/admin/_season/SeasonList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: PANES.titleSeason };

export default async function SeasonIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) notAllowed(admin); // 404 when the flag is off, else to sign-in
  const [page, sp] = await Promise.all([seasonPage(), searchParams]);
  return (
    <Panes
      phoneShows="list"
      list={
        <ListLanding saved={sp.saved === 'away' || sp.saved === 'off' ? sp.saved : null}>
          <SeasonList page={page} />
        </ListLanding>
      }
      detail={
        <div className="empty-pane">
          <h2 className="h2">{SEASON.pickWeek}</h2>
          <p className="ui" style={{ marginTop: 'var(--s2)' }}>
            {SEASON.pickWeekSub}
          </p>
        </div>
      }
    />
  );
}
