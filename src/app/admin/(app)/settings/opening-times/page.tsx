// src/app/admin/(app)/settings/opening-times/page.tsx — T2.9.U1: A7b Opening times (wireframe 09 A7b): the groups
// beside the form; a phone shows the form only, with "‹ Settings".
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { SETTINGS } from '@/content/ui/admin-season';
import { Panes } from '@/app/admin/_season/SeasonList';
import { settingsPage } from '@/app/admin/(app)/settings/_a7/data';
import { GroupPane } from '../_a7/GroupPane';
import { OpeningForm } from '../_a7/OpeningForm';
import { OPENING_PATH } from '../_a7/paths';
import { SettingsList } from '../_a7/SettingsList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SETTINGS.titleOpening };

export default async function OpeningTimes() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) notAllowed(admin); // 404 when the flag is off, else to sign-in
  const settings = await settingsPage();
  return (
    <Panes
      phoneShows="detail"
      list={<SettingsList current="opening" />}
      detail={
        <GroupPane title={SETTINGS.opening} href={OPENING_PATH}>
          <OpeningForm
            saved={{ personalOpenAt: settings.personalOpenAt, generalOpenAt: settings.generalOpenAt }}
          />
        </GroupPane>
      }
    />
  );
}
