// src/lib/adapters/index.ts — chosen by APP_MODE. Real adapters are wired in T3.2/T3.4/T3.5 (photos: ./photos.ts).
import 'server-only';
import { getEnv } from '@/config/env';
import { realCalendar } from '@/features/calendar/gateway';
import { realFreeBusy } from '@/features/calendar/freebusy-source';
import { mockCalendar } from './mock/calendar';
import { mockFreeBusy } from './mock/freebusy';
import { mockMailer } from './mock/mailer';
import { realMailer } from './mailer';
import type { Adapters } from './types';

export function adapters(): Adapters {
  if (getEnv().APP_MODE === 'prototype')
    return { mailer: mockMailer, calendar: mockCalendar, freeBusy: mockFreeBusy };
  return {
    mailer: realMailer, // T3.2
    calendar: realCalendar, // T3.4
    freeBusy: realFreeBusy, // T3.5
  };
}
