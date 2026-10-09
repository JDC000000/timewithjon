// src/app/admin/(app)/settings/calendar/page.tsx — T3.3.U1 / T3.15.U1: A7 Calendar (wireframe 09 A7, A7d): the
// groups beside the Calendar group; a phone shows the group only, with "‹ Settings".
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { notAllowed } from '@/app/admin/_requests/guard';
import { adminFeatureOff, requireAdmin } from '@/features/admin/auth';
import { SETTINGS } from '@/content/ui/admin-season';
import { currentMailerMode } from '@/lib/adapters/mailer';
import { Panes } from '@/app/admin/_season/SeasonList';
import { CalendarPane } from '../_a7/CalendarPane';
import { calendarStatus } from '@/app/admin/(app)/settings/_a7/data';
import { settingsBack } from '../_a7/GroupPane';
import { SettingsList } from '../_a7/SettingsList';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: SETTINGS.titleCalendar };

export default async function CalendarSettings() {
  if (adminFeatureOff()) notFound();
  const admin = await requireAdmin();
  if (admin instanceof Response) return notAllowed(admin); // 404 when the flag is off, else to sign-in
  const [status, mailer] = await Promise.all([calendarStatus(), currentMailerMode()]);
  return (
    <Panes
      phoneShows="detail"
      list={<SettingsList current="calendar" />}
      detail={<CalendarPane status={status} say={null} land back={settingsBack()} mailer={mailer} />}
    />
  );
}
