// T2.3.02 / TSD §7: the Google event is "{Dish}: {first name}", described by crew and where only.
import { describe, expect, it } from 'vitest';
import { calendarEvent } from '@/features/calendar/event';

const row = {
  status: 'locked',
  dish: 'the-long-lunch',
  contact_name: '  Dave  van Dyke ',
  contact_email: 'dave@example.com',
  crew_size: 4,
  locked_starts_at: new Date('2027-05-13T19:00:00Z'),
  locked_ends_at: new Date('2027-05-13T21:00:00Z'),
  locked_where: 'The pier',
  google_event_id: null,
  calendar_state: 'pending',
};

describe('calendarEvent', () => {
  it('summary, description, times and the guest as attendee', () => {
    expect(calendarEvent('req-1', row)).toEqual({
      requestId: 'req-1',
      summary: 'The Long Lunch: Dave',
      description: 'Crew: 4\nWhere: The pier',
      startsAt: row.locked_starts_at,
      endsAt: row.locked_ends_at,
      attendees: ['dave@example.com'],
    });
  });
  it('joined guests are attendees after the host, once each (§6 "Joined requests" rules 2, 3 and 5)', () => {
    expect(
      calendarEvent('req-1', row, ['sue@example.com', 'dave@example.com', 'amir@example.com']).attendees,
    ).toEqual(['dave@example.com', 'sue@example.com', 'amir@example.com']);
  });
  it('AD-6: once the guest has the .ics, the Google event leaves them off; joined guests stay', () => {
    const ics = { ...row, calendar_state: 'ics_sent' };
    expect(calendarEvent('req-1', ics).attendees).toEqual([]);
    expect(calendarEvent('req-1', ics, ['sue@example.com', 'dave@example.com']).attendees).toEqual([
      'sue@example.com',
    ]);
  });
  it('no place yet: crew only', () => {
    expect(calendarEvent('req-1', { ...row, locked_where: null }).description).toBe('Crew: 4');
  });
});
