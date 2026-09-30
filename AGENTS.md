# AGENTS.md: Time with Jon

Instructions for any coding agent working in this repo. Read this first, then the TSD section for your task.

## What this is

An invite-only, mobile-first booking site for Jon Cartwright's 50th. Guests pick times from a "menu" of things
to do with Jon; Jon locks bookings in from a phone-first admin; locked bookings land on the "Time with Jon" Google Calendar
(and show Jon as busy on his personal calendar).
About 40–100 guests, 1 admin. Season: Apr 1 – Jun 30, 2027. Domain: **timewithjon.com** (bought 2026-09-25 on Cloudflare).

**Source of truth:** the approved TSD, latest version (kept in the project's private workspace, not in this repo).
The task IDs (T0.1 …) and decision IDs (AD-1 …) used in code and commits refer to it.
If this file and the TSD disagree, the TSD wins. Tell the orchestrator about the disagreement.

## Naming (NAMING.md, 2026-09-25)

- Product name in prose and UI: **Time with Jon**. Wordmark: **TIME WITH JON**. The old working name is retired;
  never reintroduce it in code, copy, commits or new secret names.
- Slug everywhere (repo, package, Vercel/Supabase/Sentry projects, secret names): **timewithjon**
  (`timewithjon-proto`, `timewithjon-staging`, `timewithjon`; new credentials `timewithjon-<service>`).
- Short prefix, only where one is unavoidable (cookies, CSS, keys): `twj` (e.g. `twj_invite`, `twj_req`).
- "Book" as a verb or feature ("Book a time", booking) and the printed keepsake book are NOT the old name. Keep them.

## Stack (AD-1 … AD-11)

- Next.js App Router (16.x), TypeScript strict, React 19, on **Vercel**, functions pinned to `sfo1`
- **Supabase**: Postgres (`us-west-1`), private Storage (`photos`, `exports`), Auth email OTP for the admin only
- **Email**: Resend Free outbound in production (daily-budget guard); Gmail API mailer for staging and as the
  production fallback; inbound jon@/stories@ via Cloudflare Email Routing to Jon's Gmail (no inbound webhook)
- **Google Calendar API**: OAuth as Jon, refresh token AES-256-GCM encrypted
- **Cloudflare**: DNS, Turnstile · **R2**: photo backup only · **Sentry** (scrubbed) · **UptimeRobot** → `/api/health`
- `pg_cron` + `pg_net` → `POST /api/cron/tick` (15 min) and `POST /api/jobs/media` (5 min)
- pnpm, Zod (the only validation library), date-fns-tz (the only time library, `America/Vancouver`)

## Environments (APP_MODE)

| APP_MODE     | Vercel project                | Supabase project      | Adapters                          | URL                                         |
| ------------ | ----------------------------- | --------------------- | --------------------------------- | ------------------------------------------- |
| `prototype`  | `timewithjon-proto`           | `timewithjon-proto`   | mocks (email, calendar, storage)  | `timewithjon-proto.vercel.app`, PR previews |
| `staging`    | `timewithjon-staging` (T3.16) | `timewithjon-staging` | real; Gmail API mail, test Google | `staging.timewithjon.com`                   |
| `production` | `timewithjon` (T3.1)          | `timewithjon`         | real                              | `timewithjon.com`                           |

`/dev/*` routes are compiled **only** when `APP_MODE=prototype`, gated at build time (AD-13).

## Commands

```bash
pnpm install
pnpm dev            # local dev server
pnpm lint           # ESLint (flat config)
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest unit tests
pnpm test:engine:tz # the availability engine under UTC, Europe/London and America/Vancouver
pnpm db:test        # disposable loopback-only Postgres 15 for integration tests (scripts/test-db.sh)
pnpm test:int       # integration tests against it (DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres)
PORT=<free> pnpm test:route # a real prototype server; uses your exported (loopback) DATABASE_URL, :55432 only when unset
pnpm format         # Prettier
pnpm build          # production build
```

CI (`.github/workflows/ci.yml`, job **Quality Checks**) runs format check, lint, typecheck and unit tests on every
PR and on `main`. It must be green before merge.

## Layout

```
src/app/          Next.js routes (Server Components for pages, Route Handlers for every state change)
src/config/env.ts The ONLY place that reads process.env (Zod-validated). ESLint blocks process.env elsewhere.
src/content/      Typed copy modules (AD-10). Copy is never written by AI.
src/features/     One folder per component (see src/features/README.md)
supabase/         Supabase CLI config + migrations (the only migration tool)
ops/              Operator-only scripts (e.g. purge-test-data.sql, T3.16). The app never runs them.
evals/bugs.json   Regression register: every fixed bug gets an entry and a test.
tests/unit/       Vitest unit tests
tests/int/        Integration tests (real Postgres via `pnpm db:test`; never Supabase proto or production)
docs/STACK.md     Exact versions, regions and runtime rules
```

## Non-negotiable rules (from the TSD)

1. **No Server Actions.** Every state-changing endpoint is a Route Handler (AD-2).
2. **Vercel kills fire-and-forget work.** Every side effect is awaited in the request or written to an outbox row
   the tick retries. No un-awaited promises (AD-1, curious-if postmortem).
3. **Database:** `pg` from server code only, no ORM. RLS on for every table with zero policies; the Data API
   (PostgREST) is disabled; every schema change is a Supabase CLI migration (AD-3).
4. **Admin auth:** `requireAdmin()` inside every admin page and every `/api/admin/**` handler, plus an `Origin`
   check on every non-GET (AD-7). Never rely on a layout alone.
5. **Privacy:** no indexing (`X-Robots-Tag`, meta robots, `robots.txt Disallow: /`); `Referrer-Policy: same-origin`;
   no guest ever sees another guest's data; the Surprise Me plan never leaves Jon's admin (AD-11, AD-12).
6. **Logs and Sentry:** never log PII, tokens, request bodies or query strings. The Sentry scrubber is mandatory.
7. **Config:** read settings via `getEnv()` from `@/config/env`. Adding a variable means updating the schema,
   `.env.example` and the secret store. The env unit test fails if schema and `.env.example` drift.
8. **Secrets** never go in the repo (it is public). They live in Vercel env vars and the maintainer's private secret
   store; never print a secret into a log, commit, PR or issue.
9. **Banned words** in guest copy: "decline", "slot", "availability", "unavailable", "fully booked", "sold out",
   "schedule", "confirm booking", "John", em-dashes (TSD §9). A content test enforces it (T0.3).
10. Keep dependencies minimal; add one only when a task needs it. Security patches monthly (Dependabot).

## Git workflow

- Never push red builds to `main`; run the Quality Checks locally (`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`) before every push.
- **Dependabot:** don't take `@types/node` majors above the Node runtime (22).
- Build agents work in their own git worktrees (one per task); never share a working tree.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. Reference the TSD task ID.
- Commit identity: `JDC000000 <jdc000000@users.noreply.github.com>` (never a personal email). Agents may add a
  `Co-Authored-By:` trailer with a noreply address.
- Code review runs at the end of M1, M2 and M3, and there is a security review in M4 (T4.1, T4.2).
