import { z } from 'zod';

/**
 * The single source of truth for configuration (coding-best-practices §5).
 * Application code imports `getEnv()` from here and never reads process.env directly
 * (enforced by ESLint). `.env.example` must list exactly the keys in `envSchema`;
 * tests/unit/env.test.ts fails if the two drift.
 *
 * Wiring this into boot so a missing variable fails the build is T0.1.
 */

export const APP_MODES = ['prototype', 'staging', 'production'] as const;
export type AppMode = (typeof APP_MODES)[number];

const optionalString = z.string().min(1).optional();

// Keys that the mock adapters make unnecessary in prototype mode (AD-6, T1.10).
// Staging uses real adapters too, but sends email through the Gmail API mailer (T3.17), not Resend.
export const REAL_ADAPTER_KEYS = [
  'JON_PERSONAL_EMAIL',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_TOKEN_ENC_KEY',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BACKUP_BUCKET',
] as const;

// Resend Free is production-only: one account, no second one for staging (AD-5, Resend AUP).
// RESEND_WEBHOOK_SECRET stays optional: the bounce webhook exists only if the Free plan allows it.
export const PRODUCTION_ONLY_KEYS = ['RESEND_API_KEY', 'EMAIL_FROM_GUEST', 'EMAIL_FROM_ADMIN'] as const;

/** Strict: re-encoding must give the same string, so padding or stray characters are refused. */
export function isAes256KeyBase64(value: string): boolean {
  const bytes = Buffer.from(value, 'base64');
  return bytes.length === 32 && bytes.toString('base64') === value;
}

function isLoopbackUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

// Database connection settings, shared by the app env and operator scripts (parseDbEnv), so both apply the
// same TLS rules (M11, review V2).
const dbFields = {
  DATABASE_URL: z.url(),
  DATABASE_SSL: z.enum(['verify-full', 'disable']).default('verify-full'),
  DATABASE_CA_CERT: z
    .string()
    .refine((pem) => pem.includes('BEGIN CERTIFICATE'), 'must be a PEM certificate')
    .optional(),
};
type DbTlsFields = {
  DATABASE_URL: string;
  DATABASE_SSL: 'verify-full' | 'disable';
  DATABASE_CA_CERT?: string;
};

function checkDbTls(env: DbTlsFields, ctx: z.RefinementCtx): void {
  // M11: TLS is verified unless explicitly disabled, and disabling is only for a loopback database.
  if (env.DATABASE_SSL === 'verify-full' && !env.DATABASE_CA_CERT)
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_CA_CERT'],
      message: 'required when DATABASE_SSL=verify-full',
    });
  // pg lets ?sslmode= in the URL override the ssl option, which would silently bypass verification.
  if (/[?&](sslmode|ssl|sslrootcert)=/i.test(env.DATABASE_URL))
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'set TLS with DATABASE_SSL, not in the URL',
    });
  if (env.DATABASE_SSL === 'disable' && !isLoopbackUrl(env.DATABASE_URL))
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_SSL'],
      message: 'disable is only allowed for a loopback host',
    });
}

export const dbEnvSchema = z.object(dbFields).superRefine(checkDbTls);
export type DbEnv = z.infer<typeof dbEnvSchema>;

export const envSchema = z
  .object({
    APP_MODE: z.enum(APP_MODES),
    NEXT_PUBLIC_SITE_URL: z.url().refine((url) => !url.endsWith('/'), 'must not end with a slash'),
    ADMIN_EMAILS: z
      .string()
      .min(1)
      .transform((raw) => raw.split(',').map((email) => email.trim().toLowerCase()))
      .pipe(z.array(z.email()).min(1)),
    SESSION_SIGNING_SECRET: z.string().min(32),

    SUPABASE_URL: z.url(),
    SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ...dbFields,
    DIRECT_URL: optionalString,

    CRON_SECRET: z.string().min(32),
    // Shared passphrase for /dev/* tools. Required when APP_MODE=prototype; unused elsewhere (/dev is compiled out).
    DEV_PASSPHRASE: z.string().min(20).optional(), // T4.2.01a L2: brute force stays infeasible if the limiter fails open
    // Set by Vercel on every deployment ("1"); never set it by hand. Selects the trusted client-IP source (M2).
    VERCEL: z.literal('1').optional(),
    // TSD waiver (Jon, 2026-09-25): M2 server logic ships behind a flag. Unset = every admin route answers 404.
    FEATURE_ADMIN_AUTH: z.literal('1').optional(),

    RESEND_API_KEY: optionalString,
    RESEND_WEBHOOK_SECRET: optionalString,
    // pr34 M1: a Resend key allowed to read emails, for bounce polling only (the send key is sending-only).
    RESEND_READ_KEY: optionalString,
    EMAIL_FROM_GUEST: optionalString,
    EMAIL_FROM_ADMIN: optionalString,
    JON_PERSONAL_EMAIL: z.email().optional(),

    GOOGLE_OAUTH_CLIENT_ID: optionalString,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalString,
    GOOGLE_TOKEN_ENC_KEY: optionalString,
    // T3.3.02 rotation: the old key while a stored token may still be under it (src/features/calendar/crypto.ts).
    GOOGLE_TOKEN_ENC_KEY_PREVIOUS: optionalString,
    // pr36-review F1: '1' adds gmail.send to the connect scope set (staging on; production only on the AD-5 flip).
    GOOGLE_GMAIL_SEND: z.literal('1').optional(),

    NEXT_PUBLIC_TURNSTILE_SITE_KEY: optionalString,
    TURNSTILE_SECRET_KEY: optionalString,

    R2_ACCOUNT_ID: optionalString,
    R2_ACCESS_KEY_ID: optionalString,
    R2_SECRET_ACCESS_KEY: optionalString,
    R2_BACKUP_BUCKET: optionalString,

    NEXT_PUBLIC_SENTRY_DSN: z.url().optional(),
    SENTRY_ORG: optionalString,
    SENTRY_PROJECT: optionalString,
    SENTRY_AUTH_TOKEN: optionalString,
  })
  .superRefine((env, ctx) => {
    checkDbTls(env, ctx);
    if (env.APP_MODE === 'prototype') {
      if (!env.DEV_PASSPHRASE)
        ctx.addIssue({
          code: 'custom',
          path: ['DEV_PASSPHRASE'],
          message: 'required when APP_MODE=prototype',
        });
      return;
    }
    // T4.2.01a N4: off Vercel, every caller shares ONE rate-limit bucket (src/lib/http.ts), which would cap the
    // whole site at 10 requests an hour on launch morning. Staging and production must see Vercel's VERCEL=1
    // ("Automatically expose System Environment Variables" must stay on), or boot fails.
    if (env.VERCEL !== '1')
      ctx.addIssue({
        code: 'custom',
        path: ['VERCEL'],
        message: `must be "1" when APP_MODE=${env.APP_MODE}`,
      });
    // T2.1.10 (review F4): proto and staging may also allow the throwaway test Gmail; production is Jon only.
    if (env.APP_MODE === 'production' && env.ADMIN_EMAILS.length !== 1)
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_EMAILS'],
        message: 'must hold exactly one address when APP_MODE=production',
      });
    // T3.3.02: fail at boot, not at Jon's first connect, if a token key isn't base64 of exactly 32 bytes.
    for (const key of ['GOOGLE_TOKEN_ENC_KEY', 'GOOGLE_TOKEN_ENC_KEY_PREVIOUS'] as const) {
      const value = env[key];
      if (value && !isAes256KeyBase64(value))
        ctx.addIssue({ code: 'custom', path: [key], message: 'must be base64 of exactly 32 bytes' });
    }
    const required = [...REAL_ADAPTER_KEYS, ...(env.APP_MODE === 'production' ? PRODUCTION_ONLY_KEYS : [])];
    for (const key of required) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `required when APP_MODE=${env.APP_MODE}` });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Treat empty strings (as left by a copied .env.example) as unset. */
function withoutEmptyValues(source: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(source).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

/** Parse and validate; throws listing every bad or missing key (names only, never values). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(withoutEmptyValues(source));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

/** Operator scripts: validate only the database settings, with the same TLS rules as the app. */
export function parseDbEnv(source: Record<string, string | undefined>): DbEnv {
  const result = dbEnvSchema.safeParse(withoutEmptyValues(source));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid database configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}

/**
 * APP_MODE on its own (pr74-review F1). For the root layout's staging banner: it prerenders every page, and a build
 * made with only APP_MODE set (scripts/check-no-dev-routes.sh) must not need the rest of the schema.
 */
export function getAppMode(): AppMode {
  return z.enum(APP_MODES).parse(process.env.APP_MODE);
}

/**
 * NEXT_PUBLIC_SITE_URL on its own (UX-05: the root layout's metadataBase, so og:image is absolute), with the same rule
 * as the schema. Like getAppMode it must not need the rest of the env (the layout renders every page); a build made
 * with only APP_MODE set gets no metadataBase rather than an error.
 */
export function getSiteUrl(): URL | undefined {
  const parsed = z
    .url()
    .refine((url) => !url.endsWith('/'))
    .safeParse(process.env.NEXT_PUBLIC_SITE_URL);
  return parsed.success ? new URL(parsed.data) : undefined;
}

/** `next dev` (T4.1.05: the CSP adds 'unsafe-eval' there for React's dev build only). */
export function isDevServer(): boolean {
  return process.env.NODE_ENV === 'development';
}

let cachedEnv: Env | undefined;

export function getEnv(): Env {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
