# Stack: exact versions and runtime rules

Source: TSD (latest), AD-1 to AD-13. Versions as of the T0.1 platform PR (`pnpm ls --depth 0`, 2026-09-25).
Update this file whenever a dependency's major or minor version changes.

## Runtime

| Thing    | Version / setting                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js  | 22 (`.nvmrc`; Vercel project setting 22.x)                                                                                                                                                                                  |
| pnpm     | 11.9.0                                                                                                                                                                                                                      |
| Vercel   | functions pinned to `sfo1` (`vercel.json`)                                                                                                                                                                                  |
| Supabase | hosted Postgres 17.6, region `us-west-1` (next to `sfo1`, L3); separate proto and staging projects (free org; project refs are in the maintainer's private notes). CI runs the migrations on Supabase PG 17 and plain PG 15 |

## Dependencies

| Package          | Version |
| ---------------- | ------- |
| next             | 16.3.6  |
| react, react-dom | 19.3.0  |
| zod              | 4.6.5   |
| pg               | 8.23.0  |
| date-fns         | 4.4.0   |
| date-fns-tz      | 3.2.0   |
| @sentry/nextjs   | 11.0.0  |
| server-only      | 0.0.1   |

| Dev dependency                 | Version                                      |
| ------------------------------ | -------------------------------------------- |
| typescript                     | 5.9.3                                        |
| vitest                         | 5.0.1                                        |
| eslint / eslint-config-next    | 9.39.5 / 16.3.6                              |
| eslint-config-prettier         | 10.1.8                                       |
| prettier                       | 3.9.9                                        |
| tsx                            | 4.23.15                                      |
| @types/node                    | 22.20.4 (never above the Node runtime major) |
| @types/pg                      | 8.23.1                                       |
| @types/react, @types/react-dom | 19.3.0                                       |

## Runtime rules

- **Route Handlers only, no Server Actions** (AD-2). Every state change is a `POST`/`PATCH`/`DELETE` Route Handler.
- Every side effect is awaited in the request or written to an outbox row the tick retries; no fire-and-forget (AD-1).
- Database access is `pg` from server code only, through the transaction pooler (port 6543); no ORM, no Data API (AD-3).
- TLS to the pooler is `verify-full` against the Supabase Root 2021 CA (`DATABASE_CA_CERT`; proven in T0.2.19). The pooler chain: `*.pooler.supabase.com` ← Supabase Intermediate 2021 ← Supabase Root 2021 (expires 2031-04-26).
- Config is read only through `getEnv()` in `src/config/env.ts` (ESLint blocks `process.env` elsewhere).
- Scheduling is `pg_cron` + `pg_net`, not Vercel cron (AD-8).
