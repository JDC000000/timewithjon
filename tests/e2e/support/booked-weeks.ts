// tests/e2e/support/booked-weeks.ts — the 2027 weeks (Monday starts) other specs book by a fixed date or by where a
// tile sits in the guest picker. The specs that claim a "free week" of their own (collision-cap,
// encore-longdistance, lock-leave, standby-actions) never claim these, so a week they free after their test is never
// one a date- or picker-driven spec is about to book.
//   2027-03-29  the journey and the picker flows take the first open tiles (Thu Apr 1 / Fri Apr 2)
//   2027-04-05  support/screens.ts (Apr 5)            2027-04-12  guest-after/s11-picker.spec.ts (Apr 12)
//   2027-04-19  guest-after/offer.spec.ts (Apr 19-23)  2027-04-26  guest-after/offer.spec.ts (Apr 29)
//   2027-05-03  admin-season/foc-04.spec.ts (May 3-5) 2027-05-10  guest-after/offer.spec.ts (May 13)
//   2027-05-31  calendar/clash.spec.ts, webkit (the first June tile, Jun 3)
//   2027-06-21  calendar/clash.spec.ts, chromium (the last open tile, Jun 24-25)
export const BOOKED_WEEKS: readonly string[] = [
  '2027-03-29',
  '2027-04-05',
  '2027-04-12',
  '2027-04-19',
  '2027-04-26',
  '2027-05-03',
  '2027-05-10',
  '2027-05-31',
  '2027-06-21',
];
