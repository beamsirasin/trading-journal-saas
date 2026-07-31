# Roadmap

Thirteen phases to MVP. Each is dependency-ordered, independently reviewable, and ends in one coherent commit. Detailed scope for each lives in [phases/](phases/).

## Status

| #                                            | Phase                            | Status          | Ships                                                       |
| -------------------------------------------- | -------------------------------- | --------------- | ----------------------------------------------------------- |
| [00](phases/PHASE-00-foundation.md)          | Foundation & Conventions         | ✅ **Complete** | Toolchain, CI, design tokens, placeholder page              |
| 00b                                          | Data & UI Foundations            | ⬜ Not started  | Drizzle wiring, money/time primitives, shadcn/ui, app shell |
| [01](phases/PHASE-01-tenancy.md)             | Data Model & Tenancy Core        | ⬜ Not started  | Workspaces, membership, scoped queries                      |
| [02](phases/PHASE-02-auth.md)                | Authentication & Session         | ⬜ Not started  | Google + email auth, session → workspace                    |
| [03](phases/PHASE-03-billing.md)             | Plans, Trial & Entitlements      | ⬜ Not started  | Three plans, 7-day trial, mock payment                      |
| [04](phases/PHASE-04-onboarding-accounts.md) | Onboarding & Trading Accounts    | ⬜ Not started  | Wizard, account CRUD, limit enforcement                     |
| [05](phases/PHASE-05-strategies.md)          | Strategies & Versions            | ⬜ Not started  | Strategy CRUD, immutable versioning                         |
| [06](phases/PHASE-06-calc-engine.md)         | Trade Model & Calculation Engine | ⬜ Not started  | Schema plus the pure R-multiple engine                      |
| [07](phases/PHASE-07-journal.md)             | Trade Journal                    | ⬜ Not started  | Manual entry, system vs actual, mistakes                    |
| [08](phases/PHASE-08-analytics.md)           | Dashboard & Analytics            | ⬜ Not started  | Attribution dashboard, charts                               |
| [09](phases/PHASE-09-settings.md)            | Settings                         | ⬜ Not started  | Profile, workspace, subscription, export                    |
| [10](phases/PHASE-10-admin.md)               | SaaS Administration              | ⬜ Not started  | Admin role, oversight, audit log                            |
| [11](phases/PHASE-11-landing.md)             | Landing & Marketing              | ⬜ Not started  | Public site, pricing page                                   |
| [12](phases/PHASE-12-hardening.md)           | Hardening & Launch               | ⬜ Not started  | Security, a11y, performance, deploy                         |

## What Phase 00 delivered

Next.js 16.2.12 · TypeScript strict with extras · Tailwind 4 with semantic tokens and dark/light theming · ESLint + Prettier with import ordering · Vitest + React Testing Library · Playwright across desktop and mobile viewports · GitHub Actions CI · documentation structure · a placeholder home page.

No authentication, no database tables, no trading functionality — deliberately.

## Phase 00b — why it exists

The original Phase 00 plan also included Drizzle wiring, money/time primitives, shadcn/ui, and the application shell. The Phase 00 brief scoped those out, so they were split into **00b** rather than dropped:

- Drizzle client and `drizzle.config.ts`, configured so `numeric` returns strings
- `docker-compose.yml` for local Postgres
- `src/lib/money/` — minor-unit `bigint` helpers, currency scale lookup
- `src/lib/time/` — UTC storage, timezone-aware day bucketing
- shadcn/ui initialised against the project theme
- Motion primitives, and the sidebar/topbar application shell

Money and time primitives are load-bearing for every later calculation, so they should land before Phase 01 schema work rather than being improvised inside it.

## Sequencing rationale

**Tenancy before auth (01 → 02).** The scoping primitive is the security boundary. Building it first, with its own isolation tests, means auth plugs into a guard that already provably works instead of scope being retrofitted onto existing queries.

**Calculation engine before journal UI (06 → 07).** The engine is pure and fully testable with no UI. Building forms first would bake formula assumptions into them and force rework.

**Billing before the features it gates (03 → 04).** Entitlement checks are server-side authorization, not UI decoration. Retrofitting them after the resources exist reliably leaves gaps.

**Landing page late (11).** It depends on final pricing and real product screenshots, and blocks nothing.

## Out of scope for the MVP

Broker API integration · MT4/MT5 sync · CSV import · OCR · TradingView API · real payment processing · AI API integration · native mobile apps.
