// T3.4.05 (AD-6): a guest who got the .ics (not Google's invite) must get the .ics CANCEL when their own booking is
// taken off the calendar. Every code path that queues a calendar_delete must also queue it; this test grows with
// the code (a new cancel path in any lane fails here until it calls queueIcsEmail(..., 'CANCEL')).
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');

// pr54 F4: only the outbox processor itself (it runs the rows) and the enqueue helper's type are exempt, and the
// count is per file, so a second delete path in an already-guarded file fails too.
const EXEMPT = new Set(['src/features/calendar/outbox.ts', 'src/features/requests/side-effects.ts']);
const count = (src: string, re: RegExp) => src.match(new RegExp(re.source, 'g'))?.length ?? 0;

describe('.ics CANCEL on every delete path (T3.4.05)', () => {
  const files = globSync('src/**/*.ts', { cwd: ROOT }).filter(
    (f) => !f.includes('__tests__') && !EXEMPT.has(f.split(path.sep).join('/')),
  );
  const source = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');
  const deleters = files.filter((f) => /'calendar_delete'/.test(source(f)));
  it('finds the delete paths it guards', () => {
    expect(deleters).toEqual(
      expect.arrayContaining(['src/features/requests/guest-cancel.ts', 'src/features/requests/rerequest.ts']),
    );
  });
  it.each(deleters)('%s queues one .ics CANCEL per delete it queues', (f) => {
    const src = source(f);
    expect(count(src, /'calendar_delete'/)).toBeLessThanOrEqual(count(src, /queueIcsEmail\([^)]*'CANCEL'\)/));
  });
});
