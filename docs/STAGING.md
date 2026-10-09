# Staging runbook (T3.16)

`https://staging.timewithjon.com` = Vercel project `timewithjon-staging` (deploys `main` only; previews are skipped),
Supabase `timewithjon-staging`, real adapters: Resend mail (`system_status.mailer_mode` = `resend`), the host's own
Google account (free/busy from the primary calendar, bookings on a "Time with Jon (test)" calendar it creates),
Turnstile, Storage + R2. `FEATURE_ADMIN_AUTH=1`; the admins are `ADMIN_EMAILS` (the host first).
Secrets live in the vault (`timewithjon-staging-*`) and Vercel env, never here.

## Connect Google

Prerequisite: GCP project **twj-staging > Google Auth Platform > Audience**, publishing status **In production**
(unverified is fine while only the host signs in). In **Testing** mode Google ends every refresh token after 7 days,
so staging would lose Google every week.

1. Sign in at `https://staging.timewithjon.com/admin/sign-in` with an admin address (a code arrives by email).
2. `/admin/settings` > Calendar > **Connect Google** (or **Reconnect Google**); the same as
   `/api/admin/google/connect`.
3. Pick the host's Google account, then "Google hasn't verified this app" > Advanced > Continue, tick EVERY box
   (calendars it creates, free/busy, send email), then Continue.
4. It lands on `/admin/settings?google=connected`. Any other value (e.g. `google=scopes`): repeat step 2 and tick
   every box.

A reconnect reuses the "Time with Jon (test)" calendar; it is not recreated.

## Check a connection (prints no token)

`oauth_connection` has one `google` row for the connected account; `refresh_token_enc` is AES-256-GCM (iv | tag | ciphertext)
under `GOOGLE_TOKEN_ENC_KEY`; `scopes` hold openid, userinfo.email, calendar.app.created, calendar.freebusy and
gmail.send; `calendar_id` is "Time with Jon (test)" (never `primary`); a refresh succeeds; freeBusy answers.

## Purge test data (operator only)

1. `psql <direct_url> -X -v env=staging -v dry_run=1 -f ops/purge-test-data.sql` (the plan; nothing changes), then the
   same with `-v dry_run=0` to commit. `dry_run` is required, exactly `0` or `1`, and given ONCE (psql keeps only
   the last `-v dry_run`). It refuses while a test request still has a calendar event or a queued calendar change,
   and rolls back if any real row would go. Production also needs `-v confirm=production` (and `-v post_launch_ok=1`
   once invites are open, which keeps open counts and analytics).
2. `pnpm -s tsx --conditions=react-server ops/purge-storage.ts --env=staging` (dry run), then `--apply`. It refuses
   unless SUPABASE_URL and DATABASE_URL are the same project and R2_BACKUP_BUCKET is the env's bucket; deleting over
   50 objects, or over 20% of what it listed, needs `--max-delete=N`.
3. `ops/end-admin-sessions.sql` (review F11).
   AC2's empty buckets also wait for `incoming/` (tick purge, within 1 h 15 min) and `exports` (24 h purge).

## Rate limits and Turnstile (T3.8.04, checked 2026-09-26)

- Per-IP limits key on the client IP Vercel supplies (`x-vercel-forwarded-for`, rightmost hop), never on a
  client-sent `x-real-ip` or `x-forwarded-for` (M2): spoofing those doesn't change the bucket. TSD T3.8 AC5's
  "x-real-ip" wording predates M2. A probe from one machine (e.g. 11 POSTs to `/api/requests`) keeps that IP
  limited for about an hour.
- Staging uses its own managed Turnstile widget (`timewithjon-staging-turnstile`). Cloudflare refuses headless
  browsers (600010), so a passing token needs a person's browser; bad or missing tokens get 400 `bot_check`.
