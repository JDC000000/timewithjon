// T3.16.01: ops/seed-season.sql seeds staging/production with the REAL release times, the same 14 weeks and
// 52 slots as the proto seed, and no invites. The real file runs through psql (guards included) against a
// scratch schema that shadows public's tables, dropped afterwards.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '@/lib/db';

const season = readFileSync('ops/seed-season.sql', 'utf8');
const proto = readFileSync('supabase/seed.sql', 'utf8');

/** Runs the seed exactly as the operator does, with search_path pointed at `schema`. */
function runSeed(schema: string, env?: string) {
  const vars = env === undefined ? [] : ['-v', `env=${env}`];
  const r = spawnSync(
    'psql',
    [
      process.env.DATABASE_URL ?? '',
      '-X',
      '-q',
      ...vars,
      '-c',
      `set search_path = ${schema}, public`,
      '-f',
      'ops/seed-season.sql',
    ],
    { encoding: 'utf8' },
  );
  return { status: r.status, stderr: r.stderr };
}

/** A schema with empty copies of the seeded tables, so the seed never touches public. */
async function withScratchSchema(name: string, fn: (schema: string) => Promise<void>) {
  const c = await pool().connect();
  try {
    await c.query(`create schema ${name}`);
    for (const t of ['settings', 'week', 'slot', 'invite']) {
      await c.query(`create table ${name}.${t} (like public.${t} including all)`);
    }
    await fn(name);
  } finally {
    await c.query(`drop schema if exists ${name} cascade`);
    c.release();
  }
}

const counts = async (schema: string) =>
  (
    await pool().query<Record<string, string | number | boolean>>(
      `select env::text, personal_open_at = '2027-02-25T16:00Z' p, general_open_at = '2027-03-01T16:00Z' g,
              (select count(*)::int from ${schema}.week) weeks,
              (select count(*)::int from ${schema}.slot) slots,
              (select count(*)::int from ${schema}.invite) invites
       from ${schema}.settings`,
    )
  ).rows;

/** The week and slot inserts, whitespace-normalised, to catch drift between the two seeds. */
const seasonStatements = (sql: string) =>
  (sql.match(/insert into (week|slot)[\s\S]*?;/g) ?? []).map((s) => s.replace(/\s+/g, ' '));

afterAll(async () => {
  await pool().end();
});

describe('ops/seed-season.sql', () => {
  it('uses the same weeks and slots as supabase/seed.sql', () => {
    expect(seasonStatements(season)).toHaveLength(2);
    expect(seasonStatements(season)).toEqual(seasonStatements(proto));
  });

  it('refuses to run without -v env (psql exit 3, nothing written)', async () => {
    await withScratchSchema('seed_check_noenv', async (s) => {
      const r = runSeed(s);
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/missing -v env=staging\|production/);
      expect(await counts(s)).toEqual([]);
    });
  });

  it('refuses env=prototype (review M2)', async () => {
    await withScratchSchema('seed_check_proto', async (s) => {
      const r = runSeed(s, 'prototype');
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/env must be staging or production/);
      expect(await counts(s)).toEqual([]);
    });
  });

  it('fails and rolls back when a settings row already holds another env (review M1, L1)', async () => {
    await withScratchSchema('seed_check_exists', async (s) => {
      await pool().query(`insert into ${s}.settings (env) values ('prototype')`);
      const r = runSeed(s, 'staging');
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/settings\.env is prototype, expected staging/);
      const [row] = await counts(s);
      expect(row).toMatchObject({ env: 'prototype', weeks: 0, slots: 0 });
    });
  });

  it('is one transaction: a failure at the last insert leaves nothing behind (review L1)', async () => {
    await withScratchSchema('seed_check_atomic', async (s) => {
      await pool().query(`alter table ${s}.slot add constraint slot_reject check (false)`);
      const r = runSeed(s, 'staging');
      expect(r.status).toBe(3);
      expect(r.stderr).toMatch(/slot_reject/);
      expect(await counts(s)).toEqual([]);
      expect((await pool().query(`select count(*)::int n from ${s}.week`)).rows[0].n).toBe(0);
    });
  });

  it('seeds env=staging with the 2027 release times, 14 weeks, 52 slots and no invites; a rerun changes nothing', async () => {
    await withScratchSchema('seed_check_ok', async (s) => {
      const expected = [{ env: 'staging', p: true, g: true, weeks: 14, slots: 52, invites: 0 }];
      expect(runSeed(s, 'staging')).toMatchObject({ status: 0 });
      expect(await counts(s)).toEqual(expected);
      expect(runSeed(s, 'staging')).toMatchObject({ status: 0 });
      expect(await counts(s)).toEqual(expected);
    });
  });
});
