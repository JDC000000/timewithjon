// src/lib/engine/types.ts — C3 availability engine types. Pure data, no I/O.
export type WindowKind = 'lunch' | 'evening';
export type CountsToward = 'weekly_cap' | 'big_day' | 'none';
export type InviteKind = 'personal' | 'general';
export type WeekState = 'open' | 'spoken_for' | 'away' | 'closed';
export type RequestStatus = 'requested' | 'locked' | 'needs_new_time' | 'standby' | 'cancelled' | 'done';

export interface Slot {
  id: string;
  date: string;
  windowKind: WindowKind;
  startsAt: Date;
  endsAt: Date;
}
export interface Week {
  weekStart: string;
  capOverride: number | null;
}
export interface Range {
  startsAt: Date;
  endsAt: Date;
}

/** A request in status locked or done (done = locked whose end has passed). */
export interface Booking extends Range {
  requestId: string;
  countsToward: CountsToward;
  joinedToRequestId: string | null; // joined requests never occupy a range or count (rule 9)
  /** The request's dish slug (a per-week dish limit, decision 43(4)); absent in engine-only fixtures. */
  dish?: string;
}

export interface Block {
  startDate: string;
  endDate: string;
  kind: 'blocked' | 'away';
  confirmBy: string | null;
  /** T2.5.06: one window of startDate (= endDate) only. Absent or null = the whole day(s). */
  window?: WindowKind | null;
  /** A window block's times (its slot), so a range lock can't cover it; loaded with the block. */
  windowRange?: Range | null;
}

export interface Offer {
  id: string;
  requestId: string;
  kind: 'suggested_times' | 'standby_open' | 'weather_call';
  slotIds: string[];
  ranges: Range[];
  expiresAt: Date | null;
  takenAt: Date | null;
  releasedAt: Date | null;
}

export interface EngineSettings {
  seasonStart: string; // '2027-04-01'
  seasonEnd: string; // '2027-06-30'
  personalOpenAt: Date;
  generalOpenAt: Date;
  defaultWeeklyCap: number;
  householdHoldReleased: boolean;
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface EngineInput {
  now: Date;
  slots: Slot[];
  weeks: Week[];
  bookings: Booking[];
  blocks: Block[];
  offers: Offer[];
  settings: EngineSettings;
  busy: BusyInterval[] | null; // null = free/busy unavailable -> no filter (fail open)
  inviteKind: InviteKind;
  dishWindows: WindowKind[]; // from the content module (C3 rule 2(i))
  viewerRequestId?: string; // a guest's own live offer never hides from themselves
}

export interface WindowOut {
  slotId: string;
  date: string;
  window: WindowKind;
  label: string;
}
export interface WeekOut {
  weekStart: string;
  state: WeekState;
  windows: WindowOut[];
}
/** The ONLY shape the browser ever receives (C3 output). No cap, no counts. */
export interface EngineOutput {
  weeks: WeekOut[];
  unavailableDates: string[];
  awayNotice?: { until: string; confirmBy: string | null };
  opensAt?: string;
}
