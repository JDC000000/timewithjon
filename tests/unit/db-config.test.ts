// T3.9 follow-up (pool timeout): the app pool fails loudly when starved instead of queueing without limit, and
// DB_POOL_MAX sizes it (default 3, whole numbers 1..20) so the e2e server can take a larger pool.
import { EventEmitter } from 'node:events';
import type { ClientBase, PoolClient } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPool,
  DEFAULT_POOL_MAX,
  NamedPool,
  parsePoolMax,
  POOL_CONNECTION_TIMEOUT_MS,
  poolConfig,
} from '@/lib/db-config';
import type { DbEnv } from '@/config/env';

const DB = { DATABASE_URL: 'postgres://u:p@127.0.0.1:54322/postgres', DATABASE_SSL: 'disable' } as DbEnv;

describe('parsePoolMax (DB_POOL_MAX)', () => {
  it('defaults to 3 when unset or empty', () => {
    expect(DEFAULT_POOL_MAX).toBe(3);
    expect(parsePoolMax(undefined)).toBe(3);
    expect(parsePoolMax('')).toBe(3);
    expect(parsePoolMax('  ')).toBe(3);
  });

  it('accepts whole numbers 1..20', () => {
    expect(parsePoolMax('1')).toBe(1);
    expect(parsePoolMax('10')).toBe(10);
    expect(parsePoolMax(' 20 ')).toBe(20);
  });

  it.each(['0', '21', '-1', '2.5', '1e1', '0x5', 'ten', '5abc', 'Infinity', 'NaN'])('rejects %j', (raw) => {
    expect(() => parsePoolMax(raw)).toThrow(`DB_POOL_MAX must be a whole number from 1 to 20, got "${raw}"`);
  });
});

describe('poolConfig', () => {
  it('sets the 5 s connection timeout and the default size', () => {
    const cfg = poolConfig(DB, {}, {});
    expect(POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
    expect(cfg.connectionTimeoutMillis).toBe(5_000);
    expect(cfg.max).toBe(3);
    expect(cfg.ssl).toBe(false);
  });

  it('takes DB_POOL_MAX, and an explicit max (operator scripts) wins over it', () => {
    expect(poolConfig(DB, {}, { DB_POOL_MAX: '10' }).max).toBe(10);
    expect(poolConfig(DB, { max: 1 }, { DB_POOL_MAX: '10' }).max).toBe(1);
  });

  it('fails at pool creation on a bad DB_POOL_MAX', () => {
    expect(() => poolConfig(DB, {}, { DB_POOL_MAX: '50' })).toThrow(/DB_POOL_MAX/);
  });

  it('verifies TLS unless DATABASE_SSL=disable', () => {
    const cfg = poolConfig({ ...DB, DATABASE_SSL: 'verify-full', DATABASE_CA_CERT: 'CA' } as DbEnv, {}, {});
    expect(cfg.ssl).toEqual({ ca: 'CA', rejectUnauthorized: true });
  });
});

/** Stands in for pg.Client: connects at once, never touches the network. */
class FakeClient extends EventEmitter {
  connect(cb: (err?: Error) => void) {
    cb();
  }
  end(cb?: () => void) {
    this.emit('end');
    cb?.();
  }
}
const Client = FakeClient as unknown as new () => ClientBase;

describe('NamedPool starvation', () => {
  const held: PoolClient[] = [];
  let pool: NamedPool | undefined;
  afterEach(async () => {
    held.splice(0).forEach((c) => c.release());
    await pool?.end();
    pool = undefined;
    vi.useRealTimers();
  });

  it('throws a named error after the timeout instead of queueing forever (connect)', async () => {
    vi.useFakeTimers();
    pool = new NamedPool({ max: 1, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS, Client }, 'app');
    held.push(await pool.connect());

    const starved = pool.connect();
    const assertion = expect(starved).rejects.toThrow(
      'DB pool "app" starved: no free connection within 5000 ms (max 1, in use 1, still waiting 0); timeout exceeded when trying to connect',
    );
    expect(pool.waitingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(POOL_CONNECTION_TIMEOUT_MS);
    await assertion;
  });

  it('names the pool on the pool.query path too, and counts the other waiters', async () => {
    vi.useFakeTimers();
    pool = new NamedPool({ max: 1, connectionTimeoutMillis: 100, Client }, 'e2e');
    held.push(await pool.connect());

    const first = pool.query('select 1');
    const firstAssertion = expect(first).rejects.toThrow(
      /^DB pool "e2e" starved: .*\(max 1, in use 1, still waiting 1\)/,
    );
    await vi.advanceTimersByTimeAsync(50);
    const second = pool.query('select 1');
    const secondAssertion = expect(second).rejects.toThrow(/still waiting 0\)/);
    await vi.advanceTimersByTimeAsync(50);
    await firstAssertion;
    await vi.advanceTimersByTimeAsync(50);
    await secondAssertion;
  });

  it('hands a freed connection to a waiter before the timeout', async () => {
    vi.useFakeTimers();
    pool = new NamedPool({ max: 1, connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS, Client }, 'app');
    const first = await pool.connect();
    const waiting = pool.connect();
    first.release();
    held.push(await waiting);
    expect(pool.totalCount).toBe(1);
  });

  it('createPool builds a NamedPool called "app" by default', async () => {
    const created = createPool(DB);
    expect(created).toBeInstanceOf(NamedPool);
    expect((created as NamedPool).poolName).toBe('app');
    expect(created.options.connectionTimeoutMillis).toBe(5_000);
    await created.end();
  });
});
