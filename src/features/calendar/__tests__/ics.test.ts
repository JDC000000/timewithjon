// T3.4.03: the .ics builder (RFC 5545 / iTIP): REQUEST and CANCEL, a stable UID, SEQUENCE, escaping, folding.
import { describe, expect, it } from 'vitest';
import { buildIcs, escapeText, foldLine, icsDate, icsUid, type IcsInput } from '../ics';

const REQ = '0b9f6a52-1c3e-4f7a-9d2b-6e8c1a0f4d31';
const input = (over: Partial<IcsInput> = {}): IcsInput => ({
  method: 'REQUEST',
  requestId: REQ,
  sequence: 0,
  startsAt: new Date('2027-05-13T19:30:00Z'),
  endsAt: new Date('2027-05-13T21:30:00Z'),
  summary: 'The Shore Ride: Sam',
  description: 'Crew: 2\nWhere: Jericho, west end',
  organizer: { name: 'Jon', email: 'jon@timewithjon.com' },
  attendee: { name: 'Sam', email: 'sam@example.com' },
  now: new Date('2027-05-01T08:00:05.123Z'),
  ...over,
});
const lines = (ics: string) => ics.replace(/\r\n /g, '').split('\r\n');

describe('buildIcs', () => {
  it('REQUEST: the whole calendar, CRLF line ends, UID <request.id>@timewithjon.com, SEQUENCE 0', () => {
    const ics = buildIcs(input());
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines(ics)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Time with Jon//timewithjon.com//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${REQ}@timewithjon.com`,
      'SEQUENCE:0',
      'DTSTAMP:20270501T080005Z',
      'DTSTART:20270513T193000Z',
      'DTEND:20270513T213000Z',
      'SUMMARY:The Shore Ride: Sam',
      'DESCRIPTION:Crew: 2\\nWhere: Jericho\\, west end',
      'ORGANIZER;CN="Jon":mailto:jon@timewithjon.com',
      'ATTENDEE;CN="Sam";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:sam@example.com',
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ]);
    expect(icsUid(REQ)).toBe(`${REQ}@timewithjon.com`);
  });

  it('CANCEL: same UID, bumped SEQUENCE, STATUS:CANCELLED, no RSVP asked', () => {
    const l = lines(buildIcs(input({ method: 'CANCEL', sequence: 2 })));
    expect(l).toContain('METHOD:CANCEL');
    expect(l).toContain(`UID:${REQ}@timewithjon.com`);
    expect(l).toContain('SEQUENCE:2');
    expect(l).toContain('STATUS:CANCELLED');
    expect(l.find((x) => x.startsWith('ATTENDEE'))).toMatch(/RSVP=FALSE:/);
  });

  it('no DESCRIPTION line when there is none', () => {
    expect(buildIcs(input({ description: '' }))).not.toMatch(/DESCRIPTION/);
  });

  it('refuses a negative or fractional SEQUENCE and an event that does not end after it starts', () => {
    expect(() => buildIcs(input({ sequence: -1 }))).toThrow(RangeError);
    expect(() => buildIcs(input({ sequence: 1.5 }))).toThrow(RangeError);
    expect(() => buildIcs(input({ endsAt: new Date('2027-05-13T19:30:00Z') }))).toThrow(RangeError);
  });

  it('guest-typed names and addresses cannot inject a property or a line', () => {
    const ics = buildIcs(
      input({
        summary: 'A;B,C\\D\r\nATTENDEE:mailto:evil@example.com',
        attendee: { name: 'Sam"\r\nX-EVIL:1;x', email: 'sam@example.com\r\nX-EVIL:2' },
      }),
    );
    const l = lines(ics);
    expect(l.filter((x) => x.startsWith('ATTENDEE'))).toHaveLength(1);
    expect(l.some((x) => x.startsWith('X-EVIL'))).toBe(false);
    expect(l).toContain(String.raw`SUMMARY:A\;B\,C\\D\nATTENDEE:mailto:evil@example.com`);
    expect(l.find((x) => x.startsWith('ATTENDEE'))).toBe(
      'ATTENDEE;CN="SamX-EVIL:1;x";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:sam@example.comX-EVIL2',
    );
  });
});

describe('ics helpers', () => {
  it('icsDate is UTC basic format without milliseconds', () => {
    expect(icsDate(new Date('2027-04-01T07:00:00.999Z'))).toBe('20270401T070000Z');
  });

  it('pr39 F6: other control characters are dropped from TEXT (TAB stays)', () => {
    expect(escapeText('a\u0000b\u0007c\u000bd\u000ce\u001bf\u007fg\th')).toBe('abcdefg\th');
    expect(buildIcs(input({ summary: 'Ride\u0000\u001f' }))).toContain('SUMMARY:Ride\r\n');
  });

  it('pr39 F6: a non-uuid request id is refused (it goes into UID)', () => {
    expect(() => buildIcs(input({ requestId: 'x\r\nATTENDEE:mailto:evil@example.com' }))).toThrow(/uuid/);
    expect(() => buildIcs(input({ requestId: '' }))).toThrow(/uuid/);
  });

  it('escapeText handles every special in order (backslash first)', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf\rg')).toBe(String.raw`a\\b\;c\,d\ne\nf\ng`);
  });

  it('foldLine keeps every physical line within 75 octets and never splits a UTF-8 character', () => {
    const long = `SUMMARY:${'Caf\u00e9 \ud83c\udf0a '.repeat(40)}`;
    const folded = foldLine(long);
    for (const physical of folded.split('\r\n'))
      expect(Buffer.byteLength(physical, 'utf8')).toBeLessThanOrEqual(75);
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((x) => x.startsWith(' ')),
    ).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
    expect(foldLine('x'.repeat(75))).toBe('x'.repeat(75));
    expect(foldLine('x'.repeat(76)).split('\r\n')).toEqual(['x'.repeat(75), ' x']);
  });
});
