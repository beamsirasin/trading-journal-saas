# Trading OS

A multi-tenant trading journal that separates **system performance** from **trader execution**.

Most journals tell you your P&L. This one tells you where it came from:

> Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?

---

## Status

**Phase 00 — Foundation.** The toolchain, conventions, and a placeholder home page. There is deliberately no authentication, no database schema, and no trading functionality yet. See [docs/roadmap.md](docs/roadmap.md).

## Requirements

| Tool | Version                                 |
| ---- | --------------------------------------- |
| Node | ≥ 20.9 (developed on 24 — see `.nvmrc`) |
| pnpm | 11.x                                    |

## Getting started

```bash
pnpm install
cp .env.example .env.local   # every variable is optional in Phase 00
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

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
| `pnpm check`            | Everything CI runs, in order                              |

Run `pnpm check` before pushing.

## Project layout

```
src/
  app/          Routes only — thin, no business logic
  components/   Presentational and composed UI
  config/       Environment schema; later: plans, mistake taxonomy
  lib/          Framework-agnostic helpers; later: the calculation engine
e2e/            Playwright specs
docs/           Specifications, decisions, and phase plans
```

Planned additions are described in [docs/architecture.md](docs/architecture.md); they do not exist yet.

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

Copy `.env.example` to `.env.local`. **`.env.example` contains variable names only — never commit a real value.** Every variable is optional during Phase 00; each becomes required as the phase that consumes it lands.

The app talks to PostgreSQL through a standard `DATABASE_URL` (local Postgres in development, Neon in deployment) so it stays portable to a plain VPS.

## Testing

- **Unit** — Vitest + React Testing Library, in `src/**/*.test.{ts,tsx}`.
- **E2E** — Playwright, in `e2e/`, run against a real production build rather than the dev server. Covers a desktop and a mobile viewport, including horizontal-overflow, theming, and reduced-motion checks.

Run `pnpm test:e2e:install` once before the first e2e run.

## License

Private and unlicensed.
