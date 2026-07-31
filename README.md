# Trading OS

A multi-tenant trading journal that separates **system performance** from **trader execution**.

Most journals tell you your P&L. This one tells you where it came from:

> Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?

---

## Status

**Phase 00b — Core primitives.** Toolchain, money and time primitives, theming, application shell, and the database boundary. There is deliberately no authentication, no database schema, and no trading functionality yet. See [docs/roadmap.md](docs/roadmap.md).

## Requirements

| Tool | Version                                 |
| ---- | --------------------------------------- |
| Node | ≥ 20.9 (developed on 24 — see `.nvmrc`) |
| pnpm | 11.x                                    |

## Getting started

```bash
pnpm install
cp .env.example .env.local   # every variable is still optional
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

A local PostgreSQL is **optional** and nothing uses it yet:

```bash
pnpm db:up     # start Postgres in Docker
pnpm db:down   # stop it, keeping data
pnpm db:reset  # DESTROY all local data and start fresh
```

Prefer a Neon branch? Point `DATABASE_URL` at it and skip Docker entirely.

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
| `pnpm check`            | Everything CI runs, in order                              |

Run `pnpm check` before pushing.

## Project layout

```
src/
  app/
    (public)/   Unauthenticated routes
    (app)/      Authenticated shell — no guard yet, Phase 02 adds it
    api/health/ Liveness endpoint
  components/
    ui/         Vendored shadcn primitives — project-owned code
    shell/      Header, sidebar, drawer, container
    theme/      Theme provider and selector
  config/       Environment schemas, split server/client
  hooks/        Shared React hooks
  lib/
    money/      Integer minor units — exact, never floating point
    time/       UTC storage, IANA conversion, DST-correct bucketing
    motion.ts   Duration and easing conventions
  server/db/    Drizzle boundary — schema is empty until Phase 01
e2e/            Playwright specs
docs/           Specifications, decisions, and phase plans
```

Planned additions are described in [docs/architecture.md](docs/architecture.md); they do not exist yet.

### Two rules worth knowing before writing code

**Money never touches a float.** Amounts are `bigint` minor units with currency-aware precision, parsed and formatted by string arithmetic. `parseMoney` rejects ambiguous input rather than guessing, and rejects excess decimal places rather than rounding silently. See [ADR 0002](docs/decisions/0002-money-representation.md).

**Timestamps always carry an explicit zone.** `parseInstant` refuses a timestamp without an offset, because `new Date("2026-07-31T10:00:00")` reads it as local time on whatever machine runs it. Day bucketing uses the user's IANA timezone, and is DST-correct. See [ADR 0003](docs/decisions/0003-time-model.md).

## Documentation

| Document                                             | What it covers                            |
| ---------------------------------------------------- | ----------------------------------------- |
| [CLAUDE.md](CLAUDE.md)                               | Engineering constitution — read first     |
| [docs/product-spec.md](docs/product-spec.md)         | What the product does and why             |
| [docs/architecture.md](docs/architecture.md)         | Structure, boundaries, data flow          |
| [docs/data-dictionary.md](docs/data-dictionary.md)   | Planned schema and field meanings         |
| [docs/calculation-spec.md](docs/calculation-spec.md) | Every financial formula, with edge cases  |
| [docs/design-system.md](docs/design-system.md)       | Tokens, theming, motion, responsive rules |
| [docs/roadmap.md](docs/roadmap.md)                   | Phase sequence and status                 |
| [docs/decisions/](docs/decisions/)                   | Architecture decision records             |
| [docs/phases/](docs/phases/)                         | Detailed per-phase scope                  |

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

The app talks to PostgreSQL through a standard `DATABASE_URL` (local Postgres in development, Neon in deployment) so it stays portable to a plain VPS. `DATABASE_URL_UNPOOLED` is used only for migrations — see [ADR 0004](docs/decisions/0004-database-access.md).

## Testing

- **Unit** — Vitest + React Testing Library, in `src/**/*.test.{ts,tsx}`.
- **E2E** — Playwright, in `e2e/`, run against a real production build rather than the dev server. Covers a desktop and a mobile viewport, including horizontal-overflow, theming, and reduced-motion checks.

Run `pnpm test:e2e:install` once before the first e2e run.

## License

Private and unlicensed.
