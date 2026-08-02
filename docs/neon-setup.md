# Neon setup guide

Manual, one-time setup steps for provisioning Neon PostgreSQL for this project. Nothing here is automated — Neon project/branch creation is not something this repo's code performs on your behalf.

**Status: not yet performed in this environment.** No Neon project exists for this repo as of Phase 2; the steps below are what an operator with Neon access needs to do. Nothing here has been verified against a real Neon project — verify each step against Neon's current console, which may have changed since this was written.

## 1. Create the project

1. Sign in at [neon.tech](https://neon.tech) (or your organization's existing account).
2. Create a new project. Choose a region close to where the application will run (matters for connection latency, not correctness).
3. Note the default branch Neon creates (usually `main` or `production`) — this becomes your **production** branch.

## 2. Create a development/Preview branch

Neon branches are cheap, copy-on-write forks of a parent branch — use this instead of sharing one database across environments.

1. From the project, create a new branch (e.g. `development`, or one per Preview deployment if you want per-PR isolation later).
2. This branch is what local development and Vercel Preview deployments should point at — **never** the production branch.

## 3. Get both connection strings

Neon's dashboard shows a **pooled** connection string and a **direct** connection string per branch (labeled, or toggled via a "Pooled connection" switch). Copy both, per branch:

- Pooled → `DATABASE_URL`
- Direct → `DATABASE_MIGRATION_URL`

Both must include `?sslmode=require` (Neon requires TLS).

Repeat for each branch you created (production, development).

## 4. Store the values

- **Local development**: `.env.local` (gitignored, never committed) — copy from `.env.example` and fill in the development branch's two URLs.
- **Vercel**: see [Vercel environment scopes](#vercel-environment-scopes) below — never paste a Neon connection string directly into code or commit it anywhere.

Never commit a real connection string. `.env.example` documents variable **names**, never real values.

## 5. Apply migrations

From a machine with `DATABASE_MIGRATION_URL` set to the branch you want to migrate:

```bash
pnpm db:migrate
```

See [`docs/migration-runbook.md`](migration-runbook.md) for the full command reference. Verify the tables exist afterward — Neon's SQL editor or `pnpm db:studio` both work — before pointing an application instance at the branch.

**Never run integration tests against a production or development branch directly** — provision a separate, dedicated test branch if you want Neon-backed integration tests, and set `TEST_DATABASE_URL` (plus `TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE`, since any `neon.tech` host is treated as non-local) to that branch specifically — see [`docs/migration-runbook.md`](migration-runbook.md#test-database-safety).

## Vercel environment scopes

Vercel has three environment scopes: **Development**, **Preview**, **Production**. Configure `DATABASE_URL`/`DATABASE_MIGRATION_URL` separately per scope:

| Vercel scope | Neon branch                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| Production   | The production branch                                                                                  |
| Preview      | The development/staging branch — **never** production                                                  |
| Development  | Not typically used (developers run `docker compose up -d` locally instead — see the migration runbook) |

**Never reuse the production database for local development or for tests.** A bug in a local script or a test run against the wrong `DATABASE_URL` should never be able to touch real user data.

## Backup and restore

This document does not claim any specific backup/restore capability beyond what your actual Neon plan provides — check your plan's point-in-time-recovery window in Neon's own documentation before relying on it, and do not treat this section as a guarantee. Nothing in this repo has tested a Neon restore.

## What "verified" means here

Nothing in this section has been exercised against a real Neon project in this environment — no Neon credentials are configured. This guide documents the exact steps to follow, not a confirmation that they were followed. Treat "Neon deployment verified" claims elsewhere in this repo's docs with that in mind unless a specific report says otherwise.
