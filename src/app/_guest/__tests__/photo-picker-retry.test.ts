// T3.6.U1 AC2: the retry policy behind every upload step (3 tries, refusals and aborts end it at once).
import { describe, expect, it, vi } from 'vitest';
import { UPLOAD_ATTEMPTS, withRetries } from '../photo-state';

const noWait = () => Promise.resolve();
const failing = (n: number) =>
  vi.fn(async (attempt: number) => {
    if (attempt <= n) throw new Error(`try ${attempt}`);
    return 'ok';
  });

describe('withRetries', () => {
  it('is 3 tries', () => expect(UPLOAD_ATTEMPTS).toBe(3));
  it('2 failures then success: resolves on the 3rd try', async () => {
    const step = failing(2);
    await expect(withRetries(step, { signal: new AbortController().signal, wait: noWait })).resolves.toBe(
      'ok',
    );
    expect(step).toHaveBeenCalledTimes(3);
  });
  it('3 failures: rejects with the last error after exactly 3 tries', async () => {
    const step = failing(3);
    await expect(withRetries(step, { signal: new AbortController().signal, wait: noWait })).rejects.toThrow(
      'try 3',
    );
    expect(step).toHaveBeenCalledTimes(3);
  });
  it('a final error (a refusal) is not retried', async () => {
    const step = failing(3);
    const r = withRetries(step, { signal: new AbortController().signal, wait: noWait, isFinal: () => true });
    await expect(r).rejects.toThrow('try 1');
    expect(step).toHaveBeenCalledTimes(1);
  });
  it('an abort (Stop) ends the retries', async () => {
    const ac = new AbortController();
    const step = failing(3);
    const wait = vi.fn(async () => ac.abort());
    await expect(withRetries(step, { signal: ac.signal, wait })).rejects.toThrow('try 1');
    expect(step).toHaveBeenCalledTimes(1);
  });
  it('backs off between tries', async () => {
    const wait = vi.fn(noWait);
    await withRetries(failing(2), { signal: new AbortController().signal, wait });
    expect(wait.mock.calls).toEqual([[500], [1000]]);
  });
});
