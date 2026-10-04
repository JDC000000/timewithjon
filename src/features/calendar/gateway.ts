// src/features/calendar/gateway.ts — T3.4.01: the real CalendarGateway for staging and production (AD-6), built
// from Jon's stored connection. Proto and previews never get here: adapters() gives them the mock.
// J2 (pr39 F2 ruling): the accepted second attendee is the connected account (account_email = ADMIN_EMAILS[0]),
// the calendar's owner, so Google emails him nothing; JON_PERSONAL_EMAIL (Reply-To) plays no part here.
import 'server-only';
import { googleCalendarGateway } from '@/lib/adapters/google/calendar';
import type { CalendarGateway } from '@/lib/adapters/types';
import { withGoogleAlert } from './alerts';
import { forgetAccessToken, googleAccessToken, GoogleNotConnectedError, loadConnection } from './connection';

const gateway = googleCalendarGateway({
  accessToken: googleAccessToken,
  target: async () => {
    const row = await loadConnection();
    return row ? { calendarId: row.calendar_id, ownerEmail: row.account_email } : null;
  },
  forgetAccessToken,
});

/** The target is read per call, so a reconnect is picked up. A dead grant alerts Jon (E14, T3.14.02). */
export const realCalendar: CalendarGateway = {
  insert: (e) => withGoogleAlert(() => gateway.insert(e)),
  patch: (id, e, opts) => withGoogleAlert(() => gateway.patch(id, e, opts)),
  remove: (id) => withGoogleAlert(() => gateway.remove(id)),
  rsvps: (from) => withGoogleAlert(() => gateway.rsvps(from)),
  // No withGoogleAlert: health() returns 'revoked' instead of throwing, and its caller (L4's 07:00 check,
  // T3.9.04) sends E14 through sendE14Once. A stored row without a token (a Disconnect) = not_connected.
  health: async () => {
    try {
      return await gateway.health();
    } catch (e) {
      if (e instanceof GoogleNotConnectedError) return 'not_connected';
      throw e;
    }
  },
};
