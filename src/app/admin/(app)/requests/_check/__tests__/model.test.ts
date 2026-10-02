// T2.9.U2: what each Check these answer means for the optimistic screen (done keeps it, rollback undoes it).
import { describe, expect, it } from 'vitest';
import { checkOutcome, checkUrl } from '../model';

describe('checkOutcome', () => {
  it('200 is done for both answers', () => {
    expect(checkOutcome('not-spam', { status: 200 })).toBe('done');
    expect(checkOutcome('delete', { status: 200 })).toBe('done');
  });
  it('idempotent: Not spam on a cleared row and Delete on a gone row are done', () => {
    expect(checkOutcome('not-spam', { status: 409, code: 'not_spam_suspect' })).toBe('done');
    expect(checkOutcome('delete', { status: 404, code: 'not_found' })).toBe('done');
  });
  it('everything else rolls back (a real request is never deleted: 409 not_spam_suspect on Delete)', () => {
    expect(checkOutcome('delete', { status: 409, code: 'not_spam_suspect' })).toBe('rollback');
    expect(checkOutcome('not-spam', { status: 404, code: 'not_found' })).toBe('rollback');
    for (const status of [0, 401, 403, 500]) {
      expect(checkOutcome('not-spam', { status })).toBe('rollback');
      expect(checkOutcome('delete', { status })).toBe('rollback');
    }
  });
  it('uses the merged T2.9.04 routes', () => {
    expect(checkUrl('not-spam', 'x')).toEqual({ method: 'POST', url: '/api/admin/requests/x/not-spam' });
    expect(checkUrl('delete', 'x')).toEqual({ method: 'DELETE', url: '/api/admin/requests/x/spam' });
  });
});
