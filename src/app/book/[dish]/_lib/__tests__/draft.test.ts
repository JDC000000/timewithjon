// QA M3: the booking draft's storage rules (sessionStorage, one key per dish, parsed on the way in and out).
import { describe, expect, it } from 'vitest';
import { clearDraft, draftKey, readDraft, writeDraft } from '../draft';

function memoryStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('booking draft (QA M3)', () => {
  it('round-trips per dish', () => {
    const s = memoryStore();
    writeDraft(s, 'the-long-lunch', { picks: ['a', 'b'], email: 'sam@example.com' });
    expect(readDraft(s, 'the-long-lunch')).toEqual({ picks: ['a', 'b'], email: 'sam@example.com' });
    expect(readDraft(s, 'the-flat-white')).toBeNull();
    expect(s.getItem(draftKey('the-long-lunch'))).not.toBeNull();
  });

  it('never keeps the honeypot or a Turnstile token', () => {
    const s = memoryStore();
    writeDraft(s, 'x', { name: 'Sam', hp: 'spam', website: 'spam', turnstileToken: 't' } as never);
    expect(JSON.parse(s.getItem(draftKey('x'))!)).toEqual({ name: 'Sam' });
  });

  it('drops a draft that is not JSON or not the right shape', () => {
    const s = memoryStore();
    s.setItem(draftKey('x'), '{not json');
    expect(readDraft(s, 'x')).toBeNull();
    s.setItem(draftKey('x'), JSON.stringify({ picks: 'a' }));
    expect(readDraft(s, 'x')).toBeNull();
    s.setItem(draftKey('x'), JSON.stringify({ name: 'x'.repeat(81) }));
    expect(readDraft(s, 'x')).toBeNull();
  });

  it('clears; no storage at all is a no-op', () => {
    const s = memoryStore();
    writeDraft(s, 'x', { idea: 'Sailing' });
    clearDraft(s, 'x');
    expect(readDraft(s, 'x')).toBeNull();
    expect(() => writeDraft(null, 'x', {})).not.toThrow();
    expect(readDraft(null, 'x')).toBeNull();
  });

  it('a storage that throws (blocked, full) never breaks the form', () => {
    const s = memoryStore();
    s.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    s.getItem = () => {
      throw new Error('SecurityError');
    };
    expect(() => writeDraft(s, 'x', { idea: 'a' })).not.toThrow();
    expect(readDraft(s, 'x')).toBeNull();
  });
});
