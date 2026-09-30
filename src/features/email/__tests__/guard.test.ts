// T3.2.04 / T3.2 AC5-AC6: the AD-5 guard decision as a table (v1.10 thresholds 60 / 85 / 95).
import { describe, expect, it } from 'vitest';
import { EMAIL_COPY, type TemplateId } from '@/content/emails';
import {
  ceilingFor,
  decide,
  digestEventKey,
  isHourlyDigest,
  nextHour,
  nextQueueOpen,
  PRIORITY,
  type Priority,
} from '@/features/email/guard';

describe('decide(count before this send, priority)', () => {
  const table: [number, Priority, 'send' | 'digest' | 'queue'][] = [
    [0, 3, 'send'],
    [59, 3, 'send'],
    [60, 3, 'digest'], // AC5: at 60 a new E2 goes into the hourly digest
    [84, 3, 'digest'],
    [85, 3, 'queue'],
    [59, 2, 'send'],
    [60, 2, 'send'], // P2 never collapses into Jon's digest
    [84, 2, 'send'],
    [85, 2, 'queue'], // AC5: at 85 an E1 is queued
    [85, 1, 'send'], // ... and an E4 still sends
    [94, 1, 'send'],
    [95, 1, 'queue'], // AC5: at 95 the E4 is queued too
    [120, 1, 'queue'],
    [95, 0, 'send'], // a sign-in still goes out (its cap lives in takeSlot)
    [500, 0, 'send'],
  ];
  it.each(table)('count %i, P%i → %s', (count, p, want) => expect(decide(count, p)).toBe(want));
  it('the hourly digest itself never collapses into a digest, but still waits past the budget', () => {
    expect(decide(70, 3, false)).toBe('send');
    expect(decide(85, 3, false)).toBe('queue');
  });
});

describe('PRIORITY', () => {
  it('classes every template exactly as AD-5 rule 2', () => {
    const byClass = (p: number) =>
      (Object.keys(PRIORITY) as TemplateId[]).filter((t) => PRIORITY[t] === p).sort();
    expect(byClass(1)).toEqual(['E10', 'E11', 'E14', 'E4', 'E4c', 'E5', 'E5b', 'E5j', 'E7']); // E5j (L3): P1 like E5, TSD delta
    expect(byClass(2)).toEqual(['E1', 'E6', 'E8', 'E9']);
    expect(byClass(3)).toEqual(['E12', 'E13', 'E16', 'E2', 'E3']);
    expect(Object.keys(PRIORITY).sort()).toEqual(Object.keys(EMAIL_COPY).sort());
  });
});

describe('waits', () => {
  it('the next-UTC-day queue opens at 00:05 UTC tomorrow, even from 23:59 or 00:00', () => {
    expect(nextQueueOpen(new Date('2027-03-01T23:59:59Z')).toISOString()).toBe('2027-03-02T00:05:00.000Z');
    expect(nextQueueOpen(new Date('2027-03-01T00:00:00Z')).toISOString()).toBe('2027-03-02T00:05:00.000Z');
    expect(nextQueueOpen(new Date('2027-12-31T12:00:00Z')).toISOString()).toBe('2028-01-01T00:05:00.000Z');
  });
  it('a digested email waits for the top of the next UTC hour', () => {
    expect(nextHour(new Date('2027-03-01T13:00:00Z')).toISOString()).toBe('2027-03-01T14:00:00.000Z');
    expect(nextHour(new Date('2027-03-01T23:30:00Z')).toISOString()).toBe('2027-03-02T00:00:00.000Z');
  });
  it('the digest key is the ISO hour, and only an E13 with it is the hourly digest', () => {
    expect(digestEventKey(new Date('2027-03-01T14:59:00Z'))).toBe('hour:2027-03-01T14');
    expect(isHourlyDigest('E13', 'hour:2027-03-01T14')).toBe(true);
    expect(isHourlyDigest('E13', '2027-03-01')).toBe(false);
    expect(isHourlyDigest('E2', 'hour:2027-03-01T14')).toBe(false);
    expect(isHourlyDigest('E13', null)).toBe(false);
  });
});

describe('ceilingFor (pr31 review M1)', () => {
  it('decide() sends exactly when the count is under the ceiling, for every class', () => {
    for (const p of [1, 2, 3] as const)
      for (const digestable of [true, false])
        for (let count = 0; count <= 100; count++)
          expect(decide(count, p, digestable) === 'send').toBe(count < ceilingFor(p, digestable));
    expect([ceilingFor(1), ceilingFor(2), ceilingFor(3), ceilingFor(3, false)]).toEqual([95, 85, 60, 85]);
  });
});
