// T4.3.05 (T3.5 AC3): the mock calendar resolves its write target through the real write guard and logs the
// RESOLVED calendarId, so the E2E log check (tests/e2e/calendar/clash.spec.ts) can fail. Negative control: a
// `primary` target is refused and still shows up in the log. Each gateway here gets its own sink, so nothing
// reaches the process log or test-results/mock-calendar-log.jsonl that the E2E suite reads.
import { describe, expect, it } from 'vitest';
import { CalendarWriteGuardError } from '../google/calendar';
import {
  MOCK_APP_CALENDAR_ID,
  type MockCalendarCall,
  mockCalendarAttendees,
  mockCalendarGateway,
} from '../mock/calendar';
import type { CalendarEvent } from '../types';

const REQ = '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31';
const event: CalendarEvent = {
  requestId: REQ,
  summary: 'The Flat White: Sam',
  description: 'Crew: 1',
  startsAt: new Date('2027-06-10T11:30:00Z'),
  endsAt: new Date('2027-06-10T12:30:00Z'),
  attendees: ['sam@example.com'],
};

function gatewayOn(target: string | null) {
  const calls: MockCalendarCall[] = [];
  return { calls, gw: mockCalendarGateway({ target: () => target, record: (c) => calls.push(c) }) };
}

describe('mock calendar attendees behave as on Google', () => {
  it('a plain patch keeps the attendees; only {attendees: true} changes them; remove forgets them', async () => {
    const { calls, gw } = gatewayOn(MOCK_APP_CALENDAR_ID);
    const { eventId } = await gw.insert(event);
    await gw.patch(eventId, { ...event, attendees: ['sam@example.com', 'kim@example.com'] });
    expect(mockCalendarAttendees(eventId)).toEqual(['sam@example.com']);
    await gw.patch(
      eventId,
      { ...event, attendees: ['sam@example.com', 'kim@example.com'] },
      { attendees: true },
    );
    expect(mockCalendarAttendees(eventId)).toEqual(['sam@example.com', 'kim@example.com']);
    expect(calls.map((c) => c.attendees)).toEqual([
      ['sam@example.com'],
      ['sam@example.com'],
      ['sam@example.com', 'kim@example.com'],
    ]);
    await gw.remove(eventId);
    expect(mockCalendarAttendees(eventId)).toBeUndefined();
  });
});

describe('mock calendar write target (T3.5 AC3)', () => {
  it('logs the stored app calendar it resolved, once per write', async () => {
    const { calls, gw } = gatewayOn(MOCK_APP_CALENDAR_ID);
    const { eventId } = await gw.insert(event);
    await gw.patch(eventId, event);
    await gw.remove(eventId);
    expect(calls.map((c) => [c.method, c.calendarId, c.outcome])).toEqual([
      ['insert', MOCK_APP_CALENDAR_ID, 'written'],
      ['patch', MOCK_APP_CALENDAR_ID, 'written'],
      ['remove', MOCK_APP_CALENDAR_ID, 'written'],
    ]);
    expect(calls[0]?.requestId).toBe(REQ);
  });

  it('logs whichever secondary calendar is stored, not a constant', async () => {
    const other = 'abc123@group.calendar.google.com';
    const { calls, gw } = gatewayOn(other);
    await gw.insert(event);
    expect(calls.map((c) => c.calendarId)).toEqual([other]);
  });

  // Negative control: the exact predicates of clash.spec.ts would catch this entry.
  it.each(['primary', 'PRIMARY', 'jon@example.com'])(
    'refuses a %s target and logs it as refused',
    async (target) => {
      const { calls, gw } = gatewayOn(target);
      await expect(gw.insert(event)).rejects.toBeInstanceOf(CalendarWriteGuardError);
      await expect(gw.patch('mock-1', event)).rejects.toBeInstanceOf(CalendarWriteGuardError);
      await expect(gw.remove('mock-1')).rejects.toBeInstanceOf(CalendarWriteGuardError);
      expect(calls.map((c) => [c.method, c.calendarId, c.outcome])).toEqual([
        ['insert', target, 'refused'],
        ['patch', target, 'refused'],
        ['remove', target, 'refused'],
      ]);
      expect(calls.every((c) => /@group\.calendar\.google\.com$/.test(c.calendarId))).toBe(false);
    },
  );

  it('refuses a missing target (never connected)', async () => {
    const { calls, gw } = gatewayOn(null);
    await expect(gw.insert(event)).rejects.toBeInstanceOf(CalendarWriteGuardError);
    expect(calls).toMatchObject([{ method: 'insert', calendarId: '', outcome: 'refused' }]);
  });
});
