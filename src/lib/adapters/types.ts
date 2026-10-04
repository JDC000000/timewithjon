// src/lib/adapters/types.ts — T1.10 ports. Mocks in prototype; real adapters arrive in M3.
import type { BusyInterval } from '@/features/availability/types';
import type { TemplateId } from '@/content/emails';

export interface OutgoingEmail {
  template: TemplateId;
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
  headers?: Record<string, string>;
  /** `content` is BASE64 (e.g. an .ics already encoded); anything else is refused (pr36 F9). */
  attachments?: { filename: string; content: string; contentType: string }[];
}
export interface Mailer {
  send(e: OutgoingEmail): Promise<{ id: string }>;
}

/** Stored as enum guest_rsvp (TSD v1.9). Google's raw values are mapped in google/rsvp.ts only. */
export type GuestRsvp = 'pending' | 'yes' | 'no' | 'maybe';

export interface CalendarEvent {
  requestId: string;
  summary: string;
  description: string;
  startsAt: Date;
  endsAt: Date;
  attendees: string[];
}
/** One event's attendees as the app sees them (T3.15.01): Google's raw answers never leave the adapter. */
export interface EventRsvps {
  eventId: string;
  attendees: { email: string; rsvp: GuestRsvp }[];
}
/**
 * T3.9.04: the 07:00 PT check (refresh the token, then calendars.get on the stored calendar). 'revoked' = Google
 * refused the grant (invalid_grant / 401) or the calendar is gone: Jon must reconnect. Transient trouble throws.
 */
export type CalendarHealth = 'ok' | 'not_connected' | 'revoked';
export interface CalendarGateway {
  insert(e: CalendarEvent): Promise<{ eventId: string }>;
  /** Time and text only; {attendees: true} also syncs the attendee list (a joined guest came or went). */
  patch(eventId: string, e: CalendarEvent, opts?: { attendees?: boolean }): Promise<void>;
  /** Must treat an event that is already gone (404/410) as success: a retried delete converges (pr32-review L5). */
  remove(eventId: string): Promise<void>;
  /** Every live event on the app calendar ending after `from`, in ONE list call (the RSVP watch, T3.15.01). */
  rsvps(from: Date): Promise<EventRsvps[]>;
  health(): Promise<CalendarHealth>;
}
export interface FreeBusySource {
  busy(from: Date, to: Date): Promise<BusyInterval[]>;
}
export interface Adapters {
  mailer: Mailer;
  calendar: CalendarGateway;
  freeBusy: FreeBusySource;
}
