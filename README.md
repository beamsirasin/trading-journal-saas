# Trading OS

A multi-tenant trading journal that separates **system performance** from **trader execution**.

Most journals tell you your P&L. This one tells you where it came from:

> Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?

---

## Status

**Phase 02 — Neon PostgreSQL, Better Auth, user preferences, tenant-isolated workspace foundation** (branch `phase/02-auth-tenancy`, not yet merged to `main`), on top of Phase 01/01.1's design system, marketing site and application shell.

Authentication (Google OAuth + email/password, via self-hosted Better Auth) and a real, migrated PostgreSQL database now exist. Every visitor to `/{locale}/app/*` is a genuinely authenticated user with one personal workspace, verified server-side on every request — not a mock session. Trading accounts, strategies, trades, analytics calculations, subscriptions, and payment processing remain **static demo fixtures**, clearly labelled as such (`appNav.demoNote`: "Your account and sign-in are real. Trading data shown here is still a fixture preview."). See [docs/roadmap.md](docs/roadmap.md).

### Routes

Every route lives under a locale prefix — `/en/...` or `/th/...` (`en` is the default fallback locale; there is no unprefixed route). See [ADR 0007](docs/decisions/0007-i18n-architecture.md).

| Public                                                                               | Application                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `/en` landing · `/en/pricing` · `/en/demo` dashboard                                 | `/en/app` overview · `/en/app/trades` · `/en/app/strategies` |
| `/en/login` · `/en/register`                                                         | `/en/app/analytics` · `/en/app/settings`                     |
| `/en/verify-email` · `/en/forgot-password` · `/en/reset-password` · `/en/auth-error` |                                                              |

An unauthenticated visitor to any `/en/app/*` route is redirected to `/en/login?callbackUrl=...`; an authenticated visitor to `/en/login` or `/en/register` is redirected to `/en/app`. Swap `/en` for `/th` for the Thai version of any route.

## Requirements

| Tool | Version                                 |
| ---- | --------------------------------------- |
| Node | ≥ 20.9 (developed on 24 — see `.nvmrc`) |
| pnpm | 11.x                                    |

## Getting started

The marketing site and demo pages render with no database configured. **Login, registration, and every `/app/*` route need a real, migrated PostgreSQL database** — they call `getOptionalSession()` unconditionally (session-check-and-redirect), which opens a real connection.

```bash
pnpm install
cp .env.example .env.local   # fill in DATABASE_URL at minimum — see below
pnpm db:up                   # start Postgres in Docker (or point DATABASE_URL at a Neon branch instead)
pnpm db:migrate              # apply migrations — see docs/migration-runbook.md
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm db:down   # stop Postgres, keeping data
pnpm db:reset  # DESTROY all local data and start fresh
```

Google sign-in stays truthfully disabled until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set — see [docs/google-oauth-setup.md](docs/google-oauth-setup.md). No transactional email provider is configured yet — verification/reset links print to the server console in development (`ConsoleEmailAdapter`); see [docs/email-delivery-setup.md](docs/email-delivery-setup.md).

## Scripts

| Script                  | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `pnpm dev`              | Development server                                        |
| `pnpm build`            | Production build                                          |
| `pnpm start`            | Serve the production build                                |
| `pnpm format`           | Rewrite files with Prettier (includes import sorting)     |
| `pnpm format:check`     | Fail if anything is unformatted — used by CI              |
| `pnpm lint`             | ESLint                                                    |
| `pnpm lint:fix`         | ESLint with autofix                                       |
| `pnpm typecheck`        | `tsc --noEmit`                                            |
| `pnpm test`             | Unit tests (Vitest)                                       |
| `pnpm test:watch`       | Unit tests in watch mode                                  |
| `pnpm test:coverage`    | Unit tests with a coverage report                         |
| `pnpm test:e2e`         | End-to-end tests (Playwright, against a production build) |
| `pnpm test:e2e:install` | One-time Playwright browser download                      |
| `pnpm test:money`       | Money primitives only                                     |
| `pnpm test:time`        | Time and timezone primitives only                         |
| `pnpm db:up`            | Start local PostgreSQL (Docker, optional)                 |
| `pnpm db:down`          | Stop it, keeping data                                     |
| `pnpm db:reset`         | **Destroy local data** and start fresh                    |
| `pnpm db:generate`      | Generate a migration from the schema                      |
| `pnpm db:migrate`       | Apply migrations, over the direct connection              |
| `pnpm db:check`         | Fail if the schema and migration history have drifted     |
| `pnpm db:studio`        | Drizzle Studio (local schema/data browser)                |
| `pnpm db:test:prepare`  | Apply migrations to `TEST_DATABASE_URL` (safety-checked)  |
| `pnpm test:integration` | Integration tests against a real, disposable Postgres     |
| `pnpm scan:client`      | Fail if a server secret reached the client bundle         |
| `pnpm check`            | Everything CI runs, in order                              |

Run `pnpm check` before pushing.

## Project layout

```
src/
  app/
    [locale]/
      (public)/ Marketing site: /, /pricing, /login, /register, /demo, /verify-email, ...
      (app)/    Application shell — real server-verified guard (Phase 02)
    api/health/ Liveness endpoint
    api/auth/   Better Auth's Next.js route handler
  i18n/         next-intl routing, navigation, and request config
  proxy.ts      Locale detection + optimistic session-cookie-presence redirect
  components/
    ui/         shadcn primitives + project-authored controls
    shell/      App shell, sidebar, drawer, container, brand
    theme/      Theme provider, header toggle, settings selector
    marketing/  Public-site sections and chrome
    product/    KPI cards, comparison metrics, chart frame
    charts/     Static SVG and interactive Recharts components
    dashboard/  The demo attribution dashboard
    forms/      Visual-only form prototypes
  config/       Environment schemas (split server/client), plan definitions
  hooks/        Shared React hooks
  lib/
    money/      Integer minor units — exact, never floating point
    time/       UTC storage, IANA conversion, DST-correct bucketing
    demo/       Static fixtures for the prototype — NO formulas, ever
    motion.ts   Duration and easing conventions
  server/db/    Drizzle boundary — schema is empty until Phase 03
e2e/            Playwright specs
docs/           Specifications, decisions, and phase plans
```

Planned additions are described in [docs/architecture.md](docs/architecture.md); they do not exist yet.

### Three rules worth knowing before writing code

**Money never touches a float.** Amounts are `bigint` minor units with currency-aware precision, parsed and formatted by string arithmetic. `parseMoney` rejects ambiguous input rather than guessing, and rejects excess decimal places rather than rounding silently. See [ADR 0002](docs/decisions/0002-money-representation.md).

**Timestamps always carry an explicit zone.** `parseInstant` refuses a timestamp without an offset, because `new Date("2026-07-31T10:00:00")` reads it as local time on whatever machine runs it. Day bucketing uses the user's IANA timezone, and is DST-correct. See [ADR 0003](docs/decisions/0003-time-model.md).

**Demo data is fictional, labelled, and contains no formulas.** Everything under `src/lib/demo/` is a literal value. The real metrics arrive with the calculation engine; a formula written there to make a chart move would be a second, untested implementation of the product's defining logic. Every surface that renders a fixture carries a visible marker — enforced by tests, because an unlabelled screenshot of a rising equity curve reads as a performance claim. See [ADR 0006](docs/decisions/0006-design-system-and-demo-data.md).

**Every route is locale-prefixed, and internal links use the locale-aware `Link`.** `/en/...` or `/th/...` — never a bare route. Internal navigation imports `Link`/`usePathname`/`useRouter` from `@/i18n/navigation`, never `next/link` or `next/navigation` directly, or the locale prefix silently drops. See [ADR 0007](docs/decisions/0007-i18n-architecture.md).

## Documentation

| Document                                                       | What it covers                                    |
| -------------------------------------------------------------- | ------------------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                                         | Engineering constitution — read first             |
| [docs/product-spec.md](docs/product-spec.md)                   | What the product does and why                     |
| [docs/architecture.md](docs/architecture.md)                   | Structure, boundaries, data flow                  |
| [docs/data-dictionary.md](docs/data-dictionary.md)             | Schema and field meanings                         |
| [docs/calculation-spec.md](docs/calculation-spec.md)           | Every financial formula, with edge cases          |
| [docs/design-system.md](docs/design-system.md)                 | Tokens, typography, motion, charts, a11y          |
| [docs/localization-glossary.md](docs/localization-glossary.md) | Thai/English terminology and formatting standard  |
| [docs/ui-review-checklist.md](docs/ui-review-checklist.md)     | What to check before a UI ships                   |
| [docs/migration-runbook.md](docs/migration-runbook.md)         | Database migration commands, per environment      |
| [docs/neon-setup.md](docs/neon-setup.md)                       | Manual Neon project/branch setup                  |
| [docs/google-oauth-setup.md](docs/google-oauth-setup.md)       | Manual Google OAuth client setup                  |
| [docs/email-delivery-setup.md](docs/email-delivery-setup.md)   | Email adapter boundary and what is/isn't verified |
| [docs/roadmap.md](docs/roadmap.md)                             | Phase sequence and status                         |
| [docs/decisions/](docs/decisions/)                             | Architecture decision records                     |
| [docs/phases/](docs/phases/)                                   | Detailed per-phase scope                          |

## Environment

Copy `.env.example` to `.env.local`. **`.env.example` contains variable names only — never commit a real value.** Every variable is still optional; each becomes required as the phase that consumes it lands, so an unconfigured integration never breaks a build.

Validation is split so secrets cannot leak into the browser:

| Module          | Contents                    | Enforcement                                                                  |
| --------------- | --------------------------- | ---------------------------------------------------------------------------- |
| `env.schema.ts` | Pure Zod schemas            | Unit-tested, no side effects                                                 |
| `env.server.ts` | Secrets, connection strings | Imports `server-only` — **the build fails** if a client component imports it |
| `env.client.ts` | `NEXT_PUBLIC_*` only        | Referenced literally so Next.js can inline them                              |

| Environment    | Database                                  | Secrets                                       |
| -------------- | ----------------------------------------- | --------------------------------------------- |
| **Local**      | Docker Postgres or a personal Neon branch | `.env.local`, never committed                 |
| **Preview**    | A non-production database, always         | Hosting platform store                        |
| **Production** | Neon production                           | Hosting platform store, rotated independently |

The app talks to PostgreSQL through a standard `DATABASE_URL` (local Postgres in development, Neon in deployment) so it stays portable to a plain VPS. `DATABASE_MIGRATION_URL` is used only for migrations — see [ADR 0004](docs/decisions/0004-database-access.md) and [docs/migration-runbook.md](docs/migration-runbook.md).

## Testing

- **Unit** — Vitest + React Testing Library, in `src/**/*.test.{ts,tsx}`.
- **E2E** — Playwright, in `e2e/`, run against a real production build rather than the dev server. Covers both locales in desktop and mobile projects, and asserts horizontal-overflow at five viewports, theming, reduced-motion branches, touch targets, focus management, localized metadata, and that nothing claims a capability the product lacks.
- **Supply-chain canaries** — `pnpm build` must succeed with no `DATABASE_URL` set, and `pnpm scan:client` fails if a server-only variable name or a secret-shaped value reaches the client bundle. Both run in CI.

Run `pnpm test:e2e:install` once before the first e2e run.

## License

Private and unlicensed.
