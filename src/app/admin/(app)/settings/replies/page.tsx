// src/app/admin/(app)/settings/replies/page.tsx — T2.9.U1: A7c Replies and stories (wireframe 09 A7c): the groups
// beside the form; a phone shows the form only, with "‹ Settings".
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { SETTINGS } from '@/content/ui/admin-season';
import { Panes } from '@/app/admin/_season/SeasonList';
import { repliesPage } from '@/app/admin/(app)/settings/_a7/data';
import { GroupPane } from '../_a7/GroupPane';
import { REPLIES_PATH } from '../_a7/paths';
import { RepliesForm } from '../_a7/RepliesForm';
import { SettingsList } from '../_a7/SettingsList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SETTINGS.titleReplies };

export default async function RepliesSettings() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin); // 404 when the flag is off, else to sign-in
  const { settings, peopleReached } = await repliesPage();
  return (
    <Panes
      phoneShows="detail"
      list={<SettingsList current="replies" />}
      detail={
        <GroupPane title={SETTINGS.replies} href={REPLIES_PATH}>
          <RepliesForm
            saved={{ replyPromiseDays: settings.replyPromiseDays, before60Enabled: settings.before60Enabled }}
            peopleReached={peopleReached}
          />
        </GroupPane>
      }
    />
  );
}
