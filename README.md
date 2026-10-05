# Time with Jon

Invite-only booking site for Jon Cartwright's 50th: a restaurant-style menu of things to do with Jon, a time picker,
and a phone-first admin where Jon locks bookings in. Source-available, all rights reserved ([LICENSE](./LICENSE)).
Domain: `timewithjon.com`. Photos in git are licensed stand-ins ([docs/PHOTOS.md](./docs/PHOTOS.md)).

- **Scope:** TSD (approved 2026-09-25; latest version, kept in the private project workspace)
- **Agent instructions:** [AGENTS.md](./AGENTS.md)

## Stack

Next.js (App Router, TypeScript strict) on Vercel · Supabase (Postgres, private Storage, Auth) · Resend Free (outbound) ·
Gmail API mailer (staging, fallback) · Cloudflare Email Routing (inbound) ·
Google Calendar API · Cloudflare (DNS, Turnstile, R2 backup) · Sentry · UptimeRobot.

## Getting started

Requires Node 22 (`.nvmrc`) and pnpm (`corepack enable`).

```bash
pnpm install
cp .env.example .env.local   # fill from the credential vault; never commit it
pnpm dev
```

| Command                             | What it does        |
| ----------------------------------- | ------------------- |
| `pnpm dev`                          | Local dev server    |
| `pnpm lint`                         | ESLint              |
| `pnpm typecheck`                    | TypeScript, no emit |
| `pnpm test`                         | Vitest unit tests   |
| `pnpm test:engine:tz`               | Engine under 3 TZs  |
| `pnpm db:test` / `pnpm test:int`    | Integration tests   |
| `pnpm format` / `pnpm format:check` | Prettier            |
| `pnpm build`                        | Production build    |

## Environments

| APP_MODE     | Where                                        | Notes                                            |
| ------------ | -------------------------------------------- | ------------------------------------------------ |
| `prototype`  | `timewithjon-proto.vercel.app` + PR previews | Mock email, calendar and storage; `/dev/*` tools |
| `staging`    | `staging.timewithjon.com`                    | Real adapters, test Google account               |
| `production` | `timewithjon.com`                            | Real adapters, Jon's calendar                    |

Every environment variable is listed in [`.env.example`](./.env.example) and validated
by [`src/config/env.ts`](./src/config/env.ts).

## CI

GitHub Actions: Quality Checks (Prettier, ESLint, `tsc --noEmit`, Vitest), integration tests, E2E smoke (Chromium + WebKit) and Lighthouse. `main` only takes pull requests with the required checks green. Deploys, rollback and incidents: [docs/RUNBOOK.md](./docs/RUNBOOK.md).

## Status

M0 Foundation in progress (T0.1 onward). Versions and regions: [docs/STACK.md](./docs/STACK.md).
