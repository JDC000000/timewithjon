// U4 pure logic: the photo picker state (T1.8.U2), the story Send decision/body (T1.8.U1) and the guest time style.
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PHOTOS,
  canPreview,
  doneCount,
  isUploading,
  photoReducer,
  roomLeft,
  type PhotoState,
} from '../photo-state';
import { decideSubmit, storyBody } from '../story-submit';
import { clock, clockRange, dateLabel, slotLabel } from '../when';
import { guestFromAddress, standbyDays } from '../../sent/model';

const file = (name = 'a.jpg') => new File(['x'], name, { type: 'image/jpeg' });
const add = (s: PhotoState, keys: string[], max = 2) =>
  photoReducer(s, { type: 'add', items: keys.map((key) => ({ key, file: file(), preview: null })) }, max);

describe('photoReducer', () => {
  it('adds photos as uploading, capped at max (extra files in one pick are dropped)', () => {
    const s = add(EMPTY_PHOTOS, ['p1', 'p2', 'p3']);
    expect(s.items.map((p) => [p.key, p.status])).toEqual([
      ['p1', 'uploading'],
      ['p2', 'uploading'],
    ]);
    expect(roomLeft(s, 2)).toBe(0);
    expect(add(s, ['p4'])).toBe(s);
  });
  it('an empty add changes nothing', () => {
    expect(add(EMPTY_PHOTOS, [])).toBe(EMPTY_PHOTOS);
  });
  it('uploading → done or failed; failed → retry → uploading; done never goes back', () => {
    let s = add(EMPTY_PHOTOS, ['p1', 'p2']);
    s = photoReducer(s, { type: 'done', key: 'p1' }, 2);
    s = photoReducer(s, { type: 'failed', key: 'p2' }, 2);
    expect(s.items.map((p) => p.status)).toEqual(['done', 'failed']);
    expect(photoReducer(s, { type: 'failed', key: 'p1' }, 2)).toBe(s);
    expect(photoReducer(s, { type: 'retry', key: 'p1', preview: null }, 2)).toBe(s);
    expect(photoReducer(s, { type: 'done', key: 'p2' }, 2)).toBe(s);
    s = photoReducer(s, { type: 'retry', key: 'p2', preview: null }, 2);
    expect(s.items[1]!.status).toBe('uploading');
    expect(s.items[0]!.status).toBe('done');
  });
  it('pr90 F7: a failed photo drops its (revoked) preview; a retry carries the fresh one', () => {
    let s = photoReducer(
      EMPTY_PHOTOS,
      { type: 'add', items: [{ key: 'p1', file: new File(['x'], 'a.jpg'), preview: 'blob:one' }] },
      2,
    );
    s = photoReducer(s, { type: 'failed', key: 'p1' }, 2);
    expect(s.items[0]).toMatchObject({ status: 'failed', preview: null });
    s = photoReducer(s, { type: 'retry', key: 'p1', preview: 'blob:two' }, 2);
    expect(s.items[0]).toMatchObject({ status: 'uploading', preview: 'blob:two' });
  });
  it('keeps each photo key stable (INT-06) and removes by key; a late result for a removed photo is a no-op', () => {
    let s = add(EMPTY_PHOTOS, ['p1', 'p2']);
    s = photoReducer(s, { type: 'remove', key: 'p1' }, 2);
    expect(s.items.map((p) => p.key)).toEqual(['p2']);
    expect(roomLeft(s, 2)).toBe(1);
    expect(photoReducer(s, { type: 'done', key: 'p1' }, 2)).toBe(s);
    expect(photoReducer(s, { type: 'remove', key: 'p1' }, 2)).toBe(s);
  });
  it('roomLeft never goes below zero; counts and flags', () => {
    const s = add(EMPTY_PHOTOS, ['p1', 'p2']);
    expect(roomLeft(s, 1)).toBe(0);
    expect(isUploading(s)).toBe(true);
    expect(doneCount(s)).toBe(0);
    const d = photoReducer(photoReducer(s, { type: 'done', key: 'p1' }, 2), { type: 'failed', key: 'p2' }, 2);
    expect(isUploading(d)).toBe(false);
    expect(doneCount(d)).toBe(1);
  });
  it('previews only what an <img> can show', () => {
    expect(canPreview('image/jpeg')).toBe(true);
    expect(canPreview('image/webp')).toBe(true);
    expect(canPreview('image/heic')).toBe(false);
    expect(canPreview('x-image/jpeg')).toBe(false);
    expect(canPreview('image/jpegx')).toBe(false);
  });
});

describe('decideSubmit (R7-01, wireframe 07 B)', () => {
  const done = photoReducer(add(EMPTY_PHOTOS, ['p1']), { type: 'done', key: 'p1' }, 2);
  const failed = photoReducer(add(EMPTY_PHOTOS, ['p1']), { type: 'failed', key: 'p1' }, 2);
  it('holds an empty send (blank text, no finished photo)', () => {
    expect(decideSubmit('', EMPTY_PHOTOS)).toBe('empty');
    expect(decideSubmit('  \n ', EMPTY_PHOTOS)).toBe('empty');
    expect(decideSubmit('', failed)).toBe('empty');
  });
  it('sends with a line or a finished photo', () => {
    expect(decideSubmit('The ferry', EMPTY_PHOTOS)).toBe('send');
    expect(decideSubmit('', done)).toBe('send');
  });
  it('waits while a photo uploads, even with text', () => {
    expect(decideSubmit('The ferry', add(EMPTY_PHOTOS, ['p1']))).toBe('wait');
  });
});

describe('storyBody', () => {
  it('trims answers and leaves blank ones out; consent always goes', () => {
    expect(storyBody({ body: '  hi ', consent: true, before60Answer: ' Iceland ', hp: '' })).toEqual({
      consent: true,
      body: 'hi',
      before60Answer: 'Iceland',
    });
    expect(storyBody({ body: ' ', consent: false, before60Answer: ' ', hp: '' })).toEqual({ consent: false });
    expect(storyBody({ body: '', consent: false, hp: 'bot' })).toEqual({ consent: false, hp: 'bot' });
  });
});

describe('guest time style (gen.py tile(), G1 #14/#19)', () => {
  const at = (iso: string) => new Date(iso);
  it('clock', () => {
    expect(clock(at('2027-05-14T19:00:00Z'))).toBe('noon');
    expect(clock(at('2027-05-15T07:00:00Z'))).toBe('midnight');
    expect(clock(at('2027-05-15T02:00:00Z'))).toBe('7 pm');
    expect(clock(at('2027-05-14T16:30:00Z'))).toBe('9:30 am');
    expect(clock(at('2027-05-14T19:30:00Z'))).toBe('12:30 pm'); // the noon hour is pm
    expect(clock(at('2027-05-14T16:30:00Z'), false)).toBe('9:30');
    expect(clock(at('2027-05-14T20:00:00Z'))).toBe('1 pm');
  });
  it('clockRange drops the first am/pm only when both ends share it', () => {
    expect(clockRange(at('2027-05-14T19:00:00Z'), at('2027-05-14T21:00:00Z'))).toBe('noon–2 pm');
    expect(clockRange(at('2027-05-14T17:00:00Z'), at('2027-05-14T18:30:00Z'))).toBe('10–11:30 am');
    expect(clockRange(at('2027-05-14T18:00:00Z'), at('2027-05-14T20:00:00Z'))).toBe('11 am–1 pm');
  });
  it('slotLabel: lunch shows the range, evening the start', () => {
    const s = at('2027-05-14T19:00:00Z');
    const e = at('2027-05-14T21:00:00Z');
    expect(slotLabel(s, e, 'lunch')).toBe('Fri May 14 · noon–2 pm');
    expect(slotLabel(s, e, null)).toBe('Fri May 14 · noon–2 pm');
    expect(slotLabel(at('2027-05-22T02:00:00Z'), at('2027-05-22T05:00:00Z'), 'evening')).toBe(
      'Fri May 21 · 7 pm',
    );
  });
  it('dateLabel', () => {
    expect(dateLabel('2027-05-08')).toBe('Sat May 8');
  });
});

describe('S11 model helpers', () => {
  it('guestFromAddress shows the bare address', () => {
    expect(guestFromAddress(undefined)).toBe('jon@timewithjon.com');
    expect(guestFromAddress('Jon <jon@example.com>')).toBe('jon@example.com');
    expect(guestFromAddress('jon@example.com')).toBe('jon@example.com');
  });
  it('standbyDays: the Thursday and Friday of the week, across a month end too', () => {
    expect(standbyDays('2027-04-12')).toBe('Apr 15–16');
    expect(standbyDays('2027-04-26')).toBe('Apr 29–30');
    expect(standbyDays('2027-05-24')).toBe('May 27–28');
    expect(standbyDays('2027-06-28')).toBe('Jul 1–2');
    expect(standbyDays('2027-03-29')).toBe('Apr 1–2');
    expect(standbyDays('2022-06-27')).toBe('Jun 30–Jul 1');
  });
});

// Banned words / em-dash for this copy: src/content/__tests__/content.test.ts (AC1), the one file allowed to hold the list.
describe('guest-after copy', () => {
  it('STALE is ERRORS.stale split in two, word for word (typographic apostrophes, like all guest copy)', async () => {
    const { ERRORS } = await import('@/content');
    const { STALE, AFTER_SEND_STANDBY } = await import('@/content/ui/guest-after');
    expect(`${STALE.title} ${STALE.body}`).toBe(ERRORS.stale);
    const lines = [AFTER_SEND_STANDBY.promise('Apr 12'), STALE.title, STALE.body];
    for (const line of lines) expect(line).not.toContain("'");
  });
});
