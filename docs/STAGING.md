# Staging runbook (T3.16)

`https://staging.timewithjon.com` = Vercel project `timewithjon-staging` (deploys `main` only; previews are skipped),
Supabase `timewithjon-staging`, real adapters: Gmail API mail from the throwaway test Gmail, the test Google
account's calendar, Turnstile, Storage + R2. `FEATURE_ADMIN_AUTH=1`; the only admin is the test Gmail.
Secrets live in the vault (`timewithjon-staging-*`) and Vercel env, never here.

## Connect Google (first time, and the weekly reconnect)

Prerequisite: the test Gmail is listed under GCP project **twj-staging > Google Auth Platform > Audience > Test users**.
The project stays in **Testing** mode. Without that entry Google answers **403 access_denied**.

In one browser signed in to the test Gmail only:

1. The operator sends the sign-in email (no A1 sign-in screen exists yet, so it goes straight through Supabase Auth's
   OTP endpoint; the link lives 15 minutes, 5 emails an hour).
2. Open "Your Time with Jon sign-in code" in the test Gmail inbox and click the link. `/admin` then shows a 404
   page until the admin screens ship; that's expected, the session cookie is set.
3. Same tab: open `https://staging.timewithjon.com/api/admin/google/connect`.
4. Pick the test Gmail, then "Google hasn't verified this app" > Continue, tick EVERY box (calendars it creates,
   free/busy, send email), then Continue.
5. It lands on `/admin/settings?google=connected` (another 404 page; the `google=` value is the result). Any other
   value (e.g. `google=scopes`): repeat step 3 and tick every box.

**Weekly:** refresh tokens of a Testing-mode project expire after 7 days, so staging loses Google every week. Reconnect
with the same 5 steps (the "Time with Jon (test)" calendar is reused, not recreated).

## Check a connection (prints no token)

`oauth_connection` has one `google` row for the test Gmail; `refresh_token_enc` is AES-256-GCM (iv | tag | ciphertext)
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
