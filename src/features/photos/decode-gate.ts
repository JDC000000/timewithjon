// src/features/photos/decode-gate.ts — at most MAX_CONCURRENT_DECODES photo decodes run at once in one server
// instance. A 50 MP photo decodes to ~200 MB of pixels, and one instance can serve several finalise requests at a
// time, so without a cap a handful of large photos arriving together could run it out of memory. A decode that finds
// every slot taken waits its turn (first come, first served) for up to DECODE_WAIT_MS, then gives up with
// DecodeBusyError so the caller can answer "try again" instead of holding the request until it is killed.
import { DECODE_WAIT_MS, MAX_CONCURRENT_DECODES } from './limits';

export class DecodeBusyError extends Error {
  override name = 'DecodeBusyError';
}

export interface DecodeGate {
  run<T>(work: () => Promise<T>): Promise<T>;
  /** Decodes running now (for tests and reporting). */
  readonly running: number;
  /** Decodes waiting for a slot. */
  readonly waiting: number;
}

export function createDecodeGate(max = MAX_CONCURRENT_DECODES, waitMs = DECODE_WAIT_MS): DecodeGate {
  let running = 0;
  const queue: { start: () => void }[] = [];

  const release = () => {
    const next = queue.shift();
    if (next)
      next.start(); // the slot passes straight to the next waiter
    else running--;
  };

  const slot = (): Promise<void> => {
    if (running < max) {
      running++;
      return Promise.resolve(); // a free slot: no timer, no wait
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(timer);
          resolve();
        },
      };
      const timer = setTimeout(() => {
        const at = queue.indexOf(entry);
        if (at >= 0) queue.splice(at, 1);
        reject(new DecodeBusyError(`no decode slot within ${waitMs} ms`));
      }, waitMs);
      queue.push(entry);
    });
  };

  return {
    async run(work) {
      await slot();
      try {
        return await work();
      } finally {
        release();
      }
    },
    get running() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
  };
}

/** The instance's one gate: every decode in reencode.ts goes through it. */
export const decodeGate = createDecodeGate();
