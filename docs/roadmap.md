# Roadmap

Fourteen phases to MVP. Each is dependency-ordered, independently reviewable, and ends in one coherent commit. Detailed scope for each lives in [phases/](phases/).

## Status

| #                                            | Phase                            | Status          | Ships                                               |
| -------------------------------------------- | -------------------------------- | --------------- | --------------------------------------------------- |
| [00](phases/PHASE-00-foundation.md)          | Foundation & Conventions         | ✅ **Complete** | Toolchain, CI, design tokens, placeholder page      |
| [00b](phases/PHASE-00b-core-primitives.md)   | Core Technical Primitives        | ✅ **Complete** | Money, time, theme, shell, Drizzle boundary, health |
| [01](phases/PHASE-01-design-system.md)       | Design System, Marketing & Shell | ✅ **Complete** | Tokens, landing site, demo dashboard, app shell     |
| [02](phases/PHASE-02-auth.md)                | Authentication & Session         | ⬜ Not started  | Google + email auth, sessions                       |
| [03](phases/PHASE-03-tenancy.md)             | Data Model & Tenancy Core        | ⬜ Not started  | Workspaces, membership, scoped queries              |
| [04](phases/PHASE-04-billing.md)             | Plans, Trial & Entitlements      | ⬜ Not started  | Three plans, 7-day trial, mock payment              |
| [05](phases/PHASE-05-onboarding-accounts.md) | Onboarding & Trading Accounts    | ⬜ Not started  | Wizard, account CRUD, limit enforcement             |
| [06](phases/PHASE-06-strategies.md)          | Strategies & Versions            | ⬜ Not started  | Strategy CRUD, immutable versioning                 |
| [07](phases/PHASE-07-calc-engine.md)         | Trade Model & Calculation Engine | ⬜ Not started  | Schema plus the pure R-multiple engine              |
| [08](phases/PHASE-08-journal.md)             | Trade Journal                    | ⬜ Not started  | Manual entry, system vs actual, mistakes            |
| [09](phases/PHASE-09-analytics.md)           | Dashboard & Analytics            | ⬜ Not started  | Real attribution data behind the Phase 01 surfaces  |
| [10](phases/PHASE-10-settings.md)            | Settings                         | ⬜ Not started  | Profile, workspace, subscription, export            |
| [11](phases/PHASE-11-admin.md)               | SaaS Administration              | ⬜ Not started  | Admin role, oversight, audit log                    |
| [12](phases/PHASE-12-hardening.md)           | Hardening & Launch               | ⬜ Not started  | Security, a11y, performance, deploy                 |

## What Phase 00 delivered

Next.js 16.2.12 · TypeScript strict with extras · Tailwind 4 with semantic tokens and dark/light theming · ESLint + Prettier with import ordering · Vitest + React Testing Library · Playwright across desktop and mobile viewports · GitHub Actions CI · documentation structure · a placeholder home page.

No authentication, no database tables, no trading functionality — deliberately.

## What Phase 00b delivered

The technical foundations Phase 00's brief scoped out. Money and time primitives are load-bearing for every later calculation, so they landed before schema work rather than being improvised inside it.

- `src/lib/money/` — integer minor units in `bigint`, currency-aware precision, strict parsing, 108 tests
- `src/lib/time/` — UTC storage, IANA conversion, DST-correct day bucketing, 81 tests
- Environment split into pure schemas, a `server-only` server module, and a client module
- Theme precedence: saved choice → OS preference → dark fallback, with no flash
- Application shell: route groups, landmarks, skip link, responsive drawer, loading and error boundaries
- Drizzle boundary and optional local PostgreSQL — no product schema
- `/api/health` liveness endpoint

## What Phase 01 delivered

The product's first complete visual form, on static fixtures only.

- Semantic tokens extended with `surface`, `info`, a **validated** four-slot chart palette, and `system` / `trader` series aliases
- A typography scale, spacing conventions, and shell geometry as tokens
- Marketing site: `/`, `/pricing`, `/login`, `/register`, `/demo`
- A demo attribution dashboard rendered from one component on both `/demo` and `/app`
- Application shell with five real sections and working theme selection
- 267 unit tests, 186 e2e tests across desktop and mobile

No authentication, no database, no product mutations. Full detail: [PHASE-01-design-system.md](phases/PHASE-01-design-system.md).

## Sequencing rationale

**Design system early (01).** A token set that nothing consumes cannot be reviewed. Building the marketing site and the application shell against it exercises every token, every state, and every breakpoint before any of it is load-bearing for real data — and it is far cheaper to change a token now than after eight phases depend on it.

**Auth before tenancy (02 → 03).** This reverses the Phase 00b order, and the reversal is only safe because of a specific fact: **no tenant-scoped records exist before Phase 05**. The original rationale — that scope retrofitted onto existing queries reliably leaves gaps — still holds, so the obligation transfers rather than disappearing. Phase 03 must ship cross-workspace isolation tests before any business table lands, and Phase 02 may not write a product query. See [ADR 0006](decisions/0006-design-system-and-demo-data.md).

**Calculation engine before journal UI (07 → 08).** The engine is pure and fully testable with no UI. Building forms first would bake formula assumptions into them and force rework.

**Billing before the features it gates (04 → 05).** Entitlement checks are server-side authorization, not UI decoration. Retrofitting them after the resources exist reliably leaves gaps.

**Analytics (09) now replaces data rather than building screens.** Phase 01 already shipped the analytics surfaces against fixtures, so Phase 09 swaps the fixture source for the engine's output and adds what only real data can justify.

## Superseded

**Phase 11 — Landing & Marketing** was folded into Phase 01 and its document removed. It was originally scheduled last because it depends on final pricing and real screenshots. It shipped early without either: prices are shown as "to be confirmed" rather than invented, and the product preview is a live composition of demo fixtures rather than a screenshot.

## Out of scope for the MVP

Broker API integration · MT4/MT5 sync · CSV import · OCR · TradingView API · real payment processing · AI API integration · native mobile apps.
