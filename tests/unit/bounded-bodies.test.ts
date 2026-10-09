// Every public route that reads a request body reads it through src/lib/http.ts's bounded reader (readJson /
// readBytesAtMost), so no body is read whole past its limit. Public = everything under src/app/api except the admin
// tree (its sign-in routes are public, so they are in), cron, jobs and dev. Grows by itself.
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const routes = globSync('src/app/api/**/route.ts', { cwd: ROOT })
  .filter((f) => !/^src\/app\/api\/(cron|jobs|dev)\//.test(f))
  .filter((f) => !f.startsWith('src/app/api/admin/') || f.startsWith('src/app/api/admin/auth/'))
  .sort();
const UNBOUNDED = /\breq(?:uest)?\.(json|text|formData|arrayBuffer|blob)\(/;

describe('public request bodies are bounded', () => {
  it('finds the public write routes', () => {
    expect(routes).toEqual(
      expect.arrayContaining(['src/app/api/requests/route.ts', 'src/app/api/admin/auth/confirm/route.ts']),
    );
  });
  it.each(routes)('%s never reads a body whole', (file) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).not.toMatch(UNBOUNDED);
  });
});
