// processOutbox's payload wiring, without a database: a row with {attendees: true} (a joined guest came or went)
// patches with {attendees: true}, a plain row patches content only, and a {resync: true} row inserts (the 409
// path then converges the attendee list too, google-calendar.test.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  claim: { request_id: 'req-1', attempts: 1, kind: 'calendar_patch', resync: false, attendees: false },
  patch: vi.fn(async () => undefined),
  insert: vi.fn(async () => ({ eventId: 'ev1' })),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/report', () => ({ report: vi.fn(), errorName: (e: unknown) => String(e) }));
vi.mock('@/features/email/send', () => ({ deliverEmail: vi.fn() }));
vi.mock('@/features/calendar/ics-email', () => ({ queueIcsEmail: vi.fn() }));
vi.mock('@/lib/adapters', () => ({
  adapters: () => ({ calendar: { patch: m.patch, insert: m.insert, remove: vi.fn() } }),
}));
vi.mock('@/lib/db', () => ({
  withTx: vi.fn(),
  q: vi.fn(async (sql: string) => {
    if (sql.includes('update outbox o') && sql.includes('returning o.request_id')) return [m.claim];
    if (sql.includes('from request where id = $1 and joined_to_request_id is null'))
      return [
        {
          status: 'locked',
          dish: 'the-long-lunch',
          contact_name: 'Dave',
          contact_email: 'dave@example.com',
          crew_size: 2,
          locked_starts_at: new Date('2027-05-13T19:00:00Z'),
          locked_ends_at: new Date('2027-05-13T21:00:00Z'),
          locked_where: null,
          google_event_id: 'ev1',
          calendar_state: 'synced',
        },
      ];
    if (sql.includes('where joined_to_request_id = $1')) return [{ contact_email: 'kim@example.com' }];
    return [];
  }),
}));

const { processOutbox } = await import('@/features/calendar/outbox');

describe('processOutbox payload wiring', () => {
  beforeEach(() => {
    m.patch.mockClear();
    m.insert.mockClear();
  });

  it('{attendees: true}: the patch syncs the attendee list (host plus joined guests)', async () => {
    m.claim = { ...m.claim, attendees: true, resync: false };
    expect(await processOutbox('row-1', { inline: true })).toBe('synced');
    expect(m.patch).toHaveBeenCalledWith(
      'ev1',
      expect.objectContaining({ attendees: ['dave@example.com', 'kim@example.com'] }),
      { attendees: true },
    );
  });

  it('a plain patch row sends content only', async () => {
    m.claim = { ...m.claim, attendees: false, resync: false };
    await processOutbox('row-2', { inline: true });
    expect(m.patch).toHaveBeenCalledWith('ev1', expect.any(Object), undefined);
  });

  it('{resync: true}: inserts even with an event id (the 409 converges content and attendees)', async () => {
    m.claim = { ...m.claim, attendees: false, resync: true };
    await processOutbox('row-3', { inline: true });
    expect(m.insert).toHaveBeenCalledWith(
      expect.objectContaining({ attendees: ['dave@example.com', 'kim@example.com'] }),
    );
    expect(m.patch).not.toHaveBeenCalled();
  });
});
