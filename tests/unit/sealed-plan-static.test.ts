// T2.2.06 (TSD T2.2 AC1, C4 "the sealed plan", §9 sealed-plan row, static half): the plan column is never named
// outside the few files that WRITE it. It scans all of src/ and scripts/, so the admin, email, calendar and export
// code (and any later folder) is covered without a list to keep up to date. Admin code shows "Sealed plan on
// file" through the generated has_sealed_plan column (T2.2.01). The runtime half is T2.2.07's canary test.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const DIRS = ['src', 'scripts', 'ops'];
/** Root files the app loads (sentry.server.config.ts via src/instrumentation.ts) and the build configs. */
const ROOT_FILE = /\.(ts|mjs)$/;
const EXTENSIONS = /\.(ts|tsx|mjs|js|sql|sh)$/;
/** The column and every spelling code could give it (snake, camel, a quoted or split SQL name). */
const PLAN = /surprise_plan_sealed|surprisePlanSealed|plan_sealed/i;
/**
 * Only writers: the guest's own request (create.ts inserts it) and the /dev Surprise Me scenario (inserts a
 * canary). And (TSD C4, S17) the guest's manage page loader, which shows the plan back to its owner only, to the
 * holder of that request's manage token (T2.7.03).
 */
const WRITERS = ['src/features/requests/create.ts', 'src/features/dev/scenarios.ts'];
const OWNER_READER = 'src/features/invites/manage-model.ts';
const ALLOWLIST = new Set([...WRITERS, OWNER_READER]);
const ADMIN = ['src/features/admin/', 'src/app/api/admin/', 'src/app/admin/'];
/**
 * Reads that return the plan WITHOUT naming it (pr27-review F1), matched on whole-file text so a `r.*` on its
 * own line is caught too: a star select (the tasks.md T2.2.02 rule, now for all code: email, calendar and
 * export render rows as well), a whole-row read, and the column name built from string fragments.
 */
const STAR = /(?:\bselect\s+(?:distinct\s+)?|,\s*)(?:\w+\.)?\*(?=\s*(?:,|\bfrom\b|$))|\breturning\s+\*/gim;
// pr27-verify V1 (exact): aggregates with DISTINCT/ORDER BY/extra args, r.*, (r).*, row(r.*), a schema-qualified or
// quoted request, ONLY.
const WHOLE_ROW =
  /\b(?:row_to_json|to_jsonb?|jsonb?_agg|array_agg|hstore|row)\s*\(\s*(?:distinct\s+)?\(?\s*\w+(?:\.\*)?\s*\)?\s*(?:[,)]|\border\b)|\(\s*\w+\s*\)\.\*|\btable\s+(?:only\s+)?(?:\w+\.)?"?request"?\b|\bselect\s+(?:distinct\s+)?\w+\s+from\s+(?:only\s+)?(?:\w+\.)?"?request"?\s+(?:as\s+)?\w+\b/gi;
const SPLIT = /['"`](?:surprise_?plan_?|_?plan_?sealed|_?sealed)['"`]/gi; // string fragments of the name
const BYPASSES = [STAR, WHOLE_ROW, SPLIT];
/** A later migration must not expose the plan through a view or a function over request. */
const MIGRATIONS = 'supabase/migrations';
const PLAN_MIGRATION = '20261102000100';
/**
 * Any later migration that touches request at all (from/join/table/into/on request, a trigger's NEW/OLD row) must
 * be reviewed for the plan and then allowlisted here by file name (pr27-verify V1).
 */
const TOUCHES_REQUEST =
  /\b(?:from|join|table|into|on)\s+(?:only\s+)?(?:\w+\.)?"?request"?\b|\bnew\b|\bold\b/i;
const REVIEWED_MIGRATIONS = new Set<string>([
  // T1.6.U5 "Which night?": one nullable text column; reads no row, never names the plan.
  '20261102000700_request_overnight_night.sql',
]);
const migrationHits = (name: string, text: string) => [
  ...(PLAN.test(text) ? [`${name}: names the plan`] : []),
  ...bypassHits(name, text),
  ...(TOUCHES_REQUEST.test(text)
    ? [`${name}: touches request (review it, then add it to REVIEWED_MIGRATIONS)`]
    : []),
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(full).isDirectory() ? walk(full) : EXTENSIONS.test(name) ? [full] : [];
  });
}

const files = [
  ...readdirSync(ROOT).filter((n) => ROOT_FILE.test(n) && statSync(path.join(ROOT, n)).isFile()),
  ...DIRS.flatMap((d) => walk(path.join(ROOT, d))).map((f) =>
    path.relative(ROOT, f).split(path.sep).join('/'),
  ),
];
const hits = (f: string, re: RegExp) =>
  readFileSync(path.join(ROOT, f), 'utf8')
    .split('\n')
    .flatMap((line, i) => (re.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []));
/** Whole-file matches (patterns may span lines), reported with the line they start on. */
const textHits = (label: string, text: string, re: RegExp) =>
  [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))].map(
    (m) => `${label}:${text.slice(0, m.index).split('\n').length}: ${m[0].trim()}`,
  );
const bypassHits = (label: string, text: string) => BYPASSES.flatMap((re) => textHits(label, text, re));

describe('the sealed plan never leaves the writers (T2.2 AC1)', () => {
  it('scans the admin code it is meant to guard', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'src/features/admin/inbox.ts',
        'src/features/admin/detail.ts',
        'src/app/api/admin/requests/route.ts',
        'src/app/api/admin/requests/[id]/route.ts',
      ]),
    );
    for (const f of ALLOWLIST) expect(files).toContain(f);
  });

  it('names surprise_plan_sealed nowhere else in src/ or scripts/', () => {
    expect(files.filter((f) => !ALLOWLIST.has(f)).flatMap((f) => hits(f, PLAN))).toEqual([]);
  });

  it('the writers only insert it, never select it', () => {
    for (const f of WRITERS) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).toMatch(/insert into request/i);
      expect(src, f).not.toMatch(/select[^;`]*surprise_plan_sealed/i);
      expect(src, f).not.toMatch(/returning[^;`]*(surprise_plan_sealed|\*)/i);
    }
  });

  it("the owner's manage loader is imported only by guest pages and routes, never admin, email, calendar or export", () => {
    const importers = files.filter((f) =>
      /from '@\/features\/invites\/manage-model'/.test(readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(importers.filter((f) => !f.startsWith('src/app/') || ADMIN.some((d) => f.startsWith(d)))).toEqual(
      [],
    );
  });

  it('no code reads a whole request row or a `*`, or spells the name in pieces (admin code included)', () => {
    expect(files.filter((f) => ADMIN.some((d) => f.startsWith(d))).length).toBeGreaterThan(5);
    const scanned = files.filter((f) => !ALLOWLIST.has(f));
    expect(scanned.flatMap((f) => bypassHits(f, readFileSync(path.join(ROOT, f), 'utf8')))).toEqual([]);
  });

  it('no migration after the plan column touches request without a review, or names the plan', () => {
    const later = readdirSync(path.join(ROOT, MIGRATIONS)).filter(
      (n) => n.endsWith('.sql') && n > `${PLAN_MIGRATION}_~` && !REVIEWED_MIGRATIONS.has(n),
    );
    expect(
      later.flatMap((n) => migrationHits(n, readFileSync(path.join(ROOT, MIGRATIONS, n), 'utf8'))),
    ).toEqual([]);
  });

  it('scans the root configs the app loads and ops/', () => {
    expect(files).toEqual(
      expect.arrayContaining(['sentry.server.config.ts', 'next.config.ts', 'ops/end-admin-sessions.sql']),
    );
  });

  it('self-test: the patterns catch every known bypass (pr27-review M2, M3, M3b)', () => {
    const bypasses = [
      'select r.id,\n  r.*\n from request r', // a lone r.* on its own line
      'select to_jsonb(r) as j from request r',
      'select row_to_json(request) from request',
      'select r from request r',
      'table request',
      "const col = 'surprise_plan' + '_sealed';",
      'const col = `${"surprise"}_${"plan_sealed"}`;',
      "['surprise', 'plan', 'sealed'].join('_')",
      'select * from request',
      'insert into x select 1 returning *',
      // pr27-verify V1: all parse on PG15 and return the plan without naming it
      'select json_agg(r order by r.created_at) from request r',
      'select jsonb_agg(distinct r) from request r',
      'select row_to_json(r, true) from request r',
      'select to_jsonb(r.*) from request r',
      'select array_agg(r) from request r',
      'select (r).* from request r',
      'select r from public.request r',
      'select row(r.*) from request r',
      'select to_json((r)) from request r',
    ];
    for (const b of bypasses) expect(bypassHits('probe', b), b).not.toEqual([]);
    for (const ok of [
      'select r.id, r.dish from request r',
      'select count(*)::int as n from request',
      'a * b',
    ])
      expect(bypassHits('probe', ok), ok).toEqual([]);
    for (const m of [
      'create materialized view mv as select id, dish from request;',
      'create view v as select x.id from invite x join request r on r.invite_id = x.id;',
      'create view v as select id from "request";',
      'create table b as select * from request;',
      "create function f() returns trigger language plpgsql as $$ begin perform pg_notify('c', to_jsonb(new)::text); return new; end $$;\ncreate trigger t after insert on request for each row execute function f();",
      'create or replace view v as select id from public.request;',
    ])
      expect(migrationHits('probe.sql', m), m).not.toEqual([]);
    expect(migrationHits('probe.sql', 'create table offer_note (id uuid primary key, body text);')).toEqual(
      [],
    );
  });
});
