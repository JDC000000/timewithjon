// src/lib/adapters/mock/calendar.ts — proto + previews ALWAYS use this (AD-6). Never sends invites.
// T4.3.05: every write resolves its target the way the real adapter does (google/calendar.ts `call`: the stored
// target through assertWritableCalendar) and is recorded with the RESOLVED calendarId, so the E2E suite can prove
// nothing is ever written to `primary` (T3.5 AC3). A refused target (e.g. `primary`) is recorded as 'refused'
// before the guard error is rethrown, so it shows in the log instead of vanishing. The log is mirrored, one JSON
// line per write, to test-results/mock-calendar-log.jsonl ONLY when that folder already exists (the Playwright run
// creates it); no other build or preview ever writes a file, and the real adapter never touches this module.
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { assertWritableCalendar } from '../google/calendar';
import type { CalendarEvent, CalendarGateway, CalendarHealth } from '../types';

/** The stand-in for the stored "Time with Jon" calendar: a secondary calendar, never `primary`. */
export const MOCK_APP_CALENDAR_ID = 'mock-time-with-jon@group.calendar.google.com';
export const MOCK_CALENDAR_LOG_FILE = path.join('test-results', 'mock-calendar-log.jsonl');
/** The in-memory log keeps the newest entries only, so a long-running preview process never grows it unbounded. */
export const MOCK_CALENDAR_LOG_MAX = 1000;

export interface MockCalendarCall {
  calendarId: string;
  method: 'insert' | 'patch' | 'remove';
  outcome: 'written' | 'refused';
  eventId: string;
  requestId?: string;
  startsAt?: string;
  at: string;
}

export interface MockCalendarDeps {
  /** The stored write target (the real adapter reads oauth_connection.calendar_id per call). */
  target: () => string | null;
  /** Where each write attempt goes; defaults to this process's log (+ the test-results mirror). */
  record?: (call: MockCalendarCall) => void;
}

// On globalThis so a dev-server module reload keeps one log per process.
const store = globalThis as typeof globalThis & { __twjMockCalendarLog?: MockCalendarCall[] };
const log = (store.__twjMockCalendarLog ??= []);

function recordToProcessLog(call: MockCalendarCall): void {
  log.push(call);
  if (log.length > MOCK_CALENDAR_LOG_MAX) log.splice(0, log.length - MOCK_CALENDAR_LOG_MAX);
  const file = path.join(process.cwd(), MOCK_CALENDAR_LOG_FILE);
  if (!existsSync(path.dirname(file))) return;
  try {
    appendFileSync(file, `${JSON.stringify(call)}\n`);
  } catch {
    /* the mirror is a test aid only: a read-only disk must never fail a mock write */
  }
}

/** A copy of this process's request log (prototype only: the real adapter never records here). */
export function mockCalendarLog(): readonly MockCalendarCall[] {
  return [...log];
}

/** A mock gateway on a given stored target; `mockCalendar` below is the one adapters() hands out. */
export function mockCalendarGateway(deps: MockCalendarDeps): CalendarGateway {
  const sink = deps.record ?? recordToProcessLog;

  function write(method: MockCalendarCall['method'], eventId: string, e?: CalendarEvent): void {
    const stored = deps.target();
    const base = {
      method,
      eventId,
      requestId: e?.requestId,
      startsAt: e?.startsAt.toISOString(),
      at: new Date().toISOString(),
    };
    let calendarId: string;
    try {
      calendarId = assertWritableCalendar(stored, stored); // same guard, same arguments as google/calendar.ts
    } catch (err) {
      sink({ ...base, calendarId: stored ?? '', outcome: 'refused' });
      throw err;
    }
    sink({ ...base, calendarId, outcome: 'written' });
  }

  return {
    async insert(e) {
      const eventId = `mock-${randomUUID()}`;
      write('insert', eventId, e);
      return { eventId };
    },
    async patch(eventId, e) {
      write('patch', eventId, e); // the outbox row records the email side
    },
    async remove(eventId) {
      write('remove', eventId);
    },
    async rsvps() {
      return []; // no guest ever answers a mock invite
    },
    async health(): Promise<CalendarHealth> {
      return 'ok'; // tests script other answers with a spy
    },
  };
}

export const mockCalendar: CalendarGateway = mockCalendarGateway({ target: () => MOCK_APP_CALENDAR_ID });
