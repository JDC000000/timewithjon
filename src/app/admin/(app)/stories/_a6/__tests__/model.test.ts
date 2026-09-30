// T2.9.U1 / T3.7.U1: the A6 words for a story row (wireframe 09 A6) and the "Add emailed story" checks.
import { describe, expect, it } from 'vitest';
import { ERRORS } from '@/content';
import {
  addedLine,
  emailedStoryErrors,
  spamOutcome,
  storyContext,
  storyMeta,
  storyStatus,
  storyWho,
} from '../model';

type S = Parameters<typeof storyMeta>[0];
const priya: S = {
  fromName: 'Priya',
  source: 'after_send',
  consent: true,
  spamSuspect: false,
  request: { id: 'r1', dish: 'the-long-lunch', dishName: 'The Long Lunch', contactName: 'Priya S' },
};

describe('A6 story rows', () => {
  it('reads like the wireframe: "Priya · after The Long Lunch · OK for the book"', () => {
    expect(storyWho(priya)).toBe('Priya');
    expect(storyMeta(priya)).toEqual(['after The Long Lunch', 'OK for the book']);
    expect(storyMeta({ ...priya, consent: false })).toEqual(['after The Long Lunch', 'not for the book']);
  });
  it('falls back to the booking guest, then to "No name"; blank names count as none', () => {
    expect(storyWho({ ...priya, fromName: '  ' })).toBe('Priya S');
    expect(storyWho({ ...priya, fromName: null, request: null })).toBe('No name');
  });
  it('an emailed story says "sent by email"; a story with neither dish nor email has no context', () => {
    const emailed: S = { ...priya, source: 'email_in', request: null };
    expect(storyContext(emailed)).toBe('sent by email');
    expect(storyContext({ ...priya, source: 'story_page', request: null })).toBeNull();
    expect(storyMeta({ ...priya, source: 'story_page', request: null })).toEqual(['OK for the book']);
    // a request whose dish left the menu: no "after …", and not "sent by email" either
    expect(storyContext({ ...priya, request: { ...priya.request!, dishName: null } })).toBeNull();
  });
  it('a spam suspect is "possible spam", whatever its consent says', () => {
    expect(storyStatus({ ...priya, spamSuspect: true })).toBe('possible spam');
    expect(storyStatus({ ...priya, spamSuspect: true, consent: false })).toBe('possible spam');
  });
});

describe('Add emailed story checks', () => {
  const ok = { name: 'Dana', email: 'dana@example.com', story: 'The van.', photos: 0 };
  it('a filled form is ready', () => {
    expect(emailedStoryErrors(ok)).toEqual({});
    expect(emailedStoryErrors({ ...ok, photos: 5 })).toEqual({});
  });
  it('names each missing or bad field', () => {
    expect(emailedStoryErrors({ name: ' ', email: 'nope', story: '\n', photos: 6 })).toEqual({
      name: 'Add their name.',
      email: ERRORS.badEmail,
      story: 'Paste the story.',
      photos: 'Up to 5 photos.',
    });
  });
  it('keeps to the route limits (80 / 254 / 5000)', () => {
    expect(emailedStoryErrors({ ...ok, name: 'x'.repeat(80) }).name).toBeUndefined();
    expect(emailedStoryErrors({ ...ok, name: 'x'.repeat(81) }).name).toBeDefined();
    expect(emailedStoryErrors({ ...ok, story: 'x'.repeat(5000) }).story).toBeUndefined();
    expect(emailedStoryErrors({ ...ok, story: 'x'.repeat(5001) }).story).toBeDefined();
    const long = `${'a'.repeat(242)}@example.com`; // 254
    expect(emailedStoryErrors({ ...ok, email: long }).email).toBeUndefined();
    expect(emailedStoryErrors({ ...ok, email: `a${long}` }).email).toBeDefined();
    expect(emailedStoryErrors({ ...ok, email: 'a b@example.com' }).email).toBeDefined();
    expect(emailedStoryErrors({ ...ok, email: ' dana@example.com ' }).email).toBeUndefined();
  });
});

describe('addedLine (?added=<photos that failed>)', () => {
  it('says added, or how many photos didn’t upload', () => {
    expect(addedLine('0')).toBe('Added to the book pile.');
    expect(addedLine('1')).toBe('Added to the book pile, but 1 photo didn’t upload.');
    expect(addedLine('3')).toBe('Added to the book pile, but 3 photos didn’t upload.');
  });
  it('ignores anything else', () => {
    for (const raw of [undefined, '', 'x', '-1', '1.5', '100', ['0']]) expect(addedLine(raw)).toBeNull();
  });
});

describe('spamOutcome (A6 Not spam / Delete, idempotent)', () => {
  const r = (status: number, code: string | null = null) => ({ status, code });
  it('Not spam: done, or already done elsewhere, is cleared; a vanished story is gone', () => {
    expect(spamOutcome('not-spam', r(200))).toBe('cleared');
    expect(spamOutcome('not-spam', r(409, 'not_spam_suspect'))).toBe('cleared');
    expect(spamOutcome('not-spam', r(404, 'not_found'))).toBe('gone');
  });
  it('Delete: done or already gone is gone; marked not spam elsewhere is cleared', () => {
    expect(spamOutcome('delete', r(200))).toBe('gone');
    expect(spamOutcome('delete', r(404, 'not_found'))).toBe('gone');
    expect(spamOutcome('delete', r(409, 'not_spam_suspect'))).toBe('cleared');
  });
  it('anything else fails and leaves the choice open', () => {
    expect(spamOutcome('delete', r(409, 'has_photos'))).toBe('failed');
    expect(spamOutcome('not-spam', r(500))).toBe('failed');
    expect(spamOutcome('not-spam', r(0))).toBe('failed');
    expect(spamOutcome('delete', r(409, null))).toBe('failed');
  });
});
