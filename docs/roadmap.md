# Roadmap

The MVP roadmap is dependency-ordered and independently reviewable. A phase may land in named reviewable slices, as Phase 3A–3C did. Detailed scope for each lives in [phases/](phases/).

## Status

| #                                                | Phase                                                      | Status                                                          | Ships                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [00](phases/PHASE-00-foundation.md)              | Foundation & Conventions                                   | ✅ **Complete**                                                 | Toolchain, CI, design tokens, placeholder page                                                   |
| [00b](phases/PHASE-00b-core-primitives.md)       | Core Technical Primitives                                  | ✅ **Complete**                                                 | Money, time, theme, shell, Drizzle boundary, health                                              |
| [01](phases/PHASE-01-design-system.md)           | Design System, Marketing & Shell                           | ✅ **Complete**                                                 | Tokens, landing site, demo dashboard, app shell                                                  |
| [01.1](phases/PHASE-01-1-simplification-i18n.md) | UI Simplification & Thai/English Localization              | ✅ **Complete**                                                 | Simplified dashboard/landing, next-intl, `/en` and `/th`                                         |
| [02](phases/PHASE-02-auth-tenancy.md)            | Auth, Neon Postgres & Tenant-Isolated Workspace Foundation | ✅ **Complete**                                                 | Better Auth (Google + email/password), database-backed sessions, one personal workspace per user |
| 03A–03C                                          | Onboarding, Trading Accounts & Entitlement Foundation      | ✅ **Complete**                                                 | Onboarding, account CRUD/switcher, 7-day trial, server-side 1/5/15 active-account limits         |
| [04](phases/PHASE-04-billing.md)                 | Billing & Checkout                                         | ▶ **Next implementation phase**                                 | Monthly plans, checkout, billing snapshots, future-ready VAT behavior, mock payment              |
| [05](phases/PHASE-05-onboarding-accounts.md)     | Onboarding & Trading Accounts                              | ⬜ Planned review/integration; core scope delivered in Phase 03 | Preserve and extend the shipped onboarding/account flows                                         |
| [06](phases/PHASE-06-strategies.md)              | Strategies & Versions                                      | ⬜ Not started                                                  | Strategy CRUD, immutable versioning                                                              |
| [07](phases/PHASE-07-calc-engine.md)             | Trade Model & Calculation Engine                           | ⬜ Not started                                                  | Schema plus the pure R-multiple engine                                                           |
| [08](phases/PHASE-08-journal.md)                 | Trade Journal                                              | ⬜ Not started                                                  | Manual entry, system vs actual, mistakes                                                         |
| [09](phases/PHASE-09-analytics.md)               | Dashboard & Analytics                                      | ⬜ Not started                                                  | Real attribution data behind the Phase 01 surfaces                                               |
| [10](phases/PHASE-10-settings.md)                | Settings                                                   | ⬜ Not started                                                  | Profile, workspace, subscription, export                                                         |
| [11](phases/PHASE-11-admin.md)                   | SaaS Administration                                        | ⬜ Not started                                                  | Admin role, oversight, audit log                                                                 |
| [12](phases/PHASE-12-hardening.md)               | Hardening & Launch                                         | ⬜ Not started                                                  | Security, a11y, performance, deploy                                                              |

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

## What Phase 01.1 delivered

The dashboard and landing page reduced to what a first glance needs, and the entire product made legible in Thai as well as English.

- Dashboard: eight KPI cards and four comparison rows reduced to four KPI cards, a three-row system-vs-trader module, one chart, and the top three mistakes by cost. The moved metrics live on `/app/analytics`, not gone.
- Landing page: product preview, attribution section and feature list each reduced to their single strongest version — see [PHASE-01-1-simplification-i18n.md](phases/PHASE-01-1-simplification-i18n.md) for the full list.
- `next-intl`-based localization: `/en` and `/th`, `localePrefix: 'always'`, cookie-based detection precedence, a text-only `LanguageSwitcher` in every shell, `Noto Sans Thai` typography, and a full [localization glossary](../localization-glossary.md) governing terminology.
- 365 matching message keys across both locales, parity enforced by a dedicated unit test.

No authentication, no database, no product mutations — unchanged from Phase 01. Full detail: [PHASE-01-1-simplification-i18n.md](phases/PHASE-01-1-simplification-i18n.md), [ADR 0007](decisions/0007-i18n-architecture.md).

## What Phase 02 delivered

Real users, a real database, and a real tenant boundary — while every trading-product surface stays exactly the fixture-driven preview Phase 01/01.1 shipped, clearly labelled as such.

- **Authentication:** self-hosted Better Auth — Google OAuth (truthfully disabled when unconfigured) and email/password (real hashing, email verification required, database-backed rate limiting). See [ADR 0009](decisions/0009-self-hosted-better-auth.md).
- **Database:** Neon-compatible PostgreSQL via Drizzle, committed migrations (`drizzle/0000_init_auth_tenancy.sql`), pooled/direct connection split (`DATABASE_URL`/`DATABASE_MIGRATION_URL`). See [ADR 0012](decisions/0012-migration-strategy.md).
- **Tenancy:** exactly one personal workspace per user, database-enforced (partial unique index), provisioned idempotently and safe under concurrency. `requireWorkspaceMembership`/`requireWorkspaceRole` ready for team workspaces without a schema change. See [ADR 0011](decisions/0011-tenant-workspace-authorization-model.md).
- **Authorization boundary:** `src/server/auth/dal.ts`, re-verified against the database on every call — `src/proxy.ts`'s cookie-presence check is optimistic only, never the real boundary. See [ADR 0010](decisions/0010-database-backed-sessions.md).
- **Tests:** a real-Postgres integration suite (authorization matrix, provisioning idempotency/concurrency) and two new e2e specs (route protection, session forgery/revocation, cross-user isolation) — both wired into CI against a fresh `postgres:17-alpine` service container on every push.

Full detail, assumptions, and known limitations: [PHASE-02-auth-tenancy.md](phases/PHASE-02-auth-tenancy.md).

## What Phase 03 delivered

Phase 03 is officially complete and merged to `main` as three implementation slices:

- **3A:** workspace-scoped onboarding and the first trading account
- **3B:** full trading-account management and the active-account switcher
- **3C:** the 7-day, one-active-account, full-feature trial; the final Starter/Trader/Professional registry; and transactionally server-enforced create/restore limits where archived accounts do not count

The original roadmap's separate “Phase 03 — Data Model & Tenancy Core” was already absorbed into Phase 02. The completed Phase 3A–3C implementation reused the number for the next delivered product increment; the preserved [original Phase 03 document](phases/PHASE-03-tenancy.md) remains historical only.

Phase 04 is next. It owns customer billing, checkout, immutable billing snapshots, and conditional VAT behavior while reusing Phase 3C's entitlement foundation.

## Sequencing rationale

**Design system early (01).** A token set that nothing consumes cannot be reviewed. Building the marketing site and the application shell against it exercises every token, every state, and every breakpoint before any of it is load-bearing for real data — and it is far cheaper to change a token now than after eight phases depend on it.

**Auth and tenancy together (02).** The originally-planned split — auth in 02, tenancy in 03 — was superseded by this phase's actual commissioning brief, which combined them: a workspace has to exist the moment a user does, so provisioning one is naturally part of authentication's own transaction (`ensurePersonalWorkspace`, wired to Better Auth's user-creation hook), not a separately-sequenced concern. The original rationale for ordering tenancy before any business table still holds and is unaffected: **no tenant-scoped product records exist before Phase 05**, and Phase 02 writes no product query. See [ADR 0011](decisions/0011-tenant-workspace-authorization-model.md).

**Calculation engine before journal UI (07 → 08).** The engine is pure and fully testable with no UI. Building forms first would bake formula assumptions into them and force rework.

**Entitlements before billing expansion (03C → 04).** Active-account creation and restoration limits already execute server-side inside their mutation transactions. Phase 04 adds customer billing and checkout without weakening that authorization boundary or inventing plan-specific feature gates.

**Analytics (09) now replaces data rather than building screens.** Phase 01 already shipped the analytics surfaces against fixtures, so Phase 09 swaps the fixture source for the engine's output and adds what only real data can justify.

## Superseded

**Phase 11 — Landing & Marketing** was folded into Phase 01 and its document removed. It was originally scheduled last because it depends on final pricing and real screenshots. At that time it shipped with prices shown as "to be confirmed" rather than invented, and with a live composition of demo fixtures rather than a screenshot. Phase 3C later replaced that provisional pricing state with the final monthly plan decision.

**The original Phase 03 — Data Model & Tenancy Core plan** was folded into Phase 02; its document is preserved as the historical record of the original two-phase split. It is not the later Phase 3A–3C implementation that is now officially complete. See [ADR 0009](decisions/0009-self-hosted-better-auth.md) for why Better Auth replaced the originally planned Auth.js.

## Out of scope for the MVP

Broker API integration · MT4/MT5 sync · CSV import · OCR · TradingView API · real payment processing · AI API integration · native mobile apps.
