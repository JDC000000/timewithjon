// tests/fixtures/unit-env.ts — a valid prototype env for unit tests that reach getEnv(). Never real secrets.
// getEnv() parses lazily on first call, so importing this anywhere in a test file is early enough.
Object.assign(process.env, {
  APP_MODE: 'prototype',
  DATABASE_URL: 'postgres://postgres:test@127.0.0.1:55432/postgres',
  DATABASE_SSL: 'disable',
  NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  ADMIN_EMAILS: 'jon@example.com',
  SESSION_SIGNING_SECRET: 'test-session-secret-test-session-secret-01',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  CRON_SECRET: 'c'.repeat(32),
  DEV_PASSPHRASE: 'dev-pass-for-unit-tests',
  FEATURE_ADMIN_AUTH: '1',
});

export const SITE = 'http://localhost:3000';
export const ADMIN = 'jon@example.com';
