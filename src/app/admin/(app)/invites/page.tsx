// src/app/admin/(app)/invites/page.tsx — T2.6.U1: A5 links (wireframe 09 A5/A5c) on the T2.6 API. The list pane:
// the general link (Rotate) and every personal link (Copy link / Copy text / Revoke in place) with "New link"
// (the create sheet + live S2 hero preview). The detail pane only points at "New link" (a phone shows the list).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { Panes } from '@/app/admin/_season/SeasonList';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { A5 } from './_a5/copy';
import { invitesPage } from './_a5/data';
import { InvitesList } from './_a5/InvitesList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: A5.titlePage };

export default async function InvitesIndex() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) notAllowed(admin); // 404 when the flag is off, else to sign-in
  const { invites, dishes } = await invitesPage();
  return (
    <Panes
      phoneShows="list"
      list={<InvitesList invites={invites} dishes={dishes} />}
      detail={
        <div className="empty-pane">
          <h2 className="h2">{A5.pick}</h2>
        </div>
      }
    />
  );
}
