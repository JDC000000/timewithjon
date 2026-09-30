// src/lib/db.ts — pg over the Supabase transaction pooler (AD-3). Server code only, no ORM.
import 'server-only';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { getEnv } from '@/config/env';
import { createPool } from './db-config';

const g = globalThis as unknown as { __twjPool?: Pool };
export function pool(): Pool {
  g.__twjPool ??= createPool(getEnv());
  return g.__twjPool;
}
export async function q<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query<T>(sql, params)).rows;
}
/** Commit-then-side-effects (L-3): run DB work here; do Google/Resend calls AFTER this resolves. */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  let broken: Error | undefined;
  try {
    await c.query('begin');
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    // L12: a failing rollback must not mask the original error, and a broken client leaves the pool.
    await c.query('rollback').catch((rollbackError: unknown) => {
      broken = rollbackError instanceof Error ? rollbackError : new Error('rollback failed');
    });
    throw e;
  } finally {
    c.release(broken);
  }
}
