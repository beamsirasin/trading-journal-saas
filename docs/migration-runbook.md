# Database migration runbook

How schema changes move from a developer's machine to every environment this product runs in. See [ADR 0012](decisions/0012-migration-strategy.md) for why this shape was chosen, and [ADR 0004](decisions/0004-database-access.md) for the underlying connection strategy.

## The two connection strings

| Variable                 | Used by                                           | Points at                          |
| ------------------------ | ------------------------------------------------- | ---------------------------------- |
| `DATABASE_URL`           | The running application (`getDb()`)               | The **pooled** endpoint            |
| `DATABASE_MIGRATION_URL` | `drizzle-kit generate` / `migrate` / `check` only | The **direct** (unpooled) endpoint |

`drizzle.config.ts` reads `DATABASE_MIGRATION_URL`, falling back to `DATABASE_URL` when the former is unset — logged (`[drizzle.config] using ...`) but never the URL itself. The fallback is fine for a plain Postgres server (local Docker, a VPS) that only has one endpoint. **Never rely on the fallback against Neon** — Neon's pooled endpoint is PgBouncer in transaction mode, which does not reliably hold the advisory locks migrations need; set `DATABASE_MIGRATION_URL` to Neon's direct connection string explicitly.

## Commands

| Command                | What it does                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:generate`     | Diffs `src/server/db/schema/*.ts` against `drizzle/`'s history, writes a new SQL migration file. Review the generated SQL before committing — this is the reviewable artefact. |
| `pnpm db:migrate`      | Applies every not-yet-applied migration in `drizzle/` to whatever `DATABASE_MIGRATION_URL` (or `DATABASE_URL`) points at.                                                      |
| `pnpm db:check`        | Drift check — fails if the schema files and the migration history disagree. Run this in CI, not just locally.                                                                  |
| `pnpm db:studio`       | Drizzle Studio, a local schema/data browser. Development convenience only.                                                                                                     |
| `pnpm db:test:prepare` | Applies migrations to `TEST_DATABASE_URL` — see [Test database safety](#test-database-safety) below.                                                                           |

**Never run `drizzle-kit push`** against any shared environment (local Docker excluded, since nothing there is shared). It diffs and applies without writing a migration file — no artefact to review, no way to roll back deliberately. CLAUDE.md §5 forbids this outright.

## Local development

```bash
cp .env.example .env.local   # fill in DATABASE_URL — see below
docker compose up -d         # starts postgres:17-alpine on 127.0.0.1:5432
pnpm db:migrate
```

`docker-compose.yml`'s default credentials (`trading_os` / `trading_os_dev`, database `trading_os`) are not secrets — the port is bound to `127.0.0.1` only, and the data is disposable. `DATABASE_URL` for this setup:

```
DATABASE_URL=postgresql://trading_os:trading_os_dev@localhost:5432/trading_os
```

No separate `DATABASE_MIGRATION_URL` is needed locally — the fallback to `DATABASE_URL` is exactly the plain-Postgres case it exists for.

## Neon (development and production branches)

See [`docs/neon-setup.md`](neon-setup.md) for creating the project and branches. Once you have both connection strings from Neon's dashboard:

```
DATABASE_URL=postgresql://<user>:<password>@<pooled-host>/<db>?sslmode=require
DATABASE_MIGRATION_URL=postgresql://<user>:<password>@<direct-host>/<db>?sslmode=require
```

Apply migrations explicitly, from a machine with `DATABASE_MIGRATION_URL` set to the branch you intend to migrate:

```bash
pnpm db:migrate
```

**There is no auto-migrate-on-deploy.** CLAUDE.md §4 forbids migrations at build or startup time — a deploy that raced a schema change against in-flight requests on the previous schema version would be a self-inflicted outage. Run `pnpm db:migrate` as its own explicit step, before traffic is routed to code that expects the new schema.

## Vercel Preview deployments

A Preview deployment's `DATABASE_URL`/`DATABASE_MIGRATION_URL` should point at a **dedicated Preview/staging Neon branch**, never at the production branch and never at your personal local database. Configure this under Vercel's **Preview** environment scope (distinct from **Production** and **Development**) — see [`docs/neon-setup.md`](neon-setup.md#vercel-environment-scopes).

## GitHub Actions CI

`.github/workflows/ci.yml`'s `integration` and `e2e` jobs each start a fresh `postgres:17-alpine` service container and run the guarded `pnpm db:test:prepare` command before tests — proving the committed migrations produce a complete schema from nothing. This never touches Neon and needs no secrets.

## Test database safety

`scripts/test-database-safety.mjs` is the single guard used by migration preparation, Vitest, Playwright, and direct E2E provisioning. It requires an unmistakably disposable database name containing a `test` or `e2e` segment and the explicit acknowledgement `TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE` for every target, including localhost.

1. **`TEST_DATABASE_URL` must be set.** There is no fallback to `DATABASE_URL` — a missing test database fails loudly, never falls through.
2. **It must not resolve to the same database as `DATABASE_URL` or `DATABASE_MIGRATION_URL`.** Comparison normalizes schemes, default ports, credentials/query strings, and loopback aliases.
3. **Every host requires an explicit acknowledgement**: `TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE`. This is deliberately required even on localhost.
4. **The database name must contain a `test` or `e2e` segment.** A target named like a production database is rejected before any connection.

Vitest validates the original environment before binding the real DAL's `DATABASE_URL` to the guarded test URL. Playwright applies the same rule to its production web server, so fixtures and application code cannot silently use different databases.

```bash
# Local Postgres (docker compose up -d). The acknowledgement is required here too.
TEST_DATABASE_URL=postgresql://trading_os:trading_os_dev@localhost:5432/trading_os_test \
TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE \
pnpm test:integration

# A dedicated Neon test branch — ACK required.
TEST_DATABASE_URL=postgresql://...@ep-test-branch....neon.tech/trading_os \
TEST_DATABASE_ACK=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE \
pnpm test:integration
```

## Rollback

Drizzle's generated migrations are forward-only — there is no `db:migrate:down`. To roll back a bad migration:

1. Write a new, forward migration that reverses the change (`pnpm db:generate` after editing the schema files back, or hand-authoring the reverse SQL for a change Drizzle can't diff cleanly, e.g. a data migration).
2. Never hand-edit a committed migration file that has already been applied anywhere — edit forward, and never `DELETE`/rewrite rows in `drizzle`'s own migration-journal table.
3. For a genuinely destructive situation (data corruption, not just a bad column), restore from a Neon branch/point-in-time-recovery snapshot per your actual Neon plan's capabilities — verify what your plan actually supports before promising a restore window to anyone.

## Future VPS target

Nothing above is Neon-specific except the pooled/direct endpoint split and the branch-per-environment convention. A VPS Postgres instance has one endpoint, so `DATABASE_MIGRATION_URL` is simply unset there (the fallback applies), and `pnpm db:migrate` is run the same way, from a deploy script or manually over SSH, as an explicit step before restarting the app.
