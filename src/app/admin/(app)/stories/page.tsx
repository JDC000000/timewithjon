// src/app/admin/(app)/stories/page.tsx — T2.9.U1 / T3.7.U1: A6 stories (wireframe 09 A6). The list pane with "Add
// emailed story"; the detail pane asks Jon to pick a story (a phone shows the list only).
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { STORIES } from '@/content/ui/admin-season';
import { ListReturn } from '@/app/admin/_season/Landing';
import { Panes } from '@/app/admin/_season/SeasonList';
import { storiesPage } from '@/app/admin/(app)/stories/_a6/data';
import { STORY_RETURN_KEY } from './_a6/paths';
import { StoriesList } from './_a6/StoriesList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: STORIES.titlePage };

export default async function StoriesIndex() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) notAllowed(admin); // 404 when the flag is off, else to sign-in
  const stories = await storiesPage();
  return (
    <Panes
      phoneShows="list"
      list={
        <ListReturn returnKey={STORY_RETURN_KEY}>
          <StoriesList stories={stories} />
        </ListReturn>
      }
      detail={
        <div className="empty-pane">
          <h2 className="h2">{STORIES.pick}</h2>
        </div>
      }
    />
  );
}
