// src/lib/adapters/mock/freebusy.ts — fixture busy time on "Jon's main calendar" (§5.5).
import { vancouverInstant } from '@/lib/time';
import type { FreeBusySource } from '../types';

export const FREEBUSY_FIXTURE = [
  { start: vancouverInstant('2027-04-15', '12:30'), end: vancouverInstant('2027-04-15', '13:30') }, // hides Thu Apr 15 lunch
  { start: vancouverInstant('2027-05-21', '18:00'), end: vancouverInstant('2027-05-21', '23:00') }, // hides Fri May 21 evening
];
export const mockFreeBusy: FreeBusySource = {
  async busy() {
    return FREEBUSY_FIXTURE;
  },
};
