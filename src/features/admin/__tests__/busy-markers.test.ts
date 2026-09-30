// T3.5.02: busyMarkers clips Jon's main-calendar busy time to a week and removes the app's own bookings (J2).
import { describe, expect, it } from 'vitest';
import { busyMarkers } from '../busy-markers';

const t = (hhmm: string, day = '2027-05-21') => new Date(`${day}T${hhmm}:00Z`);
const iv = (a: string, b: string, day?: string) => ({ start: t(a, day), end: t(b, day) });
const out = (a: string, b: string, day = '2027-05-21') => ({
  startsAt: t(a, day).toISOString(),
  endsAt: t(b, day).toISOString(),
});
const FROM = t('00:00', '2027-05-17');
const TO = t('00:00', '2027-05-24');

describe('busyMarkers (T3.5.02)', () => {
  it('passes busy time inside the week through, sorted', () => {
    expect(busyMarkers([iv('18:00', '20:00'), iv('09:00', '10:00')], [], FROM, TO)).toEqual([
      out('09:00', '10:00'),
      out('18:00', '20:00'),
    ]);
  });

  it('clips to the week; time wholly outside it is dropped', () => {
    const across = { start: t('22:00', '2027-05-16'), end: t('02:00', '2027-05-17') };
    const after = { start: t('00:00', '2027-05-24'), end: t('01:00', '2027-05-24') };
    const tail = { start: t('23:00', '2027-05-23'), end: t('01:00', '2027-05-24') };
    expect(busyMarkers([across, after, tail], [], FROM, TO)).toEqual([
      out('00:00', '02:00', '2027-05-17'),
      { startsAt: t('23:00', '2027-05-23').toISOString(), endsAt: TO.toISOString() },
    ]);
  });

  it("the app's own booking exactly = no marker (J2: it comes back through the attendee copy)", () => {
    expect(busyMarkers([iv('18:00', '20:00')], [iv('18:00', '20:00')], FROM, TO)).toEqual([]);
  });

  it('a booking merged with an adjacent real event leaves the event only (either side)', () => {
    expect(busyMarkers([iv('18:00', '21:00')], [iv('18:00', '20:00')], FROM, TO)).toEqual([
      out('20:00', '21:00'),
    ]);
    expect(busyMarkers([iv('17:00', '20:00')], [iv('18:00', '20:00')], FROM, TO)).toEqual([
      out('17:00', '18:00'),
    ]);
  });

  it('a booking inside a longer busy block splits it in two', () => {
    expect(busyMarkers([iv('12:00', '22:00')], [iv('18:00', '20:00')], FROM, TO)).toEqual([
      out('12:00', '18:00'),
      out('20:00', '22:00'),
    ]);
  });

  it('bookings that only touch or miss the busy time change nothing', () => {
    expect(
      busyMarkers(
        [iv('12:00', '13:00')],
        [iv('13:00', '14:00'), iv('11:00', '12:00'), iv('20:00', '21:00')],
        FROM,
        TO,
      ),
    ).toEqual([out('12:00', '13:00')]);
  });

  it('several bookings over several busy blocks', () => {
    expect(
      busyMarkers(
        [iv('08:00', '12:00'), iv('17:00', '23:00')],
        [iv('09:00', '10:00'), iv('11:30', '12:00'), iv('17:00', '19:00'), iv('21:00', '23:00')],
        FROM,
        TO,
      ),
    ).toEqual([out('08:00', '09:00'), out('10:00', '11:30'), out('19:00', '21:00')]);
  });

  it('no busy time: no markers', () => {
    expect(busyMarkers([], [iv('18:00', '20:00')], FROM, TO)).toEqual([]);
  });
});
