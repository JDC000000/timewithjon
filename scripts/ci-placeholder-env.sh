#!/usr/bin/env bash
# scripts/ci-placeholder-env.sh — source this to boot a build locally or in CI with OBVIOUSLY FAKE values.
# T0.1.11 makes boot fail on a bad env, so the /dev-routes check needs a valid-looking one. Nothing here is a
# secret or reaches a real service: loopback DB (TLS off, loopback only), example.com addresses.
# Usage: APP_MODE=staging source scripts/ci-placeholder-env.sh
export NEXT_PUBLIC_SITE_URL="http://127.0.0.1:${PORT:-3197}"
export ADMIN_EMAILS="jon@example.com"
export SESSION_SIGNING_SECRET="ci-placeholder-session-secret-000000000000"
export SUPABASE_URL="https://placeholder.supabase.co"
export SUPABASE_ANON_KEY="ci-placeholder"
export SUPABASE_SERVICE_ROLE_KEY="ci-placeholder"
export DATABASE_URL="postgres://postgres:test@127.0.0.1:55432/postgres"
export DATABASE_SSL="disable"
export CRON_SECRET="ci-placeholder-cron-secret-00000000000000"
export DEV_PASSPHRASE="ci-placeholder-dev-passphrase"
if [[ "${APP_MODE:-}" != "prototype" ]]; then
  export JON_PERSONAL_EMAIL="jon@example.com"
  export VERCEL="1" # staging/production boot requires it (T4.2.01a N4)
  for k in GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET GOOGLE_TOKEN_ENC_KEY NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    TURNSTILE_SECRET_KEY R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BACKUP_BUCKET \
    RESEND_API_KEY; do
    export "$k=ci-placeholder"
  done
  # T3.3.02: boot checks the token key is base64 of exactly 32 bytes; 32 zero bytes is obviously fake.
  export GOOGLE_TOKEN_ENC_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
  export EMAIL_FROM_GUEST="Jon <jon@example.com>"
  export EMAIL_FROM_ADMIN="Time with Jon <admin@example.com>"
fi
