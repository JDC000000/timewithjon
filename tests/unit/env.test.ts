import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { envSchema, parseDbEnv, parseEnv, PRODUCTION_ONLY_KEYS, REAL_ADAPTER_KEYS } from '@/config/env';

const exampleKeys = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')
  .split('\n')
  .map((line) => /^([A-Z0-9_]+)=/.exec(line)?.[1])
  .filter((key): key is string => Boolean(key));

/** A placeholder per key; the token key must look like a real one (T3.3.02 validates it at boot). */
const VALID_TOKEN_KEY = Buffer.alloc(32, 5).toString('base64');
const fakeValue = (key: string) => (key === 'GOOGLE_TOKEN_ENC_KEY' ? VALID_TOKEN_KEY : 'set');

const prototypeEnv = {
  APP_MODE: 'prototype',
  NEXT_PUBLIC_SITE_URL: 'https://timewithjon-proto.vercel.app',
  ADMIN_EMAILS: 'Jon@example.com, other@example.com',
  SESSION_SIGNING_SECRET: 'x'.repeat(32),
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  DATABASE_URL: 'postgres://user:pass@localhost:6543/postgres',
  DATABASE_SSL: 'disable',
  CRON_SECRET: 'c'.repeat(32),
  DEV_PASSPHRASE: 'd'.repeat(20),
};

describe('env schema', () => {
  it('matches .env.example key for key', () => {
    expect([...exampleKeys].sort()).toEqual(Object.keys(envSchema.shape).sort());
  });

  it('.env.example carries no values', () => {
    const lines = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8').split('\n');
    expect(lines.filter((line) => /^[A-Z0-9_]+=.+/.test(line))).toEqual([]);
  });

  it('accepts a prototype config without real-adapter keys', () => {
    const env = parseEnv(prototypeEnv);
    expect(env.APP_MODE).toBe('prototype');
    expect(env.ADMIN_EMAILS).toEqual(['jon@example.com', 'other@example.com']);
  });

  it('treats empty strings as unset', () => {
    expect(() => parseEnv({ ...prototypeEnv, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('requires every real-adapter and Resend key in production, naming keys but never values', () => {
    const secretValue = 'super-secret-value-that-must-not-leak-000000';
    let message = '';
    try {
      parseEnv({ ...prototypeEnv, APP_MODE: 'production', SESSION_SIGNING_SECRET: secretValue });
    } catch (error) {
      message = (error as Error).message;
    }
    for (const key of [...REAL_ADAPTER_KEYS, ...PRODUCTION_ONLY_KEYS]) expect(message).toContain(key);
    expect(message).not.toContain('RESEND_WEBHOOK_SECRET');
    expect(message).not.toContain(secretValue);
  });

  it('does not require Resend in staging (Gmail API mailer, T3.17)', () => {
    const realAdapters = Object.fromEntries(REAL_ADAPTER_KEYS.map((key) => [key, fakeValue(key)]));
    const env = parseEnv({
      ...prototypeEnv,
      ...realAdapters,
      APP_MODE: 'staging',
      JON_PERSONAL_EMAIL: 'test@example.com',
      VERCEL: '1',
    });
    expect(env.APP_MODE).toBe('staging');
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(() => parseEnv({ ...prototypeEnv, ...realAdapters, APP_MODE: 'staging' })).toThrow(
      /JON_PERSONAL_EMAIL/,
    );
  });

  it('requires DEV_PASSPHRASE in prototype (M10 merge of both superRefine branches)', () => {
    expect(() => parseEnv({ ...prototypeEnv, DEV_PASSPHRASE: undefined })).toThrow(/DEV_PASSPHRASE/);
  });

  it('M11 verifies TLS by default and allows disable only on a loopback host', () => {
    const remote = 'postgres://u:p@aws-0-us-west-1.pooler.supabase.com:6543/postgres';
    const base = { ...prototypeEnv, DATABASE_SSL: undefined };
    expect(() => parseEnv({ ...base, DATABASE_URL: remote })).toThrow(/DATABASE_CA_CERT/);
    expect(() => parseEnv({ ...prototypeEnv, DATABASE_URL: remote })).toThrow(/DATABASE_SSL/);
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    expect(parseEnv({ ...base, DATABASE_URL: remote, DATABASE_CA_CERT: pem }).DATABASE_SSL).toBe(
      'verify-full',
    );
    expect(() =>
      parseEnv({ ...base, DATABASE_URL: `${remote}?sslmode=no-verify`, DATABASE_CA_CERT: pem }),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects an unknown APP_MODE and a trailing slash on the site URL', () => {
    expect(() => parseEnv({ ...prototypeEnv, APP_MODE: 'dev' })).toThrow(/APP_MODE/);
    expect(() => parseEnv({ ...prototypeEnv, NEXT_PUBLIC_SITE_URL: 'https://timewithjon.com/' })).toThrow(
      /NEXT_PUBLIC_SITE_URL/,
    );
  });

  it('V2 parseDbEnv (operator scripts) applies the same TLS rules as the app', () => {
    const remote = 'postgres://u:p@aws-0-us-west-1.pooler.supabase.com:6543/postgres';
    expect(() => parseDbEnv({ DATABASE_URL: remote })).toThrow(/DATABASE_CA_CERT/);
    expect(() => parseDbEnv({ DATABASE_URL: remote, DATABASE_SSL: 'disable' })).toThrow(/DATABASE_SSL/);
    expect(() => parseDbEnv({ DATABASE_URL: `${remote}?sslmode=disable` })).toThrow(/DATABASE_URL/);
    expect(
      parseDbEnv({ DATABASE_URL: 'postgres://u:p@127.0.0.1:55432/postgres', DATABASE_SSL: 'disable' }),
    ).toMatchObject({
      DATABASE_SSL: 'disable',
    });
  });

  it('T2.1.10 production allows exactly one admin address; proto and staging may hold two', () => {
    const real = Object.fromEntries(
      [...REAL_ADAPTER_KEYS, ...PRODUCTION_ONLY_KEYS].map((key) => [key, fakeValue(key)]),
    );
    const live = { ...prototypeEnv, ...real, JON_PERSONAL_EMAIL: 'test@example.com', VERCEL: '1' };
    const two = 'jon@example.com, test@example.com';
    expect(() => parseEnv({ ...live, APP_MODE: 'production', ADMIN_EMAILS: two })).toThrow(
      /ADMIN_EMAILS: must hold exactly one address/,
    );
    expect(
      parseEnv({ ...live, APP_MODE: 'production', ADMIN_EMAILS: 'jon@example.com' }).ADMIN_EMAILS,
    ).toEqual(['jon@example.com']);
    expect(parseEnv({ ...live, APP_MODE: 'staging', ADMIN_EMAILS: two }).ADMIN_EMAILS).toHaveLength(2);
    expect(parseEnv({ ...prototypeEnv, ADMIN_EMAILS: two }).ADMIN_EMAILS).toHaveLength(2);
  });

  it('N4 staging and production refuse to boot without VERCEL=1 (the limiter would be one site-wide bucket)', () => {
    const realAdapters = Object.fromEntries(REAL_ADAPTER_KEYS.map((key) => [key, fakeValue(key)]));
    const staging = {
      ...prototypeEnv,
      ...realAdapters,
      APP_MODE: 'staging',
      JON_PERSONAL_EMAIL: 'test@example.com',
    };
    expect(() => parseEnv(staging)).toThrow(/VERCEL/);
    expect(() => parseEnv({ ...staging, VERCEL: 'true' })).toThrow(/VERCEL/);
    expect(parseEnv({ ...staging, VERCEL: '1' }).APP_MODE).toBe('staging');
    expect(() => parseEnv({ ...staging, APP_MODE: 'production' })).toThrow(/VERCEL/);
    expect(parseEnv(prototypeEnv).VERCEL).toBeUndefined(); // prototype may run anywhere (local, CI)
  });

  it('T3.3.02 staging and production refuse a token key that is not base64 of exactly 32 bytes', () => {
    const real = Object.fromEntries(REAL_ADAPTER_KEYS.map((key) => [key, fakeValue(key)]));
    const live = {
      ...prototypeEnv,
      ...real,
      JON_PERSONAL_EMAIL: 'test@example.com',
      VERCEL: '1',
      APP_MODE: 'staging',
    };
    expect(() => parseEnv(live)).not.toThrow();
    expect(() => parseEnv({ ...live, GOOGLE_TOKEN_ENC_KEY: 'set' })).toThrow(
      /GOOGLE_TOKEN_ENC_KEY: must be base64/,
    );
    expect(() =>
      parseEnv({ ...live, GOOGLE_TOKEN_ENC_KEY_PREVIOUS: Buffer.alloc(16).toString('base64') }),
    ).toThrow(/GOOGLE_TOKEN_ENC_KEY_PREVIOUS: must be base64/);
  });
});
