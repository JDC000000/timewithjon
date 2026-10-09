// src/app/admin/(app)/settings/page.tsx — T2.9.U1 / T3.3.U1: A7 settings (wireframe 09 A7): the groups (+ the health
// banner) beside the Calendar group, as the wireframe draws it; a phone shows the groups only. Google's consent
// screen comes back here (`?google=…`, T3.3.04): then the Calendar group is the arrival, on a phone too.
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { SETTINGS } from '@/content/ui/admin-season';
import { currentMailerMode } from '@/lib/adapters/mailer';
import { ListReturn } from '@/app/admin/_season/Landing';
import { Panes } from '@/app/admin/_season/SeasonList';
import { CalendarPane } from './_a7/CalendarPane';
import { calendarStatus } from '@/app/admin/(app)/settings/_a7/data';
import { settingsBack } from './_a7/GroupPane';
import { googleResultLine } from './_a7/model';
import { SETTINGS_RETURN_KEY } from './_a7/paths';
import { SettingsList } from './_a7/SettingsList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SETTINGS.titlePage };

export default async function SettingsIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin); // 404 when the flag is off, else to sign-in
  const [status, sp, mailer] = await Promise.all([calendarStatus(), searchParams, currentMailerMode()]);
  const say = googleResultLine(sp.google);
  return (
    <Panes
      phoneShows={say ? 'detail' : 'list'}
      list={
        <ListReturn returnKey={SETTINGS_RETURN_KEY}>
          <SettingsList current="calendar" />
        </ListReturn>
      }
      detail={
        <CalendarPane status={status} say={say} land={say !== null} back={settingsBack()} mailer={mailer} />
      }
    />
  );
}
