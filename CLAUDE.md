# CLAUDE.md — Trading OS Engineering Constitution

> This file is the standing contract for all work in this repository.
> Read it before modifying code. Read the active phase document in [`docs/phases/`](docs/phases/) second.
>
> **Status:** Phase 03 (3A–3C), Phase 04 — Billing & Checkout (including the 04H-A production payment-provider guard), Phase 05 — Onboarding & Trading Accounts (05A–05D), and Phase 06 — Strategies & Versions (06A–06F) are officially complete and merged to `main`; Phase 07 — Trade Model & Calculation Engine is the next implementation phase. Authentication, tenant-isolated workspaces, registration hardening, onboarding, full trading-account management, the active-account switcher, the 7-day/1-active-account/full-feature trial, server-side active-account entitlement enforcement, monthly-plan checkout, immutable billing snapshots, conditional VAT presentation, and the production mock-payment-provider guard are real. Phase 05 additionally closed out archived-account UX parity with active accounts, unambiguous archive-not-delete messaging, a fuller restore-blocked-by-limit explanation, clearer "Current account" account-state terminology, and an Edit control that now matches server-side `read_only`/`over_limit` authorization instead of only failing on submit — no schema, entitlement rule, or account-lifecycle change. Phase 06 delivered workspace-owned Strategies with nested Setups, the five-table `strategies`/`strategy_versions`/`setups`/`strategy_setup_versions`/`strategy_rules` domain, structured Rules with a stable `rule_key`, database-enforced immutable locked Versions with complete copy-on-write, archive-only lifecycle, `ordinary_write` access-mode integration, an authenticated DAL/Server Action boundary with typed discriminated results and safe public error codes, and the real responsive `/app/strategies` management UI (list/detail, Setup and Rule management, locked-Version copy-on-write UX, English/Thai localization, accessibility, full E2E coverage) replacing the Phase 01 fixture preview. The final monthly paid plans are **Starter** (1 active account, THB 149 or USD 5), **Trader** (5, THB 299 or USD 9), and **Professional** (15, THB 499 or USD 15). Every paid plan has identical features and analytics, including unlimited strategies, setups, trades, and trade history — Strategies and Setups carry no plan/count quota anywhere. Archived accounts do not count; create and restore enforce the allowance server-side. VAT collection is disabled at launch because the business is not initially VAT registered; the prepared 7% rate and conditional presentation are implemented but inactive. The only payment provider is a mock provider, unreachable by ordinary production traffic (`src/config/billing-capability.server.ts`) — a real provider is required before public paid activation can launch. Trades and analytics calculations remain absent beyond the completed Phase 03/04/05/06 foundation — the Trade schema and calculation engine are Phase 07's job.
> **Last updated:** 2026-08-06 (Phase 06F — full regression and official Phase 06 closeout, following the shipped Phase 06A–06E Strategy/Setup/Rule domain and management UI)
>
> The master product instructions this repository was commissioned under are preserved verbatim in [Appendix A](#appendix-a--master-instructions-verbatim). Where this document elaborates on them, the appendix governs intent and this document governs implementation.

---

## 1. What this product is

A multi-tenant SaaS trading journal whose purpose is **attribution**, not bookkeeping. It exists to answer one question:

> Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?

Everything in the schema, the calculation engine, and the analytics UI serves that question. A feature that does not help separate _system performance_ from _trader performance_ is out of scope unless a phase document explicitly requests it.

### The central distinction (non-negotiable)

|                 | **System performance**                                             | **Trader performance**                                                                                                   |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Definition      | Result if strategy rules had been followed exactly                 | Result of the trader's actual decisions                                                                                  |
| Source of truth | Planned entry, planned stop, planned target, rule-defined exit     | Actual entry, actual initial stop, actual exit, actual costs                                                             |
| Metrics         | System Win Rate, Avg R, Expectancy, Profit Factor, Total R, Max DD | Actual Win Rate, Avg R, Expectancy, Profit Factor, Total R, Max DD, Discipline Score, Execution Efficiency, Edge Leakage |

**System outcome and trader outcome are independent stored fields.** Never derive system outcome from actual profit. All four quadrants must be representable and must survive into analytics:

- system win / trader win
- system win / trader loss ← _the most valuable cell in the product_
- system loss / trader loss
- system loss / trader win _(made money by breaking the rules)_

---

## 2. Stack decisions

Fixed for the MVP. Changing any of these requires an explicit decision recorded in this file.

| Concern         | Decision                                                  | Notes                                                                                                                              |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | **Next.js 16.2.12**, App Router, React 19.2.4             | Pinned exactly at Phase 00 init. Upgrade deliberately, never by floating range.                                                    |
| Language        | **TypeScript 5.9.3**, `strict: true`                      | Plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.                                             |
| Package manager | **pnpm 11.17.0**                                          | Lockfile committed. Build scripts approved explicitly in `pnpm-workspace.yaml`.                                                    |
| Database        | PostgreSQL via standard `DATABASE_URL`                    | **Local Postgres in development; Neon for deployment.** No Vercel-only or Neon-only features.                                      |
| ORM             | Drizzle ORM + drizzle-kit                                 | Migrations are generated SQL, committed, forward-only.                                                                             |
| Validation      | Zod                                                       | At every boundary: server actions, route handlers, env, external payloads.                                                         |
| Auth            | Better Auth (self-hosted) — Google OAuth + email/password | Drizzle adapter, database-backed sessions. Behind `src/lib/auth/`. See [ADR 0009](docs/decisions/0009-self-hosted-better-auth.md). |
| UI              | Tailwind CSS + shadcn/ui (Radix primitives)               | Accessible primitives; no admin-template kits.                                                                                     |
| Motion          | `motion` (Framer Motion)                                  | Must respect `prefers-reduced-motion`.                                                                                             |
| Charts          | Recharts                                                  | Load the `dataviz` skill before writing any chart code.                                                                            |
| Unit tests      | **Vitest 4.1.10** + React Testing Library                 | Calculation engine requires near-total coverage.                                                                                   |
| E2E tests       | **Playwright 1.62.0**                                     | Wired in Phase 00; desktop + mobile viewports. Flows grow per phase.                                                               |
| Formatting      | **Prettier 3.9.6**                                        | Also owns import ordering and Tailwind class sorting. CI runs `format:check`.                                                      |
| Money math      | `decimal.js` for prices; `bigint` for minor units         | See §5. **Never `number` for financial values.**                                                                                   |

### Mutations

All writes go through **server actions** wrapped by a single guard helper. There is no unguarded mutation path. See §4.

---

## 3. Architecture

```
src/
  app/                  # routes only — thin, no business logic
  components/           # presentational + composed UI
  server/
    actions/            # server actions (guarded, Zod-validated) — e.g. preferences.ts
    auth/                # server-only session/workspace authorization DAL (dal.ts)
    services/           # business logic, tenant-aware — e.g. workspace-provisioning.ts, audit-log.ts
    db/
      schema/           # drizzle tables — auth.ts, workspaces.ts, user-preferences.ts, audit-logs.ts
      queries/          # scoped query helpers (introduced once product tables exist)
  lib/
    calc/               # PURE deterministic calculation engine — no I/O, no db
    auth/               # Better Auth instance, client, email-delivery adapter — see ADR 0009, ADR 0013
    identifiers.ts       # the one ID generator — see ADR 0008
    money/              # decimal + minor-unit primitives
    time/               # UTC storage, tz-aware display
  config/               # plan definitions, mistake taxonomy, audit-action allowlist, constants
  proxy.ts               # optimistic locale + session-cookie-presence redirect (Next.js 16 convention; not the auth boundary)
drizzle/                # generated migrations (committed)
docs/decisions/          # architecture decision records
docs/phases/            # phase documents
```

Rules:

- `lib/calc/` imports **nothing** from `server/` or `app/`. It takes plain data, returns plain data. This is what makes it unit-testable and trustworthy.
- Business logic never lives in a React component.
- Infrastructure (auth provider, email sender, payment provider) sits behind a small adapter so a VPS migration does not touch feature code.
- Avoid premature abstraction. Two call sites do not justify a framework.

---

## 4. Multi-tenancy and authorization

Every user-owned business record carries `workspace_id`. The initial workspace represents one user's personal workspace, but the schema supports teams from day one (`workspaces`, `workspace_members`, `role`).

**Every server read and write must verify, server-side:**

1. Authenticated user (session)
2. Active membership in the target workspace
3. Required role/permission
4. Ownership or workspace scope of the specific record
5. Subscription entitlement, where the action consumes a limited resource

**Never trust a tenant ID, workspace ID, or user ID from the client.** Workspace scope is derived from the session and the resolved active workspace — never read from a request body, query string, or hidden form field.

The intended shape:

```ts
// every mutation looks like this — no exceptions
export const createTrade = action
  .input(CreateTradeSchema) // Zod
  .use(requireWorkspace('member')) // session -> WorkspaceContext
  .use(requireEntitlement('trades')) // plan limits
  .handler(async ({ ctx, input }) => {
    /* ctx.workspaceId is trusted */
  });
```

Record IDs are **UUIDv7** — sortable, non-enumerable. ID unguessability is a defence-in-depth measure, never the authorization mechanism.

A user must never reach another workspace by editing a URL, payload, or record ID. Phase 01 ships tests that assert this directly.

---

## 5. Money, prices and precision

Floating-point arithmetic is banned for financial values. Two distinct representations, because they solve different problems:

**Monetary amounts** — P&L, fees, commission, swap, balances, plan prices.

- Stored as `BIGINT` **minor units** (cents/satoshi-equivalent) plus an ISO-4217 currency code.
- Handled in TypeScript as `bigint`.
- Currency scale comes from a lookup, not a hardcoded `100` (JPY has 0 decimals).

**Instrument prices** — entry, stop, target, exit.

- Cannot be minor units: `EURUSD @ 1.08532` has no cent representation.
- Stored as `NUMERIC(20, 10)`.
- Read into TypeScript as **strings**, manipulated with `decimal.js`. Never parsed to `number`.

**R-multiples and ratios** — stored `NUMERIC(12, 4)`, computed with `decimal.js`, rounded once at the presentation boundary.

Drizzle must be configured so `numeric` columns come back as strings. Any place a price becomes a JS `number` is a bug.

---

## 6. Calculation rules

Every formula lives in `src/lib/calc/`, is documented in code with its definition, and is unit-tested including edge cases. Analytics may never reimplement a formula inline.

### Per-trade primitives

Let `direction ∈ {long, short}`.

```
riskPerUnit(entry, initialStop) =
    long  -> entry - initialStop
    short -> initialStop - entry
```

`riskPerUnit` must be **strictly positive**. A non-positive value means the stop is on the wrong side of entry — reject at validation, never silently proceed.

```
initialRiskAmount = riskPerUnit × positionSize × contractMultiplier   [minor units]

netResult = grossPnL − commission − fees − swap                        [minor units]

actualR   = netResult / actualInitialRiskAmount
plannedR  = plannedRewardPerUnit / plannedRiskPerUnit
```

### System vs actual use different denominators — deliberately

- **System R** is computed from `plannedEntry`, `plannedStop`, and the rule-defined exit. It answers "what did the strategy offer?"
- **Actual R** is computed from `actualEntry`, `actualInitialStop`, and the real exit and costs. It answers "what did the trader take?"

Both are expressed in R, which is precisely what makes them comparable even when the trader sized the position differently from the plan. That normalization is the point.

### Break-even

Never compare to zero with `==`. Break-even is an explicit, configurable band:

```
|R| <= breakEvenToleranceR  ->  BREAK_EVEN
```

`breakEvenToleranceR` is configured **per trading account**, default `0.05`. Recorded as an assumption; revisit with real usage.

### Aggregates

```
winRate       = wins / closedTrades                (break-evens excluded from numerator, included in denominator)
avgR          = mean(R)
expectancy    = mean(R)                            (equivalently winRate·avgWinR − lossRate·|avgLossR|)
profitFactor  = Σ R⁺ / |Σ R⁻|                       (null when Σ R⁻ = 0 — report as "no losses", never Infinity)
totalR        = Σ R
maxDrawdownR  = max over t of (runningPeak(ΣR) − ΣR at t)
```

Divide-by-zero, empty sets, and all-wins/all-losses cases return `null` with an explicit reason — never `NaN`, never `Infinity`, never a silent `0`.

### Attribution metrics

```
edgeLeakageR       = systemTotalR − actualTotalR
                     (positive = trader destroyed edge; negative = trader added value by deviating)

executionEfficiency = actualTotalR / systemTotalR
                      defined only when systemTotalR > 0; otherwise null
                      (a ratio against a negative or zero system edge is meaningless, not merely undefined)

disciplineScore    = 100 × (1 − mean(perTradePenalty))
perTradePenalty    = min(1, Σ severityWeight(mistake))
severityWeight     = { minor: 0.15, moderate: 0.35, severe: 0.60 }   [config/mistakes.ts]
```

Weights are configuration, not magic numbers in a component.

---

## 7. Time

- Store every timestamp as `timestamptz`, **UTC**.
- Each user has an IANA timezone (`Asia/Bangkok`, etc.) on their profile.
- All display and all **date-bucketed analytics** (daily equity curve, calendar heatmaps) use the user's timezone. A trade closed 23:30 Bangkok belongs to that Bangkok day, not the UTC day.
- Never use the server's local timezone. Never use the browser's timezone as the source of truth.

---

## 8. UX standards

Modern professional SaaS. Not an admin template.

- Identity: blue / navy / cyan. **Dark mode is the primary experience**; light mode is complete, not an afterthought.
- Restrained gradients, clean layered surfaces, generous spacing, consistent radii, clear hierarchy.
- Accessible contrast (WCAG AA minimum), visible focus rings, full keyboard operation, labelled form controls, semantic landmarks.
- Animation earns its place: page/section transitions, animated drawers and dialogs, skeleton loading, subtle card hover, smooth chart transitions, and settled KPI-change feedback. KPI values must never count through false intermediate financial figures. No excessive glass, glow, or motion for its own sake. **Always honor `prefers-reduced-motion`.**
- Responsive: desktop-first analytics, fully usable tablet, mobile quick-entry. **No horizontal page overflow at any breakpoint.** Charts degrade gracefully; wide tables scroll inside their own container.

Every data surface ships four states: **loading, empty, error, success.** An empty state that just says "No data" is not done — it tells the user what to do next.

---

## 9. Explicitly out of scope

Do not build these unless a later phase document explicitly requests them:

Broker API integration · MT4/MT5 sync · CSV import · OCR · TradingView API · real payment processing · AI API integration · native mobile apps.

Payments are a **mock flow** for the MVP, isolated behind a payment adapter so a real provider can be dropped in without touching feature code.

---

## 10. Working agreement

**Before modifying code:** read this file → read the active phase document → inspect existing code and migrations → report the files likely to change. Do not rewrite unrelated code.

**After implementing:** format → lint → typecheck → unit tests → integration tests where relevant → production build. Then summarize changed files, document migrations, note unresolved risks, and make **one coherent commit** for the task.

**Never claim a check passed unless it was actually executed.** Report failures with their output.

**Never** delete data, reset a database, rewrite git history, or modify production configuration without explicit authorization.

### Definition of Done

- [ ] Requirements implemented
- [ ] Authorization enforced server-side
- [ ] Zod validation at the boundary
- [ ] Loading, empty, error, success states
- [ ] Desktop, tablet, mobile checked
- [ ] Accessibility basics present
- [ ] Tests pass · TypeScript passes · Lint passes · Production build passes
- [ ] Documentation updated
- [ ] No secrets committed
- [ ] Rollback path understood

When requirements are ambiguous: choose the **smallest safe implementation** that preserves future extensibility, and record the assumption in the phase document's _Assumptions_ section.

---

## 11. Open assumptions

Recorded here until validated. Each needs a decision before or during the phase noted.

| #   | Assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Decide by    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| A1  | Break-even tolerance defaults to `0.05R`, configurable per trading account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Phase 07     |
| A2  | Mistake severity weights: minor 0.15 / moderate 0.35 / severe 0.60                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 07     |
| A3  | **Locked in Phase 3C** — three monthly paid plans, gating exclusively on active trading-account count, with identical features and analytics: Starter (1 account, THB 149/USD 5), Trader (5 accounts, THB 299/USD 9), Professional (15 accounts, THB 499/USD 15). Every plan includes unlimited strategies, setups, trades, and trade history. Archived accounts do not count. Prices are tax-exclusive; VAT collection is disabled at launch because the business is not initially VAT registered. Superseded the Phase 01 provisional 1/3/10 starter/pro/elite draft. Registry: `src/config/plans.ts`.                                                                                                                                                                                                                                                                                                                  | Phase 3C ✓   |
| A4  | **Locked in Phase 3C** — trial is 7 days, no card required, unlocks every feature, and grants exactly **1** active trading account — an explicit constant (`TRIAL_ACCOUNT_LIMIT`, `src/lib/entitlements/resolve.ts`), never derived from any paid plan's limit (not the highest, not Starter's, not `Math.max(...)`). Starts when workspace **onboarding completes** (`completeOnboarding`), not at first login — chosen so a trial is never consumed by an unverified account that never onboards, and so a trial-to-Starter conversion needs no account-count migration (both are exactly 1 account).                                                                                                                                                                                                                                                                                                                   | Phase 3C ✓   |
| A5  | Personal workspace auto-created on signup; team invites deferred post-MVP — **decided in Phase 02**: implemented via `ensurePersonalWorkspace()`, see [ADR 0011](docs/decisions/0011-tenant-workspace-authorization-model.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 02 ✓   |
| A6  | Strategy versions are immutable once a trade references them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase 06     |
| A7  | Deleted trades are soft-deleted to keep historical analytics stable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Phase 07     |
| A8  | OS light preference is honoured over the dark-first identity — see `docs/design-system.md` §3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 00b    |
| A9  | Demo fixtures carry no formulas and are labelled at every render site — see ADR 0006                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Phase 09     |
| A10 | Onboarding completion is workspace-scoped (`workspaces.onboarding_completed_at`), not user-scoped — a future team workspace completes onboarding once, for every member                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase 3B     |
| A11 | Active trading account is a per-user preference (`user_preferences.active_trading_account_id`), re-validated against the current active workspace on every read rather than trusted from the stored reference — no cross-workspace FK exists to enforce this at the database layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 3B     |
| A12 | `trading_accounts.base_currency` is an unconstrained (shape-validated only) ticker, not the closed fiat `CurrencyCode` registry — deliberately allows crypto (BTC, ETH, USDT, USDC) alongside fiat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 3B     |
| A13 | **Enforced starting Phase 3C** — account-count entitlement limits (A3/A4) are now checked server-side inside `createTradingAccount`'s and `restoreTradingAccount`'s existing locked transactions (`src/server/services/entitlement.ts`'s `lockAndResolveEntitlement`, row-locked on `workspace_entitlements`); idempotency is checked before the limit, archive/edit/switch are never gated, and archived accounts never count toward the limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Phase 3C ✓   |
| A14 | Trading-account mutation authorization is centralized in one function (`requireTradingAccountManagement`, `src/server/auth/dal.ts`), currently requiring only the `'member'` role — this project's only role in active use is `'owner'` (ADR 0011), and nothing yet distinguishes owner-only vs member-permitted account actions; a future shared-workspace policy narrows this one call site, not every action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Phase 3C     |
| A15 | Trading-account creation idempotency is a client-generated UUID (`trading_accounts.mutation_key`) under a workspace-scoped unique index, not a separate idempotency-key table — chosen because the only mutation needing this guarantee is account creation, and the existing `INSERT ... ON CONFLICT DO NOTHING` idiom (`ensurePersonalWorkspace`) already covers it without new infrastructure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Phase 04 ✓   |
| A16 | Workspace entitlement state (`workspace_entitlements`: `status`, `plan_key`, `trial_started_at`, `trial_ends_at`, `current_period_ends_at`) lives in its own table, one row per workspace (unique-indexed), not folded into `workspaces` — mirrors the `trial_expired` effective status computed on read (`now >= trial_ends_at`) rather than a cron-updated persisted transition. `plan_key` values are exactly `starter`/`trader`/`professional` (migration `0004_rename_plan_keys_trader_professional` renamed the retired `pro`/`elite` draft keys and reinstalled the CHECK constraint); an unrecognized `plan_key` fails closed (blocks create/restore) rather than guessing a limit.                                                                                                                                                                                                                               | Phase 3C ✓   |
| A17 | **Locked in Phase 04 ✓** — the only payment provider is a mock provider (`src/server/payments/mock-payment-provider.ts`) behind a narrow `PaymentProvider` interface; checkout, immutable billing snapshots, and `current_period_ends_at` maintenance are implemented (`src/server/services/checkout.ts`, `src/server/services/subscription-lifecycle.ts`). **Locked in Phase 04H-A** — the mock provider is reachable only in `development`/`test` `NODE_ENV`, or in production behind a guarded, CI-only automated-test seam requiring `E2E_TEST_MODE=true`, a loopback `BETTER_AUTH_URL`, and a trusted provisioned e2e identity (`src/config/billing-capability.server.ts`); ordinary production checkout returns `payment_provider_unavailable` and creates no billing row. Admin-only VAT configuration remains Phase 11's job. A real payment provider is still required before public paid activation can launch. | Phase 04 ✓   |
| A18 | VAT is disabled at launch because the business is not initially VAT registered. Future VAT is admin-only enable/disable with a configurable rate initially prepared as 7%, calculated exclusively on top of displayed prices. Disabled means no VAT line or notice. Enabled public notices are exactly TH `ราคาไม่รวมภาษีมูลค่าเพิ่ม 7%` and EN `Prices exclude 7% VAT.`; checkout shows subtotal/VAT/final total. Server configuration determines the rate and tax, calculations use integer minor units with deterministic rounding, and historical price/tax snapshots are immutable. **Locked in Phase 04 ✓** — conditional presentation, server-side calculation, and immutable snapshotting are implemented (`src/lib/billing/vat.ts`, `src/config/billing.server.ts`) with VAT disabled by default; only the admin enable/disable UI (Phase 11) and its hardening verification (Phase 12) remain.                  | 04 ✓, 11, 12 |

---

## Appendix A — Master instructions (verbatim)

The original commissioning brief, preserved unaltered. Sections 1–11 above are the working elaboration of it; this appendix is the source of truth for intent.

---

# Trading Journal SaaS — Master Engineering Instructions

You are working on a production-oriented multi-tenant Trading Journal SaaS.

The product is not merely a profit-and-loss journal. Its core purpose is to explain whether trading performance comes from:

1. The strategy or trading system
2. The trader's actual execution
3. Discipline and behavioral mistakes

## Core Product Principle

The platform must clearly separate:

### System Performance

The hypothetical result that would have occurred if the strategy rules had been followed exactly.

Examples:

- System Win Rate
- System Average R
- System Expectancy
- System Profit Factor
- System Total R
- System Maximum Drawdown

### Trader Performance

The result produced by the trader's actual entry, management and exit decisions.

Examples:

- Actual Win Rate
- Actual Average R
- Actual Expectancy
- Actual Profit Factor
- Actual Total R
- Actual Maximum Drawdown
- Discipline Score
- Execution Efficiency
- Edge Leakage

The product should help answer:

"Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?"

## MVP Product Scope

Build the following:

- Modern SaaS landing page
- Google and email authentication
- Seven-day trial
- Three subscription plans based primarily on allowed trading-account count
- Mock payment flow initially
- User onboarding
- Trading-account management
- Strategy and strategy-version management
- Manual trade journal
- TradingView chart URL support
- System outcome versus actual outcome
- Mistake and discipline tracking
- Dashboard
- Basic analytics
- Account, subscription and profile settings
- Basic SaaS administration
- Responsive desktop, tablet and mobile interfaces

Do not implement the following unless a later phase explicitly requests them:

- Broker API integration
- MT4 or MT5 synchronization
- CSV trade import
- OCR
- TradingView API integration
- Real payment processing
- AI API integration
- Native mobile applications

## UX Principles

The interface must feel like a modern professional SaaS product, not an old admin template.

Visual direction:

- Modern blue, navy and cyan visual identity
- Professional dark mode as the primary experience
- Complete light mode
- Restrained gradients
- Clean layered surfaces
- Generous spacing
- Clear information hierarchy
- Consistent border radii
- Accessible contrast
- Professional financial analytics presentation

Animation requirements:

- Use animation only where it improves comprehension
- Smooth page and section transitions
- Animated drawers and dialogs
- Skeleton loading states
- Subtle card hover feedback
- Smooth chart transitions
- Animated KPI values where appropriate
- Respect prefers-reduced-motion
- Avoid excessive glass effects, glow or distracting motion

Responsive requirements:

- Desktop-first analytics experience
- Fully usable tablet layout
- Mobile quick-entry experience
- No horizontal page overflow
- Charts must degrade gracefully on small screens
- Forms must use mobile-friendly controls

## Engineering Principles

- Use the current stable Next.js release available when initializing the project
- Use TypeScript strict mode
- Use pnpm
- Use PostgreSQL through a standard DATABASE_URL
- Use Neon in the initial deployment
- Use Drizzle ORM with version-controlled migrations
- Use Zod for boundary validation
- Use server-side authorization for every protected mutation
- Never trust tenant IDs supplied by the client
- Derive user and tenant scope from the authenticated session
- Use integer minor currency units or a safe decimal strategy for money
- Never use floating-point arithmetic for financial values
- Store timestamps in UTC
- Display dates in the user's configured timezone
- Build with future VPS portability in mind
- Do not use unnecessary Vercel-only database features
- Isolate infrastructure integrations behind small adapters
- Keep business logic separate from UI components
- Calculations must be deterministic and unit-tested
- Avoid premature abstractions
- Avoid implementing features outside the current phase

## Multi-Tenancy

Every user-owned business record must be tenant-scoped.

The initial tenant may represent an individual user's workspace, but the schema must allow future team functionality.

All server reads and writes must verify:

- authenticated user
- active workspace membership
- required role or permission
- ownership or workspace scope
- subscription entitlement where applicable

A user must never be able to access another workspace by editing a URL, request payload or record ID.

## Financial and Trading Calculation Rules

All formulas must be documented in code and covered by tests.

For a standard trade:

- Initial risk per unit is based on entry price and initial stop-loss price
- Planned R is planned reward divided by initial risk
- Actual R is realized net result divided by initial monetary risk
- Fees, commission and swap must be included in net result where applicable
- Break-even must use an explicit configurable tolerance and not an unsafe equality comparison

System outcome and trader outcome are separate fields.

Do not infer system outcome solely from actual profit.

A trade can be:

- System win and trader win
- System win and trader loss
- System loss and trader loss
- System loss while trader made money by deviating from rules

Preserve this distinction in the schema and analytics.

## Git Discipline

Before modifying code:

1. Read CLAUDE.md
2. Read the current phase document
3. Inspect existing code and migrations
4. Report the files likely to be changed
5. Do not rewrite unrelated code

After implementation:

1. Run formatting
2. Run lint
3. Run TypeScript checks
4. Run unit tests
5. Run integration tests where relevant
6. Run the production build
7. Summarize changed files
8. Document migrations
9. Document unresolved risks
10. Create one coherent commit for the completed task

Never claim that tests passed unless they were actually executed.

Never delete data, reset a database, rewrite Git history or modify production configuration without explicit authorization.

## Definition of Done

A task is complete only when:

- Requirements are implemented
- Authorization is enforced server-side
- Validation exists
- Loading, empty, error and success states exist
- Desktop, tablet and mobile behavior is checked
- Accessibility basics are present
- Relevant tests pass
- TypeScript passes
- Lint passes
- Production build passes
- Documentation is updated
- No secrets are committed
- A rollback path is understood

When requirements are ambiguous, choose the smallest safe implementation that preserves future extensibility and record the assumption.
