# Runbook: running Time with Jon (T5.3.03)

What to do when something goes wrong, and how to undo a bad deploy. Written for the site's owner and whoever
helps run it. Environments and adapters: [README](../README.md#environments). Staging specifics, the Google
reconnect and test-data purges: [STAGING.md](./STAGING.md). No secrets live in this file or anywhere in the repo.

## 1. How a change reaches the site

- Every change is a pull request into `main`. `main` is protected: a PR and green required checks (Quality Checks,
  integration tests on Postgres 15, `supabase db reset` + integration tests, E2E smoke on Chromium and WebKit,
  "no /dev routes" in production and staging builds). Lighthouse runs too and blocks below performance 85 or
  accessibility 90.
- A merge to `main` deploys every Vercel project that builds from `main` (prototype, staging, production). Each
  project skips the build when nothing that ships changed (`src`, `public`, `scripts`, `supabase`, package files,
  `next.config.ts`, `vercel.json`).
- Database migrations in `supabase/migrations/` are applied to each Supabase project as a separate, deliberate
  step. Every migration must keep the previous app version working (add, don't rename or drop in the same release),
  so a rollback of the app never needs a rollback of the database.
- **Freeze windows (no deploys):** Dec 19 to Jan 3, and Feb 24 to Mar 3 (launch; hotfixes only, each one
  rehearsed on staging first).

## 2. Undo a bad deploy: Vercel Instant Rollback

Use this first, before any fix-forward, when the live site is broken after a deploy.

1. Vercel dashboard > the project (`timewithjon` for production) > **Deployments**.
2. Find the last deployment that worked (status Ready, marked Production before the bad one). Open its **⋯** menu >
   **Instant Rollback**, confirm. The production domain points at it within seconds. Nothing is rebuilt.
3. Check: open `https://timewithjon.com/api/health` (expect 200) and the landing page. Then `/admin`.
4. **Important:** after an Instant Rollback, Vercel stops auto-promoting new production deployments. Merges to
   `main` still build, but stay off the domain until you either **Undo Rollback** (same menu) or **Promote** a newer
   deployment. Fix forward with a normal PR, check it on staging, then Promote it.
5. CLI alternative (same effect): `vercel rollback <deployment-url> --scope <team>`; `vercel promote <url>` to go
   forward again.
6. A rollback does not touch the database, email or calendar. If the bad deploy sent wrong emails or calendar
   changes, they stay sent: see section 4.

## 3. Is it healthy?

- `GET /api/health` answers **200** when every check is ok and **503** when any check fails. The public body names
  each check with ok/fail only; the reasons need the cron secret header (`x-cron-secret`). Checks: `database`,
  `tick` (the scheduler ran in the last 35 minutes and its jobs didn't all fail), `outbox` (calendar changes
  aren't stuck), `google` (the calendar connection works), `media`, `signin_email`, `seed_invites` (no demo
  invites live outside the prototype).
- An uptime monitor watches `/api/health` and Sentry alerts on new errors (both set up at go-live).
- The scheduler is Supabase `pg_cron`: the **tick** (`/api/cron/tick`) every 15 minutes (emails, nudges, offers,
  calendar retries, digests, clean-ups) and the **media job** (`/api/jobs/media`) every 5 minutes (photos). Each
  call carries the cron secret; nothing else can run them. A slow Google or email provider can't stall a tick: every
  outside call stops at the tick's deadline, and jobs skipped that time run first on the next tick.

## 4. Common problems

| What you see                                                   | Likely cause                                                                                                            | What to do                                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The site or `/admin` errors right after a deploy               | The deploy                                                                                                              | Section 2 (Instant Rollback), then fix forward.                                                                                                                                                    |
| `/api/health` 503 on `tick`                                    | `pg_cron` stopped, or every job is failing                                                                              | Supabase > Database > Cron: is `twj-tick` there and succeeding? Check Sentry for the job's error. Re-run the migration that schedules the jobs if the job is missing.                              |
| `google` fails, or Jon got the "reconnect your calendar" email | Google access was revoked or expired                                                                                    | Admin > Settings > **Reconnect Google** (on staging: [STAGING.md](./STAGING.md)). Until then new locks go out as .ics invites; calendar changes wait in the outbox and go out after the reconnect. |
| Guests say they got no email                                   | Daily send budget hit, a bounce, or the provider is down                                                                | Health warnings name it ("emails not delivered", budget hit two days running). Bounced addresses show on the request. Emails retry by themselves; nothing to resend by hand.                       |
| Jon can't sign in with the typed code                          | Code expired (15 min), the address had 30 wrong codes this hour, or the daily sign-in email cap (8 a day in production) | Use the **link** in the sign-in email instead of typing the code: it signs in even while typed codes are paused. Or wait out the hour. The cap resets at midnight UTC.                             |
| A guest says their link "has gone a bit stale"                 | The link was revoked or replaced                                                                                        | Admin > Links: check it; make a new one if needed.                                                                                                                                                 |
| "Easy, tiger. Give it a minute and try again."                 | A per-IP or per-link limit                                                                                              | Limits clear within the hour (story pages: 20 new stories a day per link). Nothing to do unless it keeps happening.                                                                                |
| A booking shows on the site but not in the calendar            | Calendar change waiting to retry                                                                                        | Health `outbox`. It retries every tick; after the Google fix it catches up.                                                                                                                        |

## 5. Data

- Backups, the restore drill and monitoring are task T4.7 (January hardening); this section gets the restore steps
  then.
- Test data on staging or production is removed only with the purge scripts in [STAGING.md](./STAGING.md#purge-test-data-operator-only),
  never by hand-written SQL on production.
- Storage bucket settings are tracked in `ops/bucket-limits.ts`: `photos` 20 MiB (the app's upload cap) and the
  photo types the uploaders send, `exports` 50 MiB of zip, both private. After creating or restoring a project, run
  `pnpm -s tsx ops/pin-bucket-limits.ts` with that project's `SUPABASE_URL` and service role key (a dry run that lists
  any difference), then again with `--apply`; it reads the settings back and exits 1 if one still differs. Then run
  `ops/check-photo-bucket.ts` to see the limits hold.
- Sign-ups are off (`enable_signup = false` in `supabase/config.toml`; set the same in the dashboard under
  Authentication > Sign In / Providers on every hosted project). The one admin account is added by the operator under
  Authentication > Users; the app never creates users.
- Exports for the book are built from Admin > Stories > **Export**: only stories marked OK for the book, no email
  addresses, a 10-minute download link.
