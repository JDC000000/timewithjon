// src/lib/db-config.ts — the ONLY place a pg Pool is constructed (review V2; ESLint blocks \`new Pool\` elsewhere).
// No 'server-only' import, so operator scripts (tsx) can use it too. TLS per M11: verify the server certificate
// against DATABASE_CA_CERT; plaintext only with DATABASE_SSL=disable, which env.ts allows for loopback only.
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import type { DbEnv } from '@/config/env';

/** Production pool size (Supabase transaction pooler); DB_POOL_MAX overrides it, e.g. for the e2e server. */
export const DEFAULT_POOL_MAX = 3;
export const POOL_MAX_LIMIT = 20;
/** How long a caller waits for a free connection before the pool throws instead of queueing without limit. */
export const POOL_CONNECTION_TIMEOUT_MS = 5_000;

/** DB_POOL_MAX: unset or empty = the default; otherwise a whole number 1..20, anything else fails at boot. */
export function parsePoolMax(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_POOL_MAX;
  const max = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(max) || max < 1 || max > POOL_MAX_LIMIT) {
    throw new Error(`DB_POOL_MAX must be a whole number from 1 to ${POOL_MAX_LIMIT}, got "${raw}"`);
  }
  return max;
}

const PG_QUEUE_TIMEOUT = 'timeout exceeded when trying to connect';
type ConnectCallback = (
  err: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

/**
 * A Pool that names itself when it is starved: pg's queue timeout ('timeout exceeded when trying to connect')
 * gets the pool name, its size and the counts in the message. pool.query() goes through connect(), so both paths
 * report the same way.
 */
export class NamedPool extends Pool {
  constructor(
    config: PoolConfig,
    readonly poolName: string,
  ) {
    super(config);
  }

  override connect(): Promise<PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (callback) {
      super.connect((err, client, done) => callback(this.describe(err), client, done));
      return;
    }
    return super.connect().catch((err: unknown) => {
      throw this.describe(err);
    });
  }

  private describe<E>(err: E): E {
    if (err instanceof Error && err.message === PG_QUEUE_TIMEOUT) {
      err.message =
        `DB pool "${this.poolName}" starved: no free connection within ${this.options.connectionTimeoutMillis} ms ` +
        `(max ${this.options.max}, in use ${this.totalCount - this.idleCount}, still waiting ${this.waitingCount}); ` +
        PG_QUEUE_TIMEOUT;
    }
    return err;
  }
}

export function poolConfig(
  db: DbEnv,
  opts: { max?: number } = {},
  // eslint-disable-next-line no-restricted-properties -- pool sizing, not app config: parsePoolMax validates it here (env.ts is outside this change)
  env: Readonly<Record<string, string | undefined>> = process.env,
): PoolConfig {
  return {
    connectionString: db.DATABASE_URL,
    max: opts.max ?? parsePoolMax(env.DB_POOL_MAX),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    ssl: db.DATABASE_SSL === 'disable' ? false : { ca: db.DATABASE_CA_CERT, rejectUnauthorized: true },
  };
}

/** opts.max (operator scripts) wins over DB_POOL_MAX, which wins over DEFAULT_POOL_MAX. */
export function createPool(db: DbEnv, opts: { max?: number; name?: string } = {}): Pool {
  return new NamedPool(poolConfig(db, opts), opts.name ?? 'app');
}
