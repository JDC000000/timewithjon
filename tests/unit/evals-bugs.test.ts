// The regression register (evals/bugs/): one JSON file per fixed bug, named after its id, so parallel fix PRs each
// add their own file instead of editing one shared list. This test keeps the register well formed: every file parses
// to one entry, its id matches its file name, ids are unique (case-insensitively, for case-insensitive file systems),
// and every test file an entry points at exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(ROOT, 'evals/bugs');
const ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

type Entry = Record<string, unknown> & { id: string };

const files = readdirSync(DIR).sort();
const entries: { file: string; entry: Entry }[] = files
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({ file, entry: JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as Entry }));

/** The test paths an entry names. Older entries use `test` (one path, sometimes with a "(case)" note), newer `tests`. */
function testPaths(entry: Entry): unknown[] {
  const raw = entry.tests ?? entry.test;
  return (Array.isArray(raw) ? raw : [raw]).map((t) =>
    typeof t === 'string' ? t.replace(/ \(.*\)$/, '') : t,
  );
}

/** Each named test file with its "(case)" note, if any: "tests/int/manage.int.test.ts (B001)" -> B001. */
function namedTests(entry: Entry): { file: string; tag: string | null }[] {
  const raw = entry.tests ?? entry.test;
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => {
      const m = /^(.*?)(?: \((.*)\))?$/.exec(t)!;
      return { file: m[1]!, tag: m[2] ?? null };
    });
}

/** The named files that never mention the entry (its id, or its "(case)" note): a test that doesn't say what it guards. */
function unmentioned(
  entry: Entry,
  read: (file: string) => string = (f) => readFileSync(path.join(ROOT, f), 'utf8'),
  exists: (file: string) => boolean = (f) => existsSync(path.join(ROOT, f)),
): string[] {
  return namedTests(entry)
    .filter(({ file }) => exists(file))
    .filter(({ file, tag }) => {
      const text = read(file);
      return !text.includes(entry.id) && !(tag && text.includes(tag));
    })
    .map(({ file }) => file);
}

/**
 * Entries from before the rule that each named test file mentions its bug. Frozen: the list only shrinks. Add the id
 * (e.g. a "Regression register: evals/bugs/<id>.json" comment) to its test files, then take the id off this list; the
 * test below fails while a listed id already passes, so a fixed one can't stay here.
 */
const LEGACY_UNMENTIONED = new Set<string>([
  'BUG-001',
  'BUG-002',
  'a2-row-joined-guest-no-time',
  'admin-guest-zone-hidden',
  'admin-locked-banner-outlives-lock',
  'admin-overnight-not-shown',
  'admin-rough-window-missing',
  'admin-signin-email-off-design',
  'admin-signin-loses-deep-link',
  'ask-again-lists-booked-time',
  'big-day-clash-thu-fri-only',
  'block-confirm-out-of-season',
  'block-rule-outside-engine',
  'bounce-poll-gmail-rows',
  'calendar-invite-shows-jons-labels',
  'copy-address-small-target',
  'date-lock-full-week-no-override',
  'dates-request-stray-standby-week',
  'dev-outbox-unpruned',
  'dev-post-origin',
  'dev-routes-check-coverage',
  'digest-drops-request-links',
  'duplicate-request-after-back',
  'e1-cap-concurrent',
  'e1-no-manage-link',
  'e12-host-cancel-omits-joined',
  'e13-digest-test-real-clock',
  'e2-counts-not-times',
  'e2-overnight-not-shown',
  'email-digest-double-bullet',
  'email-e12-no-week-filler',
  'email-e8-pitch-not-editable',
  'email-e9-revoked-invite-never-sent',
  'email-guest-link-bare-url',
  'email-guest-time-no-vancouver',
  'email-hourly-digest-subject',
  'email-long-name-widens-card',
  'export-date-cancelled-booking',
  'export-date-joined-guest',
  'general-cap-inside-request-tx',
  'general-invite-request-cap',
  'general-link-duplicate-other-browser',
  'gmail-send-timeout',
  'guest-actions-during-booking',
  'guest-standby-gets-e3-nudge',
  'health-public-detail',
  'heic-decode-no-deadline',
  'ics-organizer-not-sender',
  'intake-replay-after-validation',
  'intake-replay-ignores-edits',
  'invite-link-switch-prefill',
  'join-admin-half-wired',
  'joined-page-no-more-menu',
  'jon-cancel-old-link-mixed-message',
  'jon-cancel-reads-as-guest-cancel',
  'links-row-actions-unnamed',
  'lock-cancel-race-orphan-delete',
  'lock-leaves-standby-offer-live',
  'lock-week-of-start-only',
  'long-range-shows-start-only',
  'manage-ac6-timeout-cascade',
  'manage-grid-outside-season',
  'manage-links-expire-after-weather-or-block',
  'meter-counts-test-and-spam',
  'month-tabs-narrow-wide-screens',
  'new-date-grid-ignores-engine-off-dates',
  'no-site-icons',
  'offer-lookup-not-bound-to-request',
  'offer-page-lists-taken-time',
  'orphan-manage-shows-old-time',
  'personal-invite-guest-email-cap',
  'photo-finalise-full-story-decodes',
  'photo-tile-words-on-photo',
  'photo-upload-attempts-unlimited',
  'request-cookie-after-revoke',
  'request-name-bidi-override',
  'rerequest-replay-ignores-edits',
  'rerequest-stored-crew-refused',
  'rerequest-stored-name-error',
  'send-limit-fixed-hour-counts-refusals',
  'sent-page-promises-capped-email',
  'signin-address-cap',
  'slideshow-toggle-label-in-name',
  'slideshow-toggle-name-flips',
  'slot-lock-inherits-big-day',
  'slots-offered-outside-dish-windows',
  'something-new-week-shows-open',
  'standby-detail-no-actions',
  'stories-address-200-overflow',
  'story-empty-error-stays',
  'story-name-bidi-override',
  'story-name-box-reads-required',
  'story-page-edit-of-deleted-story-inserts',
  'story-page-first-save-retry-duplicates',
  'story-page-revisit-overwrites',
  'tag-sheet-overflow-firefox',
  'tick-burner-halves-cadence',
  'tick-hard-stop',
  'tick-jobs-failing',
  'tick-route-secret-helper',
  'toast-pauses-under-pointer',
  'unit-tests-dynamic-import-timeout',
  'weather-call-focus-lost',
  'webhook-bounce-before-send-recorded',
  'webhook-event-unpruned',
]);

describe('evals/bugs: the regression register', () => {
  it('has one .json file per bug and nothing else', () => {
    expect(files.filter((f) => !f.endsWith('.json'))).toEqual([]);
    expect(entries.length).toBeGreaterThanOrEqual(41);
  });

  it('is no longer a single shared list', () => {
    expect(existsSync(path.join(ROOT, 'evals/bugs.json'))).toBe(false);
  });

  it.each(files.filter((f) => f.endsWith('.json')))('%s is one entry named after its id', (file) => {
    const { entry } = entries.find((e) => e.file === file)!;
    expect(entry).toBeTypeOf('object');
    expect(Array.isArray(entry)).toBe(false);
    expect(entry.id).toMatch(ID);
    expect(file).toBe(`${entry.id}.json`);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(entry.fix).toBeTypeOf('string');
    expect(entry.summary ?? entry.symptom).toBeTypeOf('string');
  });

  it('has unique ids, ignoring case', () => {
    const ids = entries.map((e) => e.entry.id.toLowerCase());
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('points every entry at test files that exist', () => {
    const missing = entries.flatMap(({ entry }) => {
      const paths = testPaths(entry);
      if (paths.length === 0 || paths.some((p) => typeof p !== 'string' || p === ''))
        return [`${entry.id}: no test`];
      return (paths as string[])
        .filter((p) => !existsSync(path.join(ROOT, p)))
        .map((p) => `${entry.id}: ${p}`);
    });
    expect(missing).toEqual([]);
  });

  it('every entry is named in each of its test files (its id, or its "(case)" note)', () => {
    const silent = entries
      .filter(({ entry }) => !LEGACY_UNMENTIONED.has(entry.id))
      .flatMap(({ entry }) => unmentioned(entry).map((f) => `${entry.id}: ${f}`));
    expect(silent).toEqual([]);
  });

  it('the legacy list only shrinks: every id on it exists and still has a silent test file', () => {
    const ids = new Set(entries.map((e) => e.entry.id));
    expect([...LEGACY_UNMENTIONED].filter((id) => !ids.has(id))).toEqual([]);
    const fixed = entries
      .filter(({ entry }) => LEGACY_UNMENTIONED.has(entry.id) && unmentioned(entry).length === 0)
      .map(({ entry }) => entry.id);
    expect(fixed, 'mentioned now: take these off LEGACY_UNMENTIONED').toEqual([]);
  });

  it('self-test: a file that names the entry, or its case note, passes; one that names neither fails', () => {
    const entry = { id: 'x-bug', tests: ['a.ts', 'b.ts (case 7)'] } as unknown as Entry;
    const files: Record<string, string> = { 'a.ts': '// guards x-bug', 'b.ts': "it('case 7', ...)" };
    const read = (f: string) => files[f] ?? '';
    const named = (e: Entry) => unmentioned(e, read, (f) => f in files);
    expect(named(entry)).toEqual([]);
    files['a.ts'] = '// says nothing';
    expect(named(entry)).toEqual(['a.ts']);
  });
});
