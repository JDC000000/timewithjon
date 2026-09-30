// pr90 F4: ruling B enforced by CI, not only by review. Every guest string in src/content/ui/guest-after.ts must be
// in the checked-in allowlist tests/unit/fixtures/guest-after-approved.json, word for word (functions rendered with
// {0}, {1}, …), and the allowlist holds nothing that isn't shipped. A new uncited line fails here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as guestAfter from '@/content/ui/guest-after';

const FIXTURE = path.resolve(__dirname, 'fixtures/guest-after-approved.json');

function shipped(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, group] of Object.entries(guestAfter)) {
    for (const [key, v] of Object.entries(group as Record<string, unknown>)) {
      if (typeof v === 'string') out[`${name}.${key}`] = v;
      else if (typeof v === 'function') {
        const fn = v as (...a: string[]) => string;
        out[`${name}.${key}`] = fn(...Array.from({ length: fn.length }, (_, i) => `{${i}}`));
      } else throw new Error(`${name}.${key}: not a string or a line function`);
    }
  }
  return out;
}

describe('guest-after copy allowlist (pr90 F4, ruling B, Jon decision 49)', () => {
  const approved = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, string>;
  delete approved._comment;

  it('every shipped string is in the allowlist, word for word', () => {
    const unapproved = Object.entries(shipped()).filter(([k, s]) => approved[k] !== s);
    expect(unapproved).toEqual([]);
  });
  it('the allowlist has no line that no longer ships (it stays a true list)', () => {
    const live = shipped();
    expect(Object.keys(approved).filter((k) => !(k in live))).toEqual([]);
  });
  it('holds all 8 lines of decision 49', () => {
    const d49 = ['STORY_FORM.waiting', 'PHOTO_PICKER.added', 'PHOTO_PICKER.uploading', 'PHOTO_PICKER.stop'];
    d49.push(
      'PHOTO_PICKER.failed',
      'PHOTO_PICKER.full',
      'PHOTO_PICKER.photoName',
      'AFTER_SEND_STANDBY.receiptLine',
    );
    for (const k of d49) expect(approved[k], k).toBeTruthy();
  });
});
