# ADR 0004 — Database access and connection strategy

- **Status:** Accepted
- **Date:** 2026-07-31
- **Phase:** 00b — Core primitives

## Context

`CLAUDE.md` §2 requires PostgreSQL through a standard `DATABASE_URL`, Neon for the initial deployment, and portability to a plain VPS later. Phase 00b establishes the boundary without creating any product schema.

## Decision

### Driver: postgres.js, not the Neon serverless driver

`@neondatabase/serverless` is faster over HTTP from serverless platforms, and it is **Neon-specific**. `postgres` (postgres.js) speaks the plain PostgreSQL wire protocol, so identical application code runs against Neon, a Docker container, and a VPS.

That portability is the stated requirement, and this is the decision that either honours or quietly breaks it. Revisit only if connection latency is **measured** to be a real problem.

### `numeric` and `bigint` return strings

postgres.js returns both as strings by default, which is exactly what the money and price strategy needs. Parsing them into JS numbers would reintroduce the floating-point error the whole design exists to avoid.

**Do not add transforms that coerce them.** This is the failure mode flagged as a risk in Phase 00, and it would be invisible: values would look right until they were large or precise enough not to be.

### No connection at module import

`getDb()` creates the client on first call and memoises it. Module-scope connection code runs during `next build` static generation, which would make the build fail on any machine without a reachable database — CI included — for pages that never touch it.

The client is also stashed on `globalThis` in development, because Next.js hot reload re-evaluates modules and would otherwise leak a pool per edit until PostgreSQL refuses connections.

### Pooled versus direct connections

| Variable                | Used by             | Why                                       |
| ----------------------- | ------------------- | ----------------------------------------- |
| `DATABASE_URL`          | Application queries | Pooled endpoint; many short-lived queries |
| `DATABASE_URL_UNPOOLED` | Migrations only     | Direct connection                         |

Transaction poolers — which is what Neon's pooled endpoint is — do not hold advisory locks across a connection. Drizzle's migrator uses one to serialise runs, so migrating through a pooler lets two concurrent runs interleave and corrupt the migration journal.

`DATABASE_URL_UNPOOLED` **falls back to `DATABASE_URL`**, because a plain PostgreSQL server has only one endpoint and requiring both there would be pointless ceremony.

### Migrations are generated, committed, forward-only

`drizzle-kit generate` produces reviewable SQL that is committed. **`drizzle-kit push` is never used against a shared database** — it diffs and applies without producing a migration file, so there is no artefact to review and no deliberate rollback path.

Migrations run as an explicit, reviewed step. Never automatically on boot.

### Local PostgreSQL is optional

`docker-compose.yml` provides a local database, but Docker is **not mandatory**: a developer can point `DATABASE_URL` at a personal Neon branch and never run it.

The compose file binds to `127.0.0.1` explicitly rather than `5432:5432`, which would listen on all interfaces and expose the database to the local network. Credentials in it are development-only defaults, not secrets — the port is loopback-only and the data is disposable.

**No application Dockerfile in this phase.** Writing one now would mean deciding the runtime, process manager, reverse proxy, and TLS termination for a production architecture that has not been designed. Deferred to Phase 12, which owns deployment.

## Consequences

**Positive**

- Neon today, VPS later, same code.
- Build does not require a database.
- `numeric`-as-string preserves the precision guarantee end to end.
- Migration safety is structural, not a convention someone has to remember.

**Negative / accepted**

- postgres.js over TCP is slower than Neon's HTTP driver from serverless functions. Accepted for portability; measurable if it matters.
- Two connection variables is mild extra configuration, mitigated by the fallback.
- **`docker-compose.yml` is unverified.** Docker is not installed on the development machine used for this phase, so the file is written from the documented schema but has never been started. It must be validated before being relied on.

## Alternatives considered

| Alternative                   | Why not                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@neondatabase/serverless`    | Fastest on Vercel, but writes provider lock-in into every query path.                                                              |
| `node-postgres` (`pg`)        | Perfectly good. postgres.js has better TypeScript types and returns `numeric` as strings by default, which this design depends on. |
| Prisma                        | Heavier runtime; migration SQL is less direct to review, which matters more than usual for financial data.                         |
| Drizzle `push` in development | Convenient, but normalises a workflow that must never touch production, and produces no reviewable artefact.                       |
| Neon's own migration tooling  | Provider-specific, against the portability requirement.                                                                            |
