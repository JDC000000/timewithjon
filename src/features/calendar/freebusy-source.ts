// src/features/calendar/freebusy-source.ts — T3.5.01: the real FreeBusySource for staging and production, on
// Jon's stored connection and settings.freebusy_calendar_ids (J1). Proto and previews use the mock.
import 'server-only';
import { googleFreeBusySource } from '@/lib/adapters/google/freebusy';
import type { FreeBusySource } from '@/lib/adapters/types';
import { loadSettings } from '@/lib/settings';
import { withGoogleAlert } from './alerts';
import { forgetAccessToken, googleAccessToken } from './connection';

const source = googleFreeBusySource({
  accessToken: googleAccessToken,
  calendarIds: async () => (await loadSettings()).freebusy_calendar_ids,
  forgetAccessToken,
});

/** A dead grant alerts Jon (E14, T3.14.02); the caller still fails open (C3 rule 7). */
export const realFreeBusy: FreeBusySource = {
  busy: (from, to) => withGoogleAlert(() => source.busy(from, to)),
};
