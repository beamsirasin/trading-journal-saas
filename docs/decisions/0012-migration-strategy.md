# ADR 0012 — Migration strategy: Drizzle code-first, generated SQL committed

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

Phase 2 is the first phase with any tables at all — `src/server/db/` previously established only the lazy-connection _shape_ (ADR 0004), never real schema or a migration history. CLAUDE.md §2/§5 requires migrations to be generated SQL, committed to Git, and forward-only, and explicitly forbids `drizzle-kit push` against a shared database (no artefact to review, no deliberate rollback path). The Phase 2 brief additionally requires a clean separation between the pooled connection application queries use and the direct connection migrations require.

## Decision

**Drizzle Kit, code-first, `generate` then commit then `migrate`:**

- Schema lives in `src/server/db/schema/*.ts` (Drizzle table definitions) — the single source of truth. `drizzle-kit generate` diffs this against the current `drizzle/` migration history and writes a new, timestamped, reviewable SQL file. `drizzle-kit push` is never used against any shared environment (local, CI, Preview, or production) — only `generate` (author time) and `migrate` (apply time).
- `drizzle/0000_init_auth_tenancy.sql` is the first migration: Better Auth's core tables plus every Phase 2 application table, generated in one pass and reviewed before commit.
- **Better Auth's own CLI** (`npx @better-auth/cli generate`) was run once, locally, purely as a **reference** to confirm the adapter's expected column shape against the installed version — its output was never committed and is not a second migration source. The hand-authored Drizzle schema, with explicit `modelName` mappings back into `betterAuth()`'s config, is the only source of truth Drizzle and Better Auth both read from.
- **Connection split**: `DATABASE_URL` (pooled, application runtime) vs `DATABASE_MIGRATION_URL` (direct/unpooled, migrations and administration only) — renamed from the earlier placeholder `DATABASE_URL_UNPOOLED` to name what the variable is _for_. `drizzle.config.ts` reads `DATABASE_MIGRATION_URL`, falling back to `DATABASE_URL` when absent (documented in-code, logged which variable resolved — never the URL itself). The fallback exists because a plain VPS Postgres server has exactly one endpoint and requiring two variables there would be pure ceremony; a Neon deployment must set `DATABASE_MIGRATION_URL` explicitly (`docs/migration-runbook.md`) because Neon's pooled endpoint (PgBouncer, transaction mode) does not reliably hold the advisory locks DDL needs.
- New scripts: `db:generate`, `db:migrate`, `db:check` (drift detection — schema vs migration history), `db:studio`, `db:test:prepare` (applies migrations to a disposable test database, with its own safety checks — see ADR 0011's sibling doc, `docs/migration-runbook.md`), `test:integration`.

## Consequences

**Positive**

- Every schema change is a reviewable SQL diff in the PR that introduced it — no "what does the database actually look like" drift between environments, since every environment applies the same committed files in the same order.
- `db:check` catches the case where someone edited a Drizzle schema file and forgot to run `db:generate` — a CI-friendly drift check, not just a local habit.
- The pooled/direct split avoids a real, previously-undetectable failure mode (a migration silently corrupted or half-applied because its advisory lock didn't hold across a pooled connection).
- CI's `integration` job (`.github/workflows/ci.yml`) applies these exact migrations to a fresh `postgres:17-alpine` service container on every push — "do the committed migrations produce a complete, working schema from nothing" is verified on every push, not assumed.

**Negative / accepted**

- Two connection-string environment variables to configure per deployment target, rather than one — accepted as the direct cost of the pooled-connection-breaks-DDL problem it solves; documented explicitly in `docs/migration-runbook.md` and `.env.example` so it is not a surprise at deploy time.
- Generated SQL still needs a human review pass before commit (column types, index choices, cascade behavior) — Drizzle's diff is a starting point, not a substitute for reading the file before committing it.

## Alternatives considered

| Alternative                                                         | Why not                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `drizzle-kit push` for rapid iteration                              | Explicitly forbidden by CLAUDE.md §5 for any shared database — no committed artefact to review or roll back, and a schema drift between two developers' local `push` runs is silent until it breaks something.                                                                                                                      |
| Better Auth's own CLI-generated migrations as the source of truth   | Would create two independent migration histories (Better Auth's for its tables, Drizzle's for the application's) that could drift out of sync with no single "current schema" to point to. One hand-authored Drizzle schema, informed by Better Auth's CLI output but not generated by it, keeps exactly one history.               |
| A single `DATABASE_URL` for both application queries and migrations | Works today against a plain Postgres instance, but breaks silently against Neon's pooled endpoint the moment a migration needs an advisory lock — better to pay the two-variable cost now than debug a corrupted migration against a production-adjacent database later.                                                            |
| An ORM-managed "auto-migrate on boot" strategy                      | Forbidden by CLAUDE.md §4 ("no migrations at startup/build") — a deploy that races a schema change against in-flight requests on the previous schema version is a self-inflicted outage; migrations are applied as an explicit, separate step (`db:migrate`) in the deployment sequence, documented in `docs/migration-runbook.md`. |
