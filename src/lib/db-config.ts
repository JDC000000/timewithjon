// src/lib/db-config.ts — the ONLY place a pg Pool is constructed (review V2; ESLint blocks \`new Pool\` elsewhere).
// No 'server-only' import, so operator scripts (tsx) can use it too. TLS per M11: verify the server certificate
// against DATABASE_CA_CERT; plaintext only with DATABASE_SSL=disable, which env.ts allows for loopback only.
import { Pool } from 'pg';
import type { DbEnv } from '@/config/env';

export function createPool(db: DbEnv, opts: { max?: number } = {}): Pool {
  return new Pool({
    connectionString: db.DATABASE_URL,
    max: opts.max ?? 3,
    idleTimeoutMillis: 10_000,
    ssl: db.DATABASE_SSL === 'disable' ? false : { ca: db.DATABASE_CA_CERT, rejectUnauthorized: true },
  });
}
