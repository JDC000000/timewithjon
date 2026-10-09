// AD-3: the database is reached only by the server's own role. Every public table has RLS on with
// no policies, and the anon/authenticated roles (the Data API's) hold no privilege on any public table, sequence or
// function, today or on objects a later migration creates. This fails if a migration ships a table without RLS, adds
// a policy, or grants those roles anything.
import { afterAll, describe, expect, it } from 'vitest';
import { pool, q } from '@/lib/db';

const ROLES = ['anon', 'authenticated'] as const;

afterAll(async () => {
  await pool().end();
});

describe('the database lockdown (AD-3)', () => {
  it('there are public tables to check', async () => {
    const [row] = await q<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(row!.n).toBeGreaterThan(10);
  });

  it('every public table has RLS on', async () => {
    const rows = await q<{ table: string }>(
      `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
        order by 1`,
    );
    expect(rows.map((r) => r.table)).toEqual([]);
  });

  it('no policy exists on any public table', async () => {
    const rows = await q<{ table: string; policy: string }>(
      `select tablename as table, policyname as policy from pg_policies where schemaname = 'public' order by 1, 2`,
    );
    expect(rows).toEqual([]);
  });

  it.each(ROLES)('%s holds no privilege on any public table, sequence or function', async (role) => {
    const tables = await q<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and case when c.relkind in ('r', 'p', 'v', 'm', 'f')
                   then has_table_privilege($1, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                   else false end
        order by 1`,
      [role],
    );
    const sequences = await q<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and case when c.relkind = 'S' then has_sequence_privilege($1, c.oid, 'USAGE, SELECT, UPDATE') else false end
        order by 1`,
      [role],
    );
    const functions = await q<{ name: string }>(
      `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege($1, p.oid, 'EXECUTE')
        order by 1`,
      [role],
    );
    expect({ tables, sequences, functions }).toEqual({ tables: [], sequences: [], functions: [] });
  });

  it('a table, sequence and function a later migration creates give anon/authenticated nothing', async () => {
    const c = await pool().connect();
    let seen: { role: string; tbl: boolean; seq: boolean; fn: boolean }[];
    try {
      await c.query('begin');
      await c.query(`create table public.twj_lockdown_probe (id bigint generated always as identity)`);
      await c.query(`create sequence public.twj_lockdown_probe_seq`);
      await c.query(`create function public.twj_lockdown_probe_fn() returns int language sql as 'select 1'`);
      ({ rows: seen } = await c.query<{ role: string; tbl: boolean; seq: boolean; fn: boolean }>(
        `select r.role,
                has_table_privilege(r.role, 'public.twj_lockdown_probe', 'SELECT, INSERT, UPDATE, DELETE') as tbl,
                has_sequence_privilege(r.role, 'public.twj_lockdown_probe_seq', 'USAGE, SELECT, UPDATE') as seq,
                has_function_privilege(r.role, 'public.twj_lockdown_probe_fn()', 'EXECUTE') as fn
           from unnest($1::text[]) as r(role)`,
        [ROLES],
      ));
    } finally {
      await c.query('rollback'); // nothing is left behind
      c.release();
    }
    expect(seen).toEqual(ROLES.map((role) => ({ role, tbl: false, seq: false, fn: false })));
  });
});
