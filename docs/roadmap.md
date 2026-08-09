# Roadmap

The MVP roadmap is dependency-ordered and independently reviewable. A phase may land in named reviewable slices, as Phase 3A–3C did. Detailed scope for each lives in [phases/](phases/).

## Status

| #                                                | Phase                                                      | Status                             | Ships                                                                                                                                                                                    |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00](phases/PHASE-00-foundation.md)              | Foundation & Conventions                                   | ✅ **Complete**                    | Toolchain, CI, design tokens, placeholder page                                                                                                                                           |
| [00b](phases/PHASE-00b-core-primitives.md)       | Core Technical Primitives                                  | ✅ **Complete**                    | Money, time, theme, shell, Drizzle boundary, health                                                                                                                                      |
| [01](phases/PHASE-01-design-system.md)           | Design System, Marketing & Shell                           | ✅ **Complete**                    | Tokens, landing site, demo dashboard, app shell                                                                                                                                          |
| [01.1](phases/PHASE-01-1-simplification-i18n.md) | UI Simplification & Thai/English Localization              | ✅ **Complete**                    | Simplified dashboard/landing, next-intl, `/en` and `/th`                                                                                                                                 |
| [02](phases/PHASE-02-auth-tenancy.md)            | Auth, Neon Postgres & Tenant-Isolated Workspace Foundation | ✅ **Complete**                    | Better Auth (Google + email/password), database-backed sessions, one personal workspace per user                                                                                         |
| 03A–03C                                          | Onboarding, Trading Accounts & Entitlement Foundation      | ✅ **Complete**                    | Onboarding, account CRUD/switcher, 7-day trial, server-side 1/5/15 active-account limits                                                                                                 |
| [04](phases/PHASE-04-billing.md)                 | Billing & Checkout                                         | ✅ **Complete**                    | Monthly plans, checkout, billing snapshots, conditional VAT behavior, mock payment, production payment-provider guard (04H-A)                                                            |
| [05](phases/PHASE-05-onboarding-accounts.md)     | Onboarding & Trading Accounts                              | ✅ **Complete**                    | Reviewed and polished the onboarding/account core delivered early in Phase 03: archived-account UX parity, archive-not-delete clarity, restore-limit guidance, account-state terminology |
| [06](phases/PHASE-06-strategies.md)              | Strategies & Versions                                      | ✅ **Complete**                    | Workspace-owned Strategies, nested Setups, five-table versioned domain, structured Rules, immutable locked Versions with copy-on-write, archive-only lifecycle, real management UI       |
| [07](phases/PHASE-07-calc-engine.md)             | Trade Model & Calculation Engine                           | ✅ **Complete**                    | Trade schema plus pure per-Trade and aggregate/attribution/equity engines                                                                                                                |
| [08](phases/PHASE-08-journal.md)                 | Trade Journal                                              | ✅ **Complete**                    | Real creation/list/detail, lifecycles, corrections, Rules/Mistakes, soft deletion                                                                                                        |
| [09](phases/PHASE-09-analytics.md)               | Dashboard & Analytics                                      | ✅ **Complete**                    | Real attribution data behind the authenticated Dashboard and deep Analytics surfaces                                                                                                     |
| [10](phases/PHASE-10-settings.md)                | Settings                                                   | 🚧 **In progress — 10C delivered** | Real Profile, Preferences, Workspace rename, and canonical Account/Plan/Billing integration delivered; Export and Security remain                                                        |
| [11](phases/PHASE-11-admin.md)                   | SaaS Administration                                        | ⬜ Not started                     | Admin role, oversight, audit log                                                                                                                                                         |
| [12](phases/PHASE-12-hardening.md)               | Hardening & Launch                                         | ⬜ Not started                     | Security, a11y, performance, deploy                                                                                                                                                      |

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

Phase 04 built on this entitlement foundation next; see below for what it delivered.

## What Phase 04 delivered

Phase 04 is officially complete and merged to `main`, including the 04H-A production payment-provider hardening pass. Full contract: [PHASE-04-billing.md](phases/PHASE-04-billing.md).

- **Static plan catalogue** — `src/config/plan-catalog.ts` (Starter/Trader/Professional, active-account limits, shared feature keys) and `src/lib/billing/price-book.ts` (the one canonical `bigint`-minor-unit price book for THB/USD, independent per currency, no cross-currency conversion).
- **Workspace entitlement source of truth** — `workspace_entitlements` (extended, not replaced, by migrations `0005`/`0006`), resolved through `src/lib/entitlements/resolve.ts`'s pure `resolveEffectiveEntitlement`, which computes the exact trial/paid lifecycle boundaries and one of three access modes (`writable`, `over_limit`, `read_only`) with no cron dependency — expiry and boundary crossings are evaluated on read from stored timestamps.
- **Subscription lifecycle** — `src/server/services/subscription-lifecycle.ts`: activation, immediate upgrade, downgrade scheduled for period end, cancellation scheduled for period end, past-due, recovery, and expiry, each independently tested and rejecting invalid transitions. Customer-facing scheduling/reversal actions live in `src/server/actions/subscription-management.ts`.
- **Checkout** — `src/server/services/checkout.ts`, in three stages: preparation (locks the workspace and entitlement row, validates the request, produces a trusted quote, inserts the immutable snapshot), provider call (`src/server/payments/payment-provider.ts`'s narrow interface), and finalization (validates the provider result, transitions the entitlement, updates the snapshot's mutable fields only). Workspace-scoped idempotency (`billing_transactions`'s unique `(workspace_id, idempotency_key)` index) and provider-side idempotency (a deterministic key derived from the billing transaction id) both apply. Reconciliation (`reconcileCheckout`) re-reads and re-validates rather than trusting client-reported status, and is itself idempotent.
- **Immutable billing snapshots** — `billing_transactions` (migration `0006_create_billing_transaction_snapshots.sql`), with a PostgreSQL `BEFORE UPDATE` trigger that rejects any change to identity, plan, currency, price, or tax fields; only status, provider references, and lifecycle timestamps may update afterward.
- **Billing history** — `src/server/billing/billing-history.ts` reads exclusively from stored snapshots; it never recomputes a historical amount from current plan or VAT configuration.
- **Conditional VAT** — `src/lib/billing/vat.ts` (integer minor-unit exclusive VAT, deterministic round-half-up) and `src/config/billing.server.ts` (the one trusted, server-only VAT configuration source: disabled at launch, prepared at 700 basis points). No VAT notice or line renders while disabled; the client never supplies a rate, amount, or total.
- **Production payment-provider capability guard (04H-A)** — `src/config/billing-capability.ts`/`billing-capability.server.ts`: the mock provider is reachable only in `development`/`test` `NODE_ENV`, or in production behind a guarded, CI-only automated-test seam (`E2E_TEST_MODE=true` + loopback `BETTER_AUTH_URL` + a trusted provisioned e2e identity). Ordinary production checkout/reconciliation return a typed `payment_provider_unavailable` result before any database write; public pricing, plan reads, billing history, downgrade, and cancellation stay available throughout.

No real payment gateway exists. A real provider must be implemented, behind the same `PaymentProvider` interface, before public paid activation can launch — see [docs/deployment-checklist.md](deployment-checklist.md).

## What Phase 05 delivered

Phase 05 is officially complete. Its core scope — onboarding and trading-account management — was delivered early, in Phase 3A–3C; Phase 05 reviewed and polished that shipped implementation rather than building it, across four slices. Full contract: [PHASE-05-onboarding-accounts.md](phases/PHASE-05-onboarding-accounts.md).

- **05A — Audit.** Confirmed the shipped Phase 3A–3C/04 implementation against Phase 05's original (pre-implementation) brief and CLAUDE.md.
- **05B — Documentation reconciliation.** Rewrote `PHASE-05-onboarding-accounts.md` and `docs/data-dictionary.md` to match what actually shipped, replacing the originally-planned (never-built) schema and wizard description they once carried.
- **05C — Archived-account UX and account-management polish.** Archived-account cards reached full field parity with active-account cards; archive-confirmation copy now states unambiguously that archiving is reversible and preserves data, with no delete action, no `deleted_at` column, and none planned; the restore-blocked-by-limit explanation gained usage/limit detail and a safety reassurance; the per-card "Active" badge was renamed to "Current account" / "บัญชีที่กำลังใช้งาน" to stop it colliding with "active = non-archived, counts toward the plan"; and the Edit action is now disabled (with an accessible reason) in the `read_only`/`over_limit` access modes it was already server-rejected in, while Archive correctly stays available under `over_limit` as the remediation path.
- **05D — Full regression and closeout.** The complete unit/component suite, the complete real-PostgreSQL integration suite, and one complete production-build E2E suite all passed against a guarded disposable database, and a stale-reference scan across docs and code found no active defects.

No schema, entitlement rule, or account-lifecycle change was made in any Phase 05 slice.

## What Phase 06 delivered

Phase 06 is officially complete and merged to `main`, across six slices (06A audit, 06B schema, 06C services, 06D DAL/actions, 06E UI, 06F regression and closeout). Full contract: [PHASE-06-strategies.md](phases/PHASE-06-strategies.md).

- **The approved product model** — a Strategy is a workspace-owned trading system, reusable across trading accounts (not a symbol, timeframe, or individual trade); a Setup is a repeatable entry pattern that cannot exist without a Strategy. Every plan has unlimited Strategies and Setups — no quota exists anywhere in the schema or authorization path.
- **Five-table versioned domain** (migration `0007_strategies_and_setups.sql`) — `strategies`/`setups` are pure identity rows; all display content lives on `strategy_versions`/`strategy_setup_versions`. `strategy_rules` carries structured, categorized Rules (`entry`/`invalidation`/`risk`/`management`/`exit`, `is_pre_trade_check` independent of category) with a stable `rule_key` that survives copy-on-write, distinct from the immutable per-Version row id. No `deleted_at` anywhere — archive/restore only, exactly like trading accounts.
- **Database-enforced immutable Versions** — a `strategy_versions` row's `locked_at` transitions null → non-null exactly once, enforced by PostgreSQL triggers that reject any further update (content or `locked_at` itself) and reject insert/update/delete on locked child Setup-snapshot/Rule rows. A narrow, empirically-verified exception lets ordinary workspace deletion cascade away even locked history, while a direct delete of locked content (or its Strategy) with the workspace still present remains rejected.
- **Complete copy-on-write** (`src/server/services/strategy-versioning.ts`) — editing a locked Version always produces a full, faithful new Version: Strategy presentation, every Setup snapshot (including archived Setups' historical content), every Strategy- and Setup-level Rule, with `rule_key`/Setup identity preserved and Setup-level Rule scope correctly remapped to the new snapshot rows. A non-blank Change note is required only when copy-on-write actually fires.
- **Strategy/Setup/Rule domain services** (`src/server/services/strategy-management.ts`) — creation (atomic identity + Version 1, workspace-scoped `mutationKey` idempotency mirroring `createTradingAccount`), content updates, archive/restore lifecycle, and Rule CRUD, all behind the canonical lock order (workspace → entitlement → Strategy → current Version → Setup) shared with every other workspace-scoped service, so nothing in this domain can deadlock against trading-account or entitlement mutations. Every mutation is `authorizeWorkspaceMutation(entitlement, 'ordinary_write')` — `writable` allows, `over_limit`/`read_only` deny; reads are never gated. Service-owned audit events for every mutation, verified to carry no Strategy/Setup/Rule content (names, descriptions, notes, Rule titles, Change notes).
- **Authenticated public boundary** (`src/server/dal/strategies.ts`, `src/server/actions/strategies.ts`, `src/lib/strategies/{schemas,errors}.ts`) — session-derived DAL reads; `.strict()` Zod schemas that make client-supplied `workspaceId`/`actorUserId`/Version identity/lifecycle state structurally impossible; eleven Server Actions returning one closed, JSON-serializable discriminated result (`{ok:true,data}` / `{ok:false,error:{code,fieldErrors?}}`); a closed 16-code public error surface; idempotent create replay proven at the action layer for both Strategy and Setup.
- **Real management UI** (`/app/strategies`, replacing the Phase 01 fixture preview) — responsive master-detail Strategy list/detail, Setup and Rule management (create/edit/archive/restore, Strategy-level and Setup-level Rule grouping), copy-on-write UX with an explicit locked-Version notice and required Change note, access-mode-aware disabled controls with visible reasons, no hard-delete control anywhere, full English/Thai localization, and keyboard/dialog accessibility.
- **Full regression and closeout (06F)** — the complete unit/component suite, the complete real-PostgreSQL integration suite, and one complete production-build E2E suite (Chromium + Mobile Chrome) all passed against a guarded disposable database, and a stale-reference scan across docs and code found no active defects.

Deferred to later phases: Trade persistence and Strategy/Setup selection on Trades, Trade Rule checks, System/Trader Performance calculation, discipline scoring, historical Version detail/diff, manual Version locking, default timeframe, instrument class, expected minimum R, backtesting, and sharing/marketplace — none of these are Phase 06 defects.

## What Phase 07 delivered

Phase 07 is officially complete, across five slices (07A audit, 07B schema, 07C per-Trade engine, 07D aggregate/attribution engine, 07E regression and closeout). Full contract: [PHASE-07-calc-engine.md](phases/PHASE-07-calc-engine.md).

- **The approved Trade model** — one Trade row is one position (no partial fills, no scale-in/out); Strategy AND Setup are both required, never nullable; `actual_initial_risk_minor`/`net_pnl_minor` are the authoritative monetary source of truth, never re-derived from price × quantity × contract multiplier (that formula was found not universally valid during the 07A audit and deliberately abandoned).
- **Four-table Trade/discipline domain** (migration `0008_trade_domain_and_discipline.sql`) — `trades`, `mistake_types` (nine seeded system rows, neutral `severity = 'moderate'` / `default_weight = '1.0000'`, archive-only), `trade_mistakes`, and `trade_rule_checks` (`followed`/`violated`/`not_applicable`/`not_checked` against a composite FK into `strategy_rules`, replacing the stale boolean `was_satisfied` checklist sketch). `status` (Trader axis) and `system_status` (System axis) are independent columns, database-CHECK-enforced consistent with their respective R/outcome fields.
- **Pure per-Trade calculation engine** (`src/lib/calc/{types,decimal,risk,trade}.ts`, 07C) — Planned R, Actual R, System gross/net R, break-even-tolerant outcome classification, and the `composePlanned`/`composeTraderClose`/`composeSystemResolve` snapshot-composition helpers, all returning a closed `CalcResult<T>` union instead of `NaN`/`Infinity`/thrown errors.
- **Pure aggregate/attribution/equity engine** (`src/lib/calc/{aggregate,attribution,equity}.ts`, 07D) — Total/Average/Expectancy R, Win Rate, Average Win/Loss R, Payoff Ratio, Profit Factor, the cumulative-R equity curve, Maximum Drawdown, paired edge leakage, execution efficiency, and objective Rule adherence, each over its own independently-defined eligible population (Trader/System/Comparison — independent, not necessarily non-overlapping).
- **Two real precision defects found and fixed** — decimal.js's sign-only `.isPositive()`/`.isNegative()` treating exact zero as positive, which had corrupted `profitFactor` and `executionEfficiency`; every remaining call site was re-audited in 07E and confirmed safe.
- **Full regression and closeout (07E)** — the complete unit suite, the complete guarded-PostgreSQL integration suite, and one complete production-build E2E suite (Chromium + Mobile Chrome) all passed against a guarded disposable database; a stale-reference scan across docs and code found five active documentation defects (all fixed, all narrow); `docs/calculation-spec.md` was confirmed and retained as the one canonical formula document, no second `docs/formulas.md` was created.

Deliberately not implemented in Phase 07 — no approved formula exists for any of them yet, and none should be invented ahead of an explicit product decision: Discipline Score (0–100), the weighted mistake-penalty formula, mistake-cost ranking, attribution of edge leakage to individual mistake types, and verdict sample-size thresholds. Also not built: any service, DAL, Server Action, UI, database write path, or date-bucketed/SQL aggregation — the engine is pure functions over plain data, consumed starting in Phase 08 (writes) and Phase 09 (reads).

## What Phase 08 delivered

Phase 08 is officially complete across 08A–08F. Full contract: [PHASE-08-journal.md](phases/PHASE-08-journal.md).

- **Real Trade Journal routes** — `/app/trades` is an authenticated, cursor-paginated master/detail journal and `/app/trades/new` is the staged Account → Strategy/Setup → Plan → Review creation flow; both are localized in English/Thai and responsive through 320px.
- **Authoritative creation and historical identity** — the browser supplies Account/Strategy/Setup identities only. The service locks the workspace/framework, resolves and pins exact Strategy/Setup Version IDs, locks the Strategy Version on first reference, snapshots applicable Rules, inserts the Trade, and writes safe audit metadata in one transaction. Historical labels always come from those pinned snapshots.
- **Independent lifecycles and correction safety** — only `planned → open/canceled` and `open → closed` are allowed; the System axis independently supports `pending → resolved/no_trade` and terminal correction without any reset to pending. Every dependent snapshot is recomputed with Phase 07C composition helpers.
- **Discipline and deletion** — four-state Rule checks, the nine canonical system Mistakes with server-snapshotted severity/weight, and idempotent soft deletion are real. There is no Trade restore, custom Mistake CRUD, Discipline Score, mistake-cost attribution, or aggregate analytics UI.
- **Boundary and presentation** — strict Zod Server Actions expose no trusted/derived inputs, DAL reads remain available in every access mode, money uses registry-aware minor-unit conversion (including JPY/unknown-currency handling), and time input/display uses the persisted IANA timezone.
- **Regression closeout (08F)** — Trade unit/component, focused Phase 06–08 PostgreSQL, full guarded PostgreSQL, focused Trade production E2E, and a subsequent uncontaminated full repository production E2E all passed. Phase 09 can consume the persisted snapshots; it must not recalculate authoritative Trade values in SQL or React.

## What Phase 09 delivered

Phase 09 is officially complete across 09A–09F. Full contract: [PHASE-09-analytics.md](phases/PHASE-09-analytics.md).

- **Scoped historical read model** — authenticated workspace-scoped fixed-shape Trader, System, paired, Rule, and Mistake projections with strict active/All/archived Account and Strategy/Setup/Version identity filters.
- **Calendar semantics** — `30d`, `90d`, and `all` only (`90d` default), with persisted-IANA local-calendar bounds converted to half-open UTC ranges. Trader uses `exited_at`, System uses `system_exited_at`, and paired bounded inclusion requires both.
- **Canonical composition** — every aggregate, attribution, adherence, equity, and drawdown result delegates to Phase 07D. System and Trader populations and curves remain independent; paired values come from the identical same-Trade population. Explicit unavailable/integrity states never become numeric zero, `NaN`, or `Infinity`.
- **Real product surfaces** — `/app` is the active-Account 30D/90D/All overview; `/app/analytics` adds All Accounts plus Strategy, Setup, and Strategy Version filters, complete System/Trader R metrics, paired comparison, independent equity charts, Rule adherence, and count-only canonical Mistakes. Historical Trade rows retain pinned Version labels.
- **Boundaries preserved** — authenticated analytics import no demo fixtures, aggregate no currency P&L, perform no FX conversion, and state no verdict/grade/confidence, Discipline Score, or mistake cost.
- **Measured closeout (09F)** — the 5,000-Trade benchmark remained in single-digit milliseconds for every representative query and required no migration `0009`; focused and complete unit/PostgreSQL/production-E2E regressions passed with responsive EN/TH coverage.

## Sequencing rationale

**Design system early (01).** A token set that nothing consumes cannot be reviewed. Building the marketing site and the application shell against it exercises every token, every state, and every breakpoint before any of it is load-bearing for real data — and it is far cheaper to change a token now than after eight phases depend on it.

**Auth and tenancy together (02).** The originally-planned split — auth in 02, tenancy in 03 — was superseded by this phase's actual commissioning brief, which combined them: a workspace has to exist the moment a user does, so provisioning one is naturally part of authentication's own transaction (`ensurePersonalWorkspace`, wired to Better Auth's user-creation hook), not a separately-sequenced concern. The original rationale for ordering tenancy before any business table still holds and is unaffected: **no tenant-scoped product records exist in Phase 02**, and Phase 02 writes no product query — the first one (`trading_accounts`) arrived in Phase 3A, several increments later. See [ADR 0011](decisions/0011-tenant-workspace-authorization-model.md).

**Calculation engine before journal UI (07 → 08).** The engine is pure and fully testable with no UI. Building forms first would bake formula assumptions into them and force rework.

**Entitlements before billing expansion (03C → 04).** Active-account creation and restoration limits already execute server-side inside their mutation transactions. Phase 04 adds customer billing and checkout without weakening that authorization boundary or inventing plan-specific feature gates.

**Analytics replaces authenticated fixtures with measured read models (09).** The public `/demo` fixtures remain explicitly labelled and isolated; authenticated Dashboard/Analytics consume persisted snapshots and the Phase 07D engine.

## Superseded

**Phase 11 — Landing & Marketing** was folded into Phase 01 and its document removed. It was originally scheduled last because it depends on final pricing and real screenshots. At that time it shipped with prices shown as "to be confirmed" rather than invented, and with a live composition of demo fixtures rather than a screenshot. Phase 3C later replaced that provisional pricing state with the final monthly plan decision.

**The original Phase 03 — Data Model & Tenancy Core plan** was folded into Phase 02; its document is preserved as the historical record of the original two-phase split. It is not the later Phase 3A–3C implementation that is now officially complete. See [ADR 0009](decisions/0009-self-hosted-better-auth.md) for why Better Auth replaced the originally planned Auth.js.

## Out of scope for the MVP

Broker API integration · MT4/MT5 sync · CSV import · OCR · TradingView API · real payment processing · AI API integration · native mobile apps.
