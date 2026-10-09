// ENG-01/ENG-14: a guest form's idempotency key belongs to one body; the server's payload hash is canonical.
import { describe, expect, it } from 'vitest';
import { keyFor } from '@/lib/client-key';
import { payloadHash } from '@/lib/payload-hash';

let n = 0;
const fresh = () => `k${++n}`;

describe('keyFor (the browser side)', () => {
  it('keeps the key for a retry of the same body, and gives an edited body a new one', () => {
    const first = keyFor(null, { email: 'typo@example.com', slotIds: ['a'] }, fresh);
    expect(keyFor(first, { email: 'typo@example.com', slotIds: ['a'] }, fresh)).toBe(first);
    const fixed = keyFor(first, { email: 'fixed@example.com', slotIds: ['a'] }, fresh);
    expect(fixed.key).not.toBe(first.key);
    expect(keyFor(fixed, { email: 'fixed@example.com', slotIds: ['b'] }, fresh).key).not.toBe(fixed.key);
  });
});

describe('payloadHash (the server side)', () => {
  it('is the same for the same body in any key order, ignores undefined keys, and differs for any edit', () => {
    const a = payloadHash({ email: 'x@example.com', slotIds: ['a', 'b'], note: undefined });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadHash({ slotIds: ['a', 'b'], email: 'x@example.com' })).toBe(a);
    expect(payloadHash({ slotIds: ['b', 'a'], email: 'x@example.com' })).not.toBe(a); // order of picks is data
    expect(payloadHash({ slotIds: ['a', 'b'], email: 'y@example.com' })).not.toBe(a);
    expect(payloadHash({ slotIds: ['a', 'b'], email: 'x@example.com', note: '' })).not.toBe(a);
  });
});
