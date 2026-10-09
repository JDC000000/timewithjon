// src/app/admin/(app)/stories/[id]/page.tsx — T2.9.U1: A6, one story (wireframe 09 A6): the stories list beside the
// story (a phone shows the story only, with "‹ Stories"). `?added=<n>` = just added through "Add emailed story"
// (T3.7.U1), n photos didn't upload.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { STORIES } from '@/content/ui/admin-season';
import { BackRow, Panes } from '@/app/admin/_season/SeasonList';
import { storyPage } from '@/app/admin/(app)/stories/_a6/data';
import { addedLine } from '../_a6/model';
import { ADDED_PARAM, CLEARED_PARAM, STORIES_PATH } from '../_a6/paths';
import { StoriesList } from '../_a6/StoriesList';
import { StoryDetail } from '../_a6/StoryDetail';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const metadata: Metadata = { title: STORIES.titlePage }; // wireframe 09 A6: the same title with a story open

export default async function StoryPage({ params, searchParams }: Props) {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin); // 404 when the flag is off, else to sign-in
  const id = (await params).id.toLowerCase();
  if (!UUID.test(id)) notFound();
  const [data, sp] = await Promise.all([storyPage(id), searchParams]);
  if (!data) notFound();
  return (
    <Panes
      phoneShows="detail"
      list={<StoriesList stories={data.stories} current={id} />}
      detail={
        <StoryDetail
          story={data.story}
          photos={data.photos}
          say={addedLine(sp[ADDED_PARAM])}
          landOnConsent={sp[CLEARED_PARAM] === '1'}
          back={<BackRow href={STORIES_PATH} label={STORIES.back} />}
        />
      }
    />
  );
}
