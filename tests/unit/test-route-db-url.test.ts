// pr70-review F1: scripts/test-route.sh only runs against a loopback test DB. The check lives in
// scripts/loopback-db-url.sh; this drives it through bash with real URLs.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const ok = (url: string) =>
  spawnSync('bash', ['-c', 'source scripts/loopback-db-url.sh && is_loopback_db_url "$1"', '_', url], {
    cwd: ROOT,
  }).status === 0;

describe('test-route.sh loopback DATABASE_URL check (pr70-review F1)', () => {
  it.each([
    'postgres://postgres:test@127.0.0.1:55466/postgres',
    'postgresql://postgres:test@localhost:5432/twj_test',
    'postgres://postgres@127.0.0.1:55432/postgres',
  ])('accepts %s', (url) => expect(ok(url)).toBe(true));

  it.each([
    'postgres://u:p@127.0.0.1:5432/x?host=db.example.com', // pg-connection-string: ?host= overrides the host
    'postgres://u:p@127.0.0.1:5432/x?sslmode=disable',
    'postgres://u:p@127.0.0.1:5432/x#frag',
    'postgres://u:p@db.example.com:5432/postgres',
    'postgres://u:p@localhost.evil.com:5432/postgres',
    'postgres://u:p@127.0.0.1.evil.com:5432/postgres',
    'postgres://u:p@127.0.0.1/postgres', // no port
    'postgres://u:p@localhost/postgres',
    'postgres://u:p@127.0.0.1:5432/', // no database
    'mysql://u:p@127.0.0.1:3306/x',
    '',
  ])('refuses %s', (url) => expect(ok(url)).toBe(false));

  it('test-route.sh refuses a bypass before any build', () => {
    const r = spawnSync('bash', ['scripts/test-route.sh'], {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x?host=db.example.com',
        PORT: '3999',
      },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/FAIL: DATABASE_URL must be/);
  });
});
