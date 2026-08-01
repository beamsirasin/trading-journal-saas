# Architecture

**Status:** Phase 01.1. Directories marked _(planned)_ do not exist yet — they are recorded here so the shape is agreed before code fills it.

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
  app/
    [locale]/             Every route is locale-prefixed — /en/... or /th/...
      (public)/           Marketing site: /, /pricing, /login, /register, /demo
      (app)/              Application shell (NO guard yet — Phase 02)
        app/              /app, /trades, /strategies, /analytics, /settings
      layout.tsx           Root <html>/<body>, generateMetadata, font
      not-found.tsx        Translated 404
    global-error.tsx      Fallback for a failed [locale] layout — deliberately English-only
    api/health/           Liveness endpoint
    robots.ts             Disallow-all while the product is a preview
    icon.svg              Placeholder file-based icon
  i18n/
    routing.ts            Locales, default locale, localePrefix ('always')
    navigation.ts         Locale-aware Link/redirect/usePathname/useRouter
    request.ts            Per-request message catalog loader
    metadata.ts           Route-specific canonical, hreflang and Open Graph locale helpers
  middleware.ts            Locale detection precedence and cookie sync
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
    plans.ts              Plan definitions — PRESENTATION ONLY, not entitlements
    mistakes.ts           Mistake taxonomy and weights       (planned)
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
    calc/                 PURE calculation engine            (planned)
    auth/                 Auth adapter                       (planned)
  server/
    db/
      client.ts           Drizzle handle, connects lazily
      schema/             Table definitions — EMPTY until Phase 03
      queries/            Workspace-scoped query helpers     (planned)
    actions/              Server actions — guarded, validated (planned)
    services/             Business logic, tenant-aware        (planned)
e2e/                      Playwright specs
drizzle/                  Generated SQL migrations           (planned)
```

## 3. Layer rules

**`app/` is thin.** A route composes components and calls a service. Business logic in a route is a bug.

**`lib/calc/` is pure.** No imports from `server/` or `app/`, no I/O, no database, no `Date.now()`. Plain data in, plain data out. This is what makes the financial engine testable and trustworthy, and it is the single most important boundary in the codebase.

**`server/services/` holds business logic.** Tenant-aware, transaction-aware, calls into `lib/calc/` for arithmetic.

**`server/db/queries/` is the only place raw database access is allowed.** Every helper takes a `WorkspaceContext` first and injects `workspace_id`. Writing an unscoped query should require deliberately bypassing this directory, not merely forgetting a filter.

**`lib/demo/` contains no arithmetic.** It holds static presentation fixtures for the Phase 01 prototype. A formula written there to make a demo surface move would be a second implementation of the calculation engine, outside `lib/calc/`, untested and free to disagree with the real one. It is deleted or reduced to test fixtures once Phase 09 wires real data in. See [ADR 0006](decisions/0006-design-system-and-demo-data.md).

**`config/plans.ts` is presentation only.** It renders the pricing page. It is not an entitlement source, and no server check reads it — Phase 04 owns entitlements, evaluated server-side in the same transaction as the write they gate.

**Infrastructure sits behind adapters** — auth provider, email sender, payment provider. Swapping Neon for a VPS Postgres, or the mock payment provider for a real one, must not touch feature code.

**`src/i18n/` is the only place that imports `next/navigation` or `next/link` directly.** Every other file imports `Link`, `redirect`, `usePathname`, `useRouter` from `@/i18n/navigation` instead — that layer is what prepends the locale segment to a route, so bypassing it produces a link with no locale prefix. See [ADR 0007](decisions/0007-i18n-architecture.md).

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

| Layer      | Tool                   | Covers                                                                      |
| ---------- | ---------------------- | --------------------------------------------------------------------------- |
| Pure logic | Vitest                 | The calculation engine — golden fixtures, property tests, every edge case   |
| Components | Vitest + RTL           | Rendering, accessible roles, state handling                                 |
| Tenancy    | Vitest + real Postgres | Cross-workspace isolation, asserted directly _(planned)_                    |
| E2E        | Playwright             | Critical flows against a production build, both locales, desktop and mobile |

The engine's purity is what allows its tests to be exhaustive without fixtures, mocks, or a database.

## 8. Deployment

Vercel initially; Neon for PostgreSQL. Both are chosen for convenience, not lock-in — the app uses a standard `DATABASE_URL` and avoids provider-specific database features, so relocating to a VPS is a configuration change rather than a rewrite. See [decisions/0001-initial-stack.md](decisions/0001-initial-stack.md).

Migrations run as an explicit, reviewed step — never automatically on boot.

**Liveness** is `/api/health`. It deliberately does not check the database: liveness and readiness are different signals, and returning unhealthy on a database blip would make an orchestrator restart a process that was working fine. A dependency-checking `/api/ready` belongs in Phase 12.

## 9. Database connections

Full reasoning in [decisions/0004-database-access.md](decisions/0004-database-access.md).

| Variable                | Used by             | Why                                       |
| ----------------------- | ------------------- | ----------------------------------------- |
| `DATABASE_URL`          | Application queries | Pooled endpoint; many short-lived queries |
| `DATABASE_URL_UNPOOLED` | Migrations only     | Direct connection                         |

Transaction poolers do not hold advisory locks across a connection. Drizzle's migrator uses one to serialise runs, so migrating through a pooler lets two concurrent runs interleave and corrupt the journal. `DATABASE_URL_UNPOOLED` falls back to `DATABASE_URL`, because a plain PostgreSQL server has only one endpoint.

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
