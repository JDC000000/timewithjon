// decode-gate.ts: at most `max` decodes at once per instance; the rest wait first come, first served, for up to
// `waitMs`, then fail with DecodeBusyError. A decode that finds a free slot starts at once (no timer).
// Regression register: evals/bugs/photo-decodes-uncapped.json
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDecodeGate, decodeGate, DecodeBusyError } from '../decode-gate';
import { DECODE_WAIT_MS, MAX_CONCURRENT_DECODES } from '../limits';
import { ENCODE_TIMEOUT_SECONDS } from '../reencode';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the decode gate', () => {
  it('a decode with a free slot starts at once, without waiting on any timer', async () => {
    const gate = createDecodeGate(2, 15_000);
    const started = vi.fn();
    const done = gate.run(async () => {
      started();
      return 'ok';
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toHaveBeenCalledTimes(1); // no timer was advanced
    expect(vi.getTimerCount()).toBe(0);
    await expect(done).resolves.toBe('ok');
    expect([gate.running, gate.waiting]).toEqual([0, 0]);
  });

  it('never runs more than `max` at once; the rest start in arrival order as slots free up', async () => {
    const gate = createDecodeGate(2, 15_000);
    const jobs = Array.from({ length: 5 }, () => deferred());
    const order: number[] = [];
    let live = 0;
    let peak = 0;
    const all = jobs.map((job, i) =>
      gate.run(async () => {
        order.push(i);
        peak = Math.max(peak, ++live);
        await job.promise;
        live--;
      }),
    );
    await flush();
    expect([gate.running, gate.waiting, order]).toEqual([2, 3, [0, 1]]);
    jobs[1]!.resolve();
    await flush();
    expect(order).toEqual([0, 1, 2]);
    jobs[0]!.resolve();
    jobs[2]!.resolve();
    await flush();
    expect(order).toEqual([0, 1, 2, 3, 4]);
    jobs[3]!.resolve();
    jobs[4]!.resolve();
    await Promise.all(all);
    expect(peak).toBe(2);
    expect([gate.running, gate.waiting]).toEqual([0, 0]);
  });

  it('a decode that throws still frees its slot', async () => {
    const gate = createDecodeGate(1, 15_000);
    await expect(gate.run(async () => Promise.reject(new Error('bad photo')))).rejects.toThrow('bad photo');
    await expect(gate.run(async () => 'next')).resolves.toBe('next');
    expect(gate.running).toBe(0);
  });

  it('a decode that waits longer than waitMs gives up with DecodeBusyError and leaves the queue', async () => {
    const gate = createDecodeGate(1, 15_000);
    const held = deferred();
    const first = gate.run(() => held.promise);
    const second = gate.run(async () => 'never');
    const third = gate.run(async () => 'third');
    const refused = Promise.allSettled([second, third]);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(gate.waiting).toBe(2);
    await vi.advanceTimersByTimeAsync(1); // both have now waited their full 15 s
    const [a, b] = await refused;
    expect(a).toMatchObject({ status: 'rejected', reason: expect.any(DecodeBusyError) });
    expect(b).toMatchObject({ status: 'rejected', reason: expect.any(DecodeBusyError) });
    expect([gate.running, gate.waiting]).toEqual([1, 0]);
    held.resolve();
    await first;
    expect(gate.running).toBe(0);
    await expect(gate.run(async () => 'later')).resolves.toBe('later'); // nothing leaked
  });

  it('a waiter that gets its slot in time is not refused later', async () => {
    const gate = createDecodeGate(1, 15_000);
    const held = deferred();
    const first = gate.run(() => held.promise);
    const second = gate.run(async () => 'second');
    await vi.advanceTimersByTimeAsync(10_000);
    held.resolve();
    await first;
    await expect(second).resolves.toBe('second');
    await vi.advanceTimersByTimeAsync(10_000); // its timer was cleared
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the instance gate uses the limits: 2 at once, a wait that fits the 60 s finalise', () => {
    expect(MAX_CONCURRENT_DECODES).toBe(2);
    expect(DECODE_WAIT_MS + ENCODE_TIMEOUT_SECONDS * 1000).toBeLessThan(60_000);
    expect([decodeGate.running, decodeGate.waiting]).toEqual([0, 0]);
  });
});
