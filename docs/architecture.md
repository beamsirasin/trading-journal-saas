# Architecture

**Status:** Phases 03–11 are officially complete; Phase 12 — Hardening & Launch Readiness and Phase 13 — Journal V2 are in progress. Phase 13B extends the existing Strategy version graph with version-owned `setup_conditions`: the authoritative Strategy COW transaction copies and remaps them with Setup snapshots, and PostgreSQL resolves immutability through the parent Strategy Version lock. `trade_setup_condition_checks` is a separate immutable historical Entry-snapshot boundary; its explicit-answer transaction helper is implemented but intentionally dormant until Phase 13C. Workspace Export's allowlisted JSON/CSV contract is now schema version 2 and includes both datasets. The single authenticated `/app/settings` route sits outside the completed-onboarding route group and composes distinct trust scopes: self-only Profile/Preferences/Security; owner plus `ordinary_write` Workspace rename; canonical Account/Plan/Billing presentation; and owner-only, entitlement-independent Workspace export. Phase 11 added a second, structurally separate trust scope outside `[locale]` entirely: `/admin`, authorized only by a dedicated `platform_admins` grant-history table, never by Workspace ownership or role.

## 1. Shape

A single Next.js application using the App Router, with server-rendered pages and server actions for mutations. No separate API service: the trust boundary is the server action, not a network hop.

```
Browser
  │  RSC payloads + server action calls
  ▼
Next.js (App Router)
  ├── proxy.ts      optimistic locale + session-cookie-presence redirect
  ├── app/          routes, thin
  ├── server/       auth + authenticated DAL/actions -> authoritative services
  └── lib/          pure logic: calc (Phase 07C/D), money, time, auth (Better Auth)
                          │
                          ▼
                    PostgreSQL (Drizzle) — auth + workspaces/accounts/entitlements/audit
```

## 2. Directory layout

```
src/
  app/
    [locale]/             Every route is locale-prefixed — /en/... or /th/...
      (public)/           Marketing site: /, /pricing, /login, /register, /demo,
                          /verify-email, /forgot-password, /reset-password, /auth-error
      (app)/              Application shell — REAL server-verified guard (Phase 02)
        app/              /app, /trades, /strategies, /analytics, /settings
      layout.tsx           Root <html>/<body>, generateMetadata, font
      not-found.tsx        Translated 404
    api/auth/[...all]/    Better Auth's Next.js route handler (lazy per-request)
    global-error.tsx      Fallback for a failed [locale] layout — deliberately English-only
    api/health/           Liveness endpoint
    robots.ts             Disallow-all while the product is a preview
    icon.svg              Placeholder file-based icon
  i18n/
    routing.ts            Locales, default locale, localePrefix ('always')
    navigation.ts         Locale-aware Link/redirect/usePathname/useRouter
    request.ts            Per-request message catalog loader
    metadata.ts           Route-specific canonical, hreflang and Open Graph locale helpers
  proxy.ts                 Locale detection + optimistic session-cookie-presence redirect
                           (renamed from middleware.ts — Next.js 16 convention)
  components/
    ui/                   Vendored shadcn primitives + project-authored controls
    shell/                Layout: app shell, sidebar, drawer, container, brand
    theme/                Theme provider, header toggle, settings selector
    marketing/            Public-site sections and chrome
    product/              Reusable product UI: KPI, comparison, chart frame
    charts/               Recharts components + shared tooltip
    dashboard/            The demo attribution dashboard
    forms/                Visual-only form prototypes
  config/
    env.schema.ts         Pure Zod schemas — testable
    env.server.ts         server-only; build fails if imported client-side
    env.client.ts         NEXT_PUBLIC_* only
    plans.ts              Authoritative plan registry — shared by presentation and entitlements
    mistakes.ts           Mistake taxonomy and severity weights (Phase 07B)
  hooks/
    use-is-hydrated.ts    SSR-safe hydration detection
    use-prefers-reduced-motion.ts
                          SSR-safe accessibility preference
  lib/
    utils.ts              cn() and small shared helpers
    motion.ts             Duration and easing conventions
    money/                Integer minor units, currency-aware
    time/                 UTC storage, IANA conversion, day bucketing
    demo/                 Static fixtures for the Phase 01 prototype — NO formulas
    calc/                 PURE calculation engine        (Phase 07C/D, real)
    auth/                 Better Auth instance (server.ts), client, email adapter (email.ts)
    identifiers.ts        The one ID generator — UUIDv7, see ADR 0008
  server/
    auth/
      dal.ts               Server-only session/workspace authorization DAL — the real boundary
    db/
      client.ts           Drizzle handle, connects lazily
      schema/             auth, workspaces, preferences, audit, trading accounts, entitlements
      queries/            Workspace-scoped query helpers     (planned for later product tables)
    actions/              Server actions — guarded, validated. e.g. preferences.ts
    services/             Business logic, tenant-aware. e.g. workspace-provisioning.ts, audit-log.ts
e2e/                      Playwright specs (+ support/ — global-setup fixtures for auth specs)
drizzle/                  Generated SQL migrations — 0000_init_auth_tenancy.sql
```

## 3. Layer rules

**`app/` is thin.** A route composes components and calls a service. Business logic in a route is a bug.

**`lib/calc/` is pure.** No imports from `server/` or `app/`, no I/O, no database, no `Date.now()`. Plain data in, plain data out. This is what makes the financial engine testable and trustworthy, and it is the single most important boundary in the codebase.

**`server/services/` holds business logic.** Tenant-aware, transaction-aware, calls into `lib/calc/` for arithmetic.

**`server/db/queries/` is the only place raw database access is allowed.** Every helper takes a `WorkspaceContext` first and injects `workspace_id`. Writing an unscoped query should require deliberately bypassing this directory, not merely forgetting a filter.

**`lib/demo/` contains no arithmetic.** It holds static presentation fixtures only for the explicitly labelled public `/demo` tour. Authenticated `/app` and `/app/analytics` use real workspace data and do not import this boundary. A formula written here would be a second implementation of the calculation engine outside `lib/calc/`. See [ADR 0006](decisions/0006-design-system-and-demo-data.md).

**`config/plans.ts` is the authoritative paid-plan registry.** Presentation and server-side entitlement resolution share it so prices, plan keys, and 1/5/15 active-account allowances cannot drift. The trial's 1-account allowance remains a separate explicit constant. Phase 3C already enforces create/restore limits in the mutation transaction; Phase 04 adds billing and checkout without creating a second entitlement source.

**Infrastructure sits behind adapters** — auth provider, email sender, payment provider. Swapping Neon for a VPS Postgres, or the mock payment provider for a real one, must not touch feature code.

**`src/i18n/` is the only place that imports `next/navigation` or `next/link` directly.** Every other file imports `Link`, `redirect`, `usePathname`, `useRouter` from `@/i18n/navigation` instead — that layer is what prepends the locale segment to a route, so bypassing it produces a link with no locale prefix. See [ADR 0007](decisions/0007-i18n-architecture.md).

## 4. Request flow for a mutation _(implemented for accounts; extended by later phases)_

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

## 5. Authentication and multi-tenancy

**Authentication** is Better Auth (self-hosted, Drizzle adapter, database-backed sessions) — see [ADR 0009](decisions/0009-self-hosted-better-auth.md) and [ADR 0010](decisions/0010-database-backed-sessions.md). Two layers, two different jobs:

- `src/proxy.ts` — optimistic, cookie-presence-only check (`getSessionCookie`). Redirects an unauthenticated visitor away from `/{locale}/app/*` before they reach a page that would reject them anyway. Never validates the cookie; never the real authorization boundary.
- `src/server/auth/dal.ts` — server-only, re-verifies against the database on every call (`getOptionalSession`/`requireSession`, via `auth.api.getSession` with `disableCookieCache: true`). This is where a forged, expired, cached-but-revoked cookie is rejected. Every protected layout, page, and server action calls this module.

**Multi-tenancy**: every business record carries `workspace_id`. Scope is derived from the authenticated session (`getActiveWorkspaceContext()`), never from a request body, query string, hidden field, or URL segment. See [ADR 0011](decisions/0011-tenant-workspace-authorization-model.md) for the full model — `workspaces`/`workspace_members`/`user_preferences` schema, the partial-unique-index guarantee behind "exactly one personal workspace per user," and `requireWorkspaceMembership`/`requireWorkspaceRole` as the functions any future client-supplied workspace ID must pass through.

Five checks on every protected read and write:

1. Authenticated user
2. Active workspace membership
3. Required role
4. Record ownership / workspace scope
5. Subscription entitlement, where the action consumes a limited resource

Checks 1–5 apply today to trading-account creation/restoration: workspace and record scope come from server-resolved context, and the active-account entitlement is checked in the same locked transaction as the mutation. Archived accounts do not consume the allowance.

Every new user is provisioned exactly one personal workspace via `ensurePersonalWorkspace()` (`src/server/services/workspace-provisioning.ts`) — idempotent, safe under concurrency (the database's unique constraints do the real work, not a check-then-insert), called both from a Better Auth `databaseHooks.user.create.after` hook and, defensively, from `getActiveWorkspaceContext()` itself, in case the hook ever fails independently.

Record IDs are UUIDv7 — sortable and non-enumerable ([ADR 0008](decisions/0008-identifier-strategy.md)). Unguessable IDs are defence in depth, never the authorization mechanism.

## 6. Data integrity

**Money never touches floating point.** Monetary amounts are `BIGINT` minor units plus a currency code. Instrument prices are `NUMERIC(20,10)` read as strings and manipulated with decimal.js — a price like `1.08532` has no cent representation, so one storage strategy could not serve both. See [calculation-spec.md](calculation-spec.md).

**Timestamps are `timestamptz` in UTC.** Display and date-bucketed analytics use the user's IANA timezone. Never the server's, never the browser's.

**Derived values are persisted** with a `calc_version`, so analytics does not recompute decimals per row and an engine fix cannot silently rewrite history. Changing them requires a deliberate backfill migration.

## 7. Testing strategy

| Layer      | Tool                   | Covers                                                                                                                                                                                                                                |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure logic | Vitest                 | The calculation engine — golden fixtures, property tests, every edge case                                                                                                                                                             |
| Components | Vitest + RTL           | Rendering, accessible roles, state handling                                                                                                                                                                                           |
| Tenancy    | Vitest + real Postgres | Cross-workspace isolation, session/authorization matrix — `src/server/auth/dal.integration.test.ts`, `src/server/services/workspace-provisioning.integration.test.ts`. Gated on `TEST_DATABASE_URL`; see `docs/migration-runbook.md`. |
| E2E        | Playwright             | Critical flows against a production build, both locales, desktop and mobile                                                                                                                                                           |

The engine's purity is what allows its tests to be exhaustive without fixtures, mocks, or a database.

## 8. Deployment

Vercel initially; Neon for PostgreSQL. Both are chosen for convenience, not lock-in — the app uses a standard `DATABASE_URL` and avoids provider-specific database features, so relocating to a VPS is a configuration change rather than a rewrite. See [decisions/0001-initial-stack.md](decisions/0001-initial-stack.md).

Migrations run as an explicit, reviewed step — never automatically on boot.

**Liveness** is `/api/health`. It deliberately does not check the database: liveness and readiness are different signals, and returning unhealthy on a database blip would make an orchestrator restart a process that was working fine. A dependency-checking `/api/ready` belongs in Phase 12.

## 9. Database connections

Full reasoning in [decisions/0004-database-access.md](decisions/0004-database-access.md) and [decisions/0012-migration-strategy.md](decisions/0012-migration-strategy.md). Operational detail: [migration-runbook.md](migration-runbook.md).

| Variable                 | Used by             | Why                                       |
| ------------------------ | ------------------- | ----------------------------------------- |
| `DATABASE_URL`           | Application queries | Pooled endpoint; many short-lived queries |
| `DATABASE_MIGRATION_URL` | Migrations only     | Direct connection                         |

Transaction poolers do not hold advisory locks across a connection. Drizzle's migrator uses one to serialise runs, so migrating through a pooler lets two concurrent runs interleave and corrupt the journal. `DATABASE_MIGRATION_URL` falls back to `DATABASE_URL`, because a plain PostgreSQL server has only one endpoint — renamed from the earlier placeholder `DATABASE_URL_UNPOOLED` in Phase 02 to name what the variable is _for_, not the connection topology.

Three properties the client must keep:

- **No connection at module import.** Module-scope connection code runs during `next build` static generation and would fail the build on any machine without a reachable database.
- **`numeric` and `bigint` return strings.** Coercing them to JS numbers would reintroduce exactly the floating-point error the money strategy exists to avoid — invisibly, and only for large or precise values.
- **Driver stays portable.** postgres.js over the plain wire protocol, not Neon's serverless driver, so the same code runs against Neon, Docker, and a VPS.

Local development can use Docker Compose (`pnpm db:up`) or a personal Neon branch. Docker is optional.

## 10. Environment boundaries

| Environment    | Database                                  | Secrets                                       |
| -------------- | ----------------------------------------- | --------------------------------------------- |
| **Local**      | Docker Postgres or a personal Neon branch | `.env.local`, never committed                 |
| **Preview**    | A non-production database, always         | Hosting platform store                        |
| **Production** | Neon production                           | Hosting platform store, rotated independently |

`env.server.ts` imports `server-only`, so a client component importing it — even transitively — fails the build. A leaked `DATABASE_URL` cannot be un-leaked once it ships in a client bundle, so this is enforcement rather than convention.
