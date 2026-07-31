# Architecture

**Status:** Phase 00. Directories marked _(planned)_ do not exist yet — they are recorded here so the shape is agreed before code fills it.

## 1. Shape

A single Next.js application using the App Router, with server-rendered pages and server actions for mutations. No separate API service: the trust boundary is the server action, not a network hop.

```
Browser
  │  RSC payloads + server action calls
  ▼
Next.js (App Router)
  ├── app/          routes, thin
  ├── server/       actions -> services -> queries       (planned)
  └── lib/          pure logic: calc, money, time        (partly planned)
                          │
                          ▼
                    PostgreSQL (Drizzle)                 (planned)
```

## 2. Directory layout

```
src/
  app/                    Routes only. No business logic.
  components/
    ui/                   Primitives (Card, Badge, …)
    <feature>/            Composed, feature-specific UI      (planned)
  config/
    env.ts                Zod-validated environment
    plans.ts              Subscription plan definitions      (planned)
    mistakes.ts           Mistake taxonomy and weights       (planned)
  lib/
    utils.ts              cn() and small shared helpers
    calc/                 PURE calculation engine            (planned)
    money/                Minor units + decimal helpers      (planned)
    time/                 UTC storage, timezone display      (planned)
    auth/                 Auth adapter                       (planned)
  server/                                                    (planned)
    actions/              Server actions — guarded, validated
    services/             Business logic, tenant-aware
    db/
      client.ts           Drizzle singleton
      schema/             Table definitions
      queries/            Workspace-scoped query helpers
e2e/                      Playwright specs
drizzle/                  Generated SQL migrations           (planned)
```

## 3. Layer rules

**`app/` is thin.** A route composes components and calls a service. Business logic in a route is a bug.

**`lib/calc/` is pure.** No imports from `server/` or `app/`, no I/O, no database, no `Date.now()`. Plain data in, plain data out. This is what makes the financial engine testable and trustworthy, and it is the single most important boundary in the codebase.

**`server/services/` holds business logic.** Tenant-aware, transaction-aware, calls into `lib/calc/` for arithmetic.

**`server/db/queries/` is the only place raw database access is allowed.** Every helper takes a `WorkspaceContext` first and injects `workspace_id`. Writing an unscoped query should require deliberately bypassing this directory, not merely forgetting a filter.

**Infrastructure sits behind adapters** — auth provider, email sender, payment provider. Swapping Neon for a VPS Postgres, or the mock payment provider for a real one, must not touch feature code.

## 4. Request flow for a mutation _(planned)_

```
Client form (React Hook Form + Zod, client-side UX validation only)
   │
   ▼
Server action
   ├── Zod parse            ← the real validation; the client's is a courtesy
   ├── requireWorkspace()   ← session -> WorkspaceContext; never client-supplied
   ├── requireRole()
   ├── requireEntitlement() ← plan limits, in the same transaction as the write
   ▼
Service  ──►  lib/calc/  (pure)
   │
   ▼
Scoped query helper  ──►  PostgreSQL
```

Client-side validation improves the experience. It is never the enforcement point. Every rule is re-checked server-side.

## 5. Multi-tenancy

Every business record carries `workspace_id`. Scope is derived from the authenticated session, never from a request body, query string, hidden field, or URL segment.

Five checks on every protected read and write:

1. Authenticated user
2. Active workspace membership
3. Required role
4. Record ownership / workspace scope
5. Subscription entitlement, where the action consumes a limited resource

Record IDs are UUIDv7 — sortable and non-enumerable. Unguessable IDs are defence in depth, never the authorization mechanism.

## 6. Data integrity

**Money never touches floating point.** Monetary amounts are `BIGINT` minor units plus a currency code. Instrument prices are `NUMERIC(20,10)` read as strings and manipulated with decimal.js — a price like `1.08532` has no cent representation, so one storage strategy could not serve both. See [calculation-spec.md](calculation-spec.md).

**Timestamps are `timestamptz` in UTC.** Display and date-bucketed analytics use the user's IANA timezone. Never the server's, never the browser's.

**Derived values are persisted** with a `calc_version`, so analytics does not recompute decimals per row and an engine fix cannot silently rewrite history. Changing them requires a deliberate backfill migration.

## 7. Testing strategy

| Layer      | Tool                   | Covers                                                                    |
| ---------- | ---------------------- | ------------------------------------------------------------------------- |
| Pure logic | Vitest                 | The calculation engine — golden fixtures, property tests, every edge case |
| Components | Vitest + RTL           | Rendering, accessible roles, state handling                               |
| Tenancy    | Vitest + real Postgres | Cross-workspace isolation, asserted directly _(planned)_                  |
| E2E        | Playwright             | Critical flows against a production build, desktop and mobile             |

The engine's purity is what allows its tests to be exhaustive without fixtures, mocks, or a database.

## 8. Deployment

Vercel initially; Neon for PostgreSQL. Both are chosen for convenience, not lock-in — the app uses a standard `DATABASE_URL` and avoids provider-specific database features, so relocating to a VPS is a configuration change rather than a rewrite. See [decisions/0001-initial-stack.md](decisions/0001-initial-stack.md).

Migrations run as an explicit, reviewed step — never automatically on boot.
