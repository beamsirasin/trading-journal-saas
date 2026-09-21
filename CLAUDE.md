# CLAUDE.md — Trading OS Engineering Constitution

> This file is the standing engineering and AI operating contract for all work in this repository.
> Read it before modifying code. For a domain covered by an approved Product Contract in [`docs/product-contracts/`](docs/product-contracts/), read that contract; for user-facing work also read [`docs/UX_RULES.md`](docs/UX_RULES.md), then [`DESIGN.md`](DESIGN.md) (visual-design authority) and [`docs/design-system.md`](docs/design-system.md) (its implementation and token reference); then read the active phase document in [`docs/phases/`](docs/phases/).
>
> **Documentation precedence:** each level controls its own domain, and a lower level never overrides a higher level's semantic or behavioural decision. (1) An approved Product Contract controls **product semantics** for its domain; (2) [`docs/UX_RULES.md`](docs/UX_RULES.md) controls **interaction and behaviour** and never changes contract semantics; (3) this file and the canonical technical docs (`docs/calculation-spec.md`, `docs/data-dictionary.md`, `docs/product-spec.md`) control **engineering and technical constraints** as applicable — those constraints (authorization, tenancy, money precision, UTC time) still bind how (1)–(2) are implemented, but these documents must not contradict (1)–(2), and they label current implementation that has not caught up; (4) [`DESIGN.md`](DESIGN.md) controls **visual expression**, with [`docs/design-system.md`](docs/design-system.md) as its implementation and token reference, and may never simplify away an approved semantic or behaviour; (5) Phase documents and other historical records never silently override any level above. See [`docs/product-contracts/README.md`](docs/product-contracts/README.md).
>
> **Review & System Assessment:** [`docs/product-contracts/review-system-assessment.md`](docs/product-contracts/review-system-assessment.md) is **approved (v1, 2026-09-20)** and elaborates Add Trade §14–§22, §25 and §28 (decisions 41–49 amend Add Trade §8, §18, §21 and §25). It is **not implemented**; current Review / System code is pending migration.
>
> **Add Trade:** [`docs/product-contracts/add-trade.md`](docs/product-contracts/add-trade.md) is **approved (v1, 2026-09-14)** and is the product source of truth for At Entry, After Trade, Partial / Final Close, Review, System Assessment and related Strategy / Psychology / Discipline semantics. Much of it is **not implemented yet** — see §6 _Approved Add Trade target semantics_ and _Current implementation pending migration_.
>
> **Status:** Phases 03–11 are officially complete. Phase 11 — SaaS Administration delivered a dedicated `platform_admins` grant-history authority (never `users.is_platform_admin`, never derived from Workspace ownership), an append-only `admin_audit_log`, an EN-only non-locale-prefixed `/admin` shell (Overview, Users, Workspaces, Audit, VAT), privacy-limited read-only User/Workspace oversight, exactly three named Subscription Support mutations (Extend Trial, Grant/Change Complimentary Plan, Revoke Complimentary Plan) with a truthful null-shaped complimentary state that can convert to real paid only through the genuine checkout path, and DB-authoritative append-only platform VAT configuration (fail-closed, no customer control, no scheduling UI) wired into every quotation/checkout/billing-presentation call site. Platform-admin provisioning/revocation remains operational-script-only; no Admin-management UI exists or is planned. Phase 10 delivered the single pre-onboarding Settings surface with real self-scoped Profile/Preferences and Account Security, owner+writable Workspace rename, canonical Account/Plan/Billing navigation, and owner-only schema-versioned JSON/normalized CSV ZIP Workspace export that remains available in read-only and over-limit modes. No migration was required for Phase 10; Phase 11 needed exactly one (`0009_platform_admin_foundation.sql`, Phase 11B). Email change, avatar editing, provider linking/unlinking, MFA/passkeys, async import/export jobs, and account/workspace deletion remain deferred, as do impersonation, suspension, refunds/reconciliation, and payment-provider administration.
> Phase 12A — Launch Readiness Repository and Infrastructure Audit — is complete: a read-only audit found zero tenant-isolation or Platform Admin authorization defects, a sound billing/subscription state machine, no production payment provider, no working production email delivery, and no platform-wide security headers. Phase 12B — Security Hardening delivered a blanket security-header baseline (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, a minimal `Permissions-Policy`, and production-only `Strict-Transport-Security`) plus a Report-Only `Content-Security-Policy` (enforcement deliberately deferred until a nonce architecture and real payment-provider script requirements are known), re-verified with no changes needed that tenant isolation/Platform Admin authorization/billing state machine/production fail-closed guards remain sound, extended redirect-safety regression coverage, and added an operator-facing confirmation (resolved email) to the platform-admin grant/revoke script's dry-run output. Phase 12B did not implement production email delivery or a real payment provider — both remain explicitly deferred to a later integration slice/phase, not a 12B gap. Phase 12 overall remains incomplete: accessibility automation, full responsive-width coverage, performance baselines, staging/production infrastructure, observability, and backup/restore rehearsal are still outstanding.
> **Last updated:** 2026-09-15 (UX Rules activated in the documentation precedence and Add Trade UX boundary decisions 24–37 recorded; the engineering status above last changed in Phase 12B)
>
> The master product instructions this repository was commissioned under are preserved verbatim in [Appendix A](#appendix-a--master-instructions-verbatim). Where this document elaborates on them, the appendix governs intent and this document governs implementation. An approved Product Contract supersedes Appendix A's intent for the domain it covers.

---

## 1. What this product is

A multi-tenant SaaS trading journal whose purpose is **attribution**, not bookkeeping. It exists to answer one question:

> Did the trader lose because the strategy has no edge, or because the trader did not follow the strategy?

Everything in the schema, the calculation engine, and the analytics UI serves that question. A feature that does not help separate _system performance_ from _trader performance_ is out of scope unless an approved Product Contract or a phase document explicitly requests it.

### The central distinction (non-negotiable)

|                 | **System performance**                                                               | **Trader performance**                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Definition      | Result if strategy rules had been followed exactly                                   | Result of the trader's actual decisions                                                                                                                                        |
| Source of truth | The trader-confirmed System Result (Money, or direct R) under the rules that applied | Final Net P&L (Money) and the trader-selected Trader Outcome                                                                                                                   |
| Metrics         | System Positive Rate, System R, Avg R, Expectancy, Profit Factor, Total R, Max DD    | Actual R, Trader Win Rate (trader-selected outcomes), Avg R, Expectancy, Profit Factor, Total R, Max DD; paired System Edge Captured and Execution Gap are reported separately |

Both R figures use the approved common **Risk at Entry** baseline, and Win / Loss / BE is reserved for Trader Outcome (Add Trade contract §4, §12, §16). **Current implementation pending migration:** System R still comes from planned price geometry or the Money-only Plan resolution kinds, and a System Win Rate is still computed from a Win/Loss/BE `system_outcome` (the approved metric is System Positive Rate). Actual R now divides by **Risk at Entry** on an Add Trade contract row (`recording_contract = 'add_trade_v1'`; At Entry since migration 0021, After Trade since migration 0023) and still divides by actual risk, or uses Price mode, on every legacy row. Save Closed Trade (After Trade) stores a trader-selected Trader Outcome — see §6.

**System Result and Trader Outcome are independent stored fields.** Never derive the System Result from actual profit or price, and never derive Trader Outcome from P&L or R under the approved contract. All four quadrants must be representable and must survive into analytics:

- positive System result / trader win
- positive System result / trader loss ← _the most valuable cell in the product_
- negative System result / trader loss
- negative System result / trader win _(made money by breaking the rules)_

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

### Approved Add Trade target semantics

[`docs/product-contracts/add-trade.md`](docs/product-contracts/add-trade.md) (approved v1) defines these rules. They govern new design and implementation work. Where the subsections below describe different behaviour, that behaviour is **current implementation pending migration**, not approved product behaviour.

- **Trader Outcome is trader-selected** — Win / BE / Loss / Unanswered. It is never classified from R or P&L sign, and the ±0.05R break-even tolerance does not decide it. A sign-contradicting choice is allowed with a quiet notice (contract §12).
- **Win / Loss / BE belongs to Trader Outcome only.** The System side is a trader-confirmed System Result in Money or R, No Trade, or Cannot Determine; canonical System Result buckets are Positive (> 0), Flat (= 0) and Negative (< 0) by exact numeric sign with no ±0.05R tolerance, reported as System Positive Rate and System Result Distribution — never as Win / Loss / BE (§16, §25).
- **Canonical R uses one baseline.** `Actual R = Final Net P&L / Risk at Entry` and `System R = System Result / Risk at Entry`, so System-vs-Actual comparison and Execution Impact are like-for-like (§4, §17). A System Result entered directly as R is valid while System Money is unknown; a gross-only System Result produces no Difference (§15).
- **Actual Risk is a separate Risk Discipline observation.** It never redefines canonical Actual R (§4).
- **Price is context.** Entry, SL, TP and exit prices never calculate new canonical P&L, Actual R, System R or Trader Outcome, and a Money/Price result-basis switch is not approved product behaviour (§3). A plausible price inconsistency such as a Long stop above Entry is a non-blocking data-quality notice; only malformed price input is an error (§3).
- **Final Net P&L is authoritative** for a closed Trade. Exit subtotals are supporting history, adopted only explicitly, and a Complete-history discrepancy is non-blocking (§11).
- **Review completion is an explicit lifecycle state** (Not Reviewed / Reviewed), never inferred from whether a review note exists (§20–21).
- **Missing observations are never negative observations.** Unanswered or unknown conditions, rules, emotions, risk, scope or outcomes never count as Not Met, a violation, zero, None or a loss (§2, §8, §24).
- **Legacy data keeps its provenance.** Legacy-derived Trader Outcomes, historical-Actual-Risk 1R baselines, Price-mode and `price_exit` results stay visible as legacy, and legacy R is excluded by default from canonical R analytics. Never manufacture canonical values from insufficient legacy evidence (§28).

### Current implementation pending migration

The running code predates the approved contract. Until the Add Trade migration lands, it still:

- derives `trader_outcome` from R with the ±0.05R band, or from P&L sign, enforced by `trades_status_consistency_check`, on every close except Save Closed Trade (After Trade), which since migration 0023 stores the trader's own Win / BE / Loss or Unanswered (`trader_outcome_selected_at`), and the contract Final Close (`recordContractExit`, migration 0027), which does the same for an Open contract Trade — but no UI calls it yet, so the live Trade Details close of an At Entry row still derives it, and canonical analytics treat that row's R as legacy evidence;
- computes Actual R as `net_pnl_minor / actual_initial_risk_minor`, or from Price-mode geometry (`actual_result_mode = 'price'`), **on legacy rows only** — a contract row created by At Entry divides by `planned_risk_minor` (Risk at Entry) through `actualRDenominatorMinor`;
- computes System R from planned price geometry or the Money-only Plan resolution kinds, and stores a Win/Loss/BE `system_outcome`;
- offers a Money/Price basis and a Price actual result in the live exit/close and execution-correction flows; At Entry and After Trade no longer do — both record price as context only, and neither asks a trader to confirm "unmet" Setup Conditions, because an unanswered condition was never a Not Met;
- derives a legacy live close's `net_pnl_minor` from exit legs (the contract Record Exit / Final Close service does not: a Part never writes a whole-Trade value, and All Remaining stores the stated Final Net P&L), and blocks a Complete-history exit conflict on a legacy row (After Trade treats Final Net P&L as authoritative, shows a Complete-history discrepancy as a non-blocking notice, and adopts the exit subtotal only explicitly);
- rejects a Stop or Target on the wrong side of Entry as a validation error in the legacy plan and execution paths (approved target, and At Entry / After Trade behaviour: a non-blocking data-quality notice, contract §3);
- treats a closed Trade with no `review_notes` as not reviewed.

Describe that behaviour accurately when working on it, and do not extend it as though it were approved. Replacing it requires an explicit migration/implementation task.

### Per-trade primitives

Let `direction ∈ {long, short}`.

```
riskPerUnit(entry, initialStop) =
    long  -> entry - initialStop
    short -> initialStop - entry
```

`riskPerUnit` must be **strictly positive**. A non-positive value means the stop is on the wrong side of entry — reject at validation, never silently proceed. _(Current implementation. Approved Add Trade target: price is context only, so a wrong-side stop is a non-blocking data-quality notice and price never becomes a denominator for canonical values — contract §3.)_

`riskPerUnit` is a price distance. It is **not** a route to a monetary risk amount.

```
netResult = grossPnL − commission − fees − swap                        [minor units]

actualR   = net_pnl_minor / actual_initial_risk_minor   [current implementation; approved target: Final Net P&L / Risk at Entry]
plannedR  = plannedRewardPerUnit / plannedRiskPerUnit
```

**Monetary risk is stored, never reconstructed from price × size.** `Trade.actual_initial_risk_minor` and `Trade.net_pnl_minor` (both `BIGINT` account-currency minor units) are the **authoritative** monetary inputs to Actual R. `riskPerUnit × positionSize × contractMultiplier` is **not** a valid substitute and must not be implemented: it does not hold across Forex, gold, crypto and indices, especially when the account currency differs from the quote currency — a pip value in JPY-quoted pairs, a per-contract multiplier for an index future, and a crypto position sized in the base asset do not reduce to one multiplication safely. The execution forms accept these authoritative amounts directly (registry-aware exact money parsing, or explicit raw minor units for an unknown currency); neither React nor the service derives them from price and quantity. `Trade.actual_entry`/`actual_exit`/`actual_position_size` remain informational `NUMERIC(20,10)` primitives, not R inputs. Locked in Phase 08; see `docs/calculation-spec.md` §_Initial risk amount — Actual is stored, not derived_.

**Phase 13E Journal V2 runtime (current implementation pending migration — the approved Add Trade contract does not permit Price-derived results for new canonical values):** Actual Result has an explicit persisted mode. Price mode derives `Actual R = SUM((closed_bps / 10000) × direction-aware leg R)` from actual entry, actual initial stop, and Exit prices without requiring or fabricating monetary risk/P&L. Money mode derives `Actual R = SUM(realized_pnl_minor) / actual_initial_risk_minor`, without weighting each already-realized P&L leg by closed fraction again. When both complete representations exist, Money is authoritative for Trader Performance and Price remains diagnostic context; no strict equality invariant is permitted. See `docs/phases/PHASE-13-journal-v2.md` §§3–4.

### System vs actual denominators — current implementation (superseded)

**Superseded by the approved Add Trade contract:** canonical System R and Actual R both divide by Risk at Entry, and a trader who takes more or less risk than intended is measured by Actual Risk as Risk Discipline. The bullets below describe the current implementation so it can be understood and migrated; they are not a reason to resist the approved migration.

- **System R** uses direction-aware `plannedEntry`/`plannedStop` geometry whenever that complete Price plan exists. For a Money-only Plan, Phase 13F resolves the counterfactual gross R as Target (`plannedRewardMinor / plannedRiskMinor`), Stop (`-1R`), Break Even (`0R`), or explicit Custom gross R, then subtracts `systemCostR`. It never reads Actual execution or `trade_exits`. It answers "what did the strategy offer?"
- **Actual R** is computed from the authoritative source selected by `actual_result_mode`: Price geometry or realized Money. It answers "what did the trader take?"

Both are expressed in R, which is precisely what makes them comparable even when the trader sized the position differently from the plan. That normalization is the point.

### Break-even

Never compare R to zero with `==`. In the **current implementation**, Trader and System outcomes are explicit, tolerance-banded classifications:

```
|R| <= breakEvenToleranceR  ->  BREAK_EVEN
```

`breakEvenToleranceR` is `BREAK_EVEN_TOLERANCE_R` (`'0.0500'`, `src/config/trade-calc.ts`) — **locked in Phase 07C as a global Calculation Engine Version 1 constant**, identical for every Workspace and every Trading Account, not per-workspace or per-trading-account configuration. A future engine version could introduce per-workspace/per-account tolerance as an explicit product decision; that would be a new `CALC_VERSION` and a new constant, not a mutation of this one.

**Approved target:** the tolerance no longer classifies Trader Outcome, which the trader selects (Add Trade contract §12), and canonical System Result buckets use the exact numeric sign — `+0.01R` Positive, `0R` Flat, `−0.01R` Negative — never this tolerance (§16). The classification above remains the current implementation until migration.

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

**Approved target:** classification-based aggregates read the trader-selected Trader Outcome and exclude Unanswered rather than counting it as a loss; R-based aggregates use canonical Risk-at-Entry R and exclude legacy R by default (Add Trade contract §25, §28). **Implemented for analytics reads (2026-09-17):** Dashboard, Analytics, Calendar, Day Review and insight populations are canonical-only through `src/server/dal/canonical-analytics-population.ts` — contract-row Money Actual R only; no outcome metric reads a derived outcome (Win Rate and its family count only trader-selected outcomes — today written by Save Closed Trade — and report `no_outcomes_answered` when none is in scope); no System, paired or Execution Gap figure exists until canonical System Results do; Net P&L still reads every closed Trade; excluded legacy evidence is disclosed as coverage. Since 2026-09-19 each figure reads only the evidence it needs: a selected outcome with no Risk at Entry counts in Win Rate and in no R figure, and a closed Trade with no final exit time counts in every total while only a date range, the calendar, the equity curve and drawdown leave it out (disclosed as undated coverage). See `docs/calculation-spec.md`, _Canonical analytics populations_. Canonical Trader Win Rate counts only trader-selected outcomes, excluding legacy-derived outcomes by default. Canonical System Positive Rate = Positive / eligible canonical System Results, excluding Not Assessed, No Trade, Cannot Determine, stale (Needs Review), gross-only (every gross-only result in v1 — Review & System Assessment contract, decision 47) and legacy results, with coverage reported rather than counted as negative. Today these aggregates read the current derived outcomes and stored R.

### Attribution metrics

```
executionGapR      = actualTotalR − systemTotalR
                     (negative = trader captured less than the System; positive = trader outperformed the System)

systemEdgeCaptured = actualTotalR / systemTotalR
                      defined only when systemTotalR > 0; otherwise null
                      (a ratio against a negative or zero system edge is meaningless, not merely undefined)
```

**Phase 13H runtime note (locked), with Dashboard D1 date contract:** the runtime implements `executionGapR` exactly as specified above — `src/lib/calc/attribution.ts`'s `executionGapR`/`pairedExecutionGapR`/`averageExecutionGapR` (renamed and sign-flipped from the retired `edgeLeakageR`/`pairedEdgeLeakageR`), `ComparisonAnalyticsModel.executionGapR`/`averageExecutionGapR`, every analytics/dashboard/marketing UI surface, demo fixtures, and EN/TH copy. `Average Execution Gap = AVG(actualR − systemR)` over the paired population is the primary **analytical** aggregate (`docs/phases/PHASE-13-journal-v2.md` §6); the summed total remains available alongside it. **Dashboard headline exception (explicit product decision, Execution Gap simplification pass):** the Dashboard's Execution Gap section shows the **summed** `executionGapR` as its one headline R figure, because the magnitude a trader acts on at a glance is "13.80R of paired edge given up", not a −0.22R per-Trade average. `averageExecutionGapR` is unchanged, still computed for every surface, and still on `DashboardExecutionComparison` — it is no longer a Dashboard headline, and nothing about either formula, the population, or the Analytics presentation changed. A bounded paired population is anchored only to Actual `exited_at`, ordered by Actual `exited_at` then Trade ID; `system_exited_at` remains required metadata but is not a second range gate. The captured-edge ratio is named **System Edge Captured**. No legacy-signed call site remains. **Canonical (Add Trade v1) System Edge Captured is deferred** by the Review & System Assessment contract §25: no approved contract defines its canonical population and edge cases, so the formula above describes the pre-contract runtime only and must not be applied to canonical System Results until one does.

**Discipline Score and mistake-cost attribution have no approved formula and remain unimplemented.** `config/mistakes.ts` contains a general severity-weight configuration and Phase 08 snapshots severity/weight historically, but neither fact authorizes a 0–100 penalty formula or allocation of one Trade's leakage across multiple Mistakes. Do not implement either without an explicit evidence-backed decision and non-double-counting policy.

---

## 7. Time

- Store every timestamp as `timestamptz`, **UTC**.
- Each user has an IANA timezone (`Asia/Bangkok`, etc.) on their profile.
- All display and all **date-bucketed analytics** (daily equity curve, calendar heatmaps) use the user's timezone. A trade closed 23:30 Bangkok belongs to that Bangkok day, not the UTC day.
- Never use the server's local timezone. Never use the browser's timezone as the source of truth.

---

## 8. UX standards

Modern professional SaaS. Not an admin template.

This section is the engineering baseline. Interaction and behaviour rules live in [`docs/UX_RULES.md`](docs/UX_RULES.md), below approved Product Contracts; visual expression lives in [`DESIGN.md`](DESIGN.md), implemented through the tokens and components in [`docs/design-system.md`](docs/design-system.md). Neither this baseline nor the visual system may simplify away an approved semantic or behaviour.

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

**Before modifying code:** read this file → read the approved Product Contract for the domain, if one exists → for user-facing work, read [`docs/UX_RULES.md`](docs/UX_RULES.md), then [`DESIGN.md`](DESIGN.md) and [`docs/design-system.md`](docs/design-system.md) → read the active phase document → inspect existing code and migrations → report the files likely to change. Do not rewrite unrelated code.

**After implementing:** format → lint → typecheck → unit tests → integration tests where relevant → production build. Then summarize changed files, document migrations, note unresolved risks, and make **one coherent commit** for the task.

**Never claim a check passed unless it was actually executed.** Report failures with their output.

**A defect that stops reproducing after an unrelated change has not been fixed — it has been reduced to a smaller set of inputs, and nothing records which ones.** Before calling a symptom gone, name the mechanism and say which input made it fire. A change that shrinks the trigger without being aimed at it will look exactly like a repair, in the diff and in a green suite, and the remainder goes unrecorded because nobody knew there was a remainder. Verified example: the Confidence knob's misplacement stopped reproducing at rest when a redesign gave the knob a fixed size, which silenced one of three writers to the same value; the other two survived for a further two weeks, one of them throwing the knob clean off the control on any phone rotation. See _the seventh false signal_ in [`docs/roadmap.md`](docs/roadmap.md).

**Read a test's assertions before trusting its name.** A suite can measure a value constantly and never judge it: geometry read to aim a gesture, a timing helper written to wait out a wobble, a bound asserted on one side only. Those are uses, not assertions, and a defect sitting in the difference stays green forever. Ask of any check: which observations drive the system, and which judge it?

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

| #   | Assumption                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decide by       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| A1  | **Locked in Phase 07C** — break-even tolerance `0.0500R`, a **global Calculation Engine Version 1 constant** (`BREAK_EVEN_TOLERANCE_R`, `src/config/trade-calc.ts`), identical for every Workspace and Trading Account — not per-trading-account configuration, superseding this row's original provisional wording. `trading_accounts` carries no override column, and none is planned for this engine version. **Superseded for Trader Outcome by the approved Add Trade contract (2026-09-14):** Trader Outcome is trader-selected; the constant still drives the current implementation until migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase 07C ✓     |
| A2  | **Partially locked in Phase 07B/07D** — the general severity-weight framework (minor 0.15 / moderate 0.35 / severe 0.60, `src/config/mistakes.ts`'s `MISTAKE_SEVERITY_WEIGHTS`) exists as declared config, but is deliberately **not** applied to the nine seeded system mistake types: the source documents name the nine types but define no evidence-backed relative severity, so Phase 07 MVP seeds every one with a single neutral default (`severity = 'moderate'`, `weight = 1.0000`) instead of inventing unjustified differentiation. A Discipline Score formula built on either framework remains unapproved and unimplemented (see §6's null-result discipline and `docs/calculation-spec.md` §5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 07B/D ✓   |
| A3  | **Locked in Phase 3C** — three monthly paid plans, gating exclusively on active trading-account count, with identical features and analytics: Starter (1 account, THB 149/USD 5), Trader (5 accounts, THB 299/USD 9), Professional (15 accounts, THB 499/USD 15). Every plan includes unlimited strategies, setups, trades, and trade history. Archived accounts do not count. Prices are tax-exclusive; VAT collection is disabled at launch because the business is not initially VAT registered. Superseded the Phase 01 provisional 1/3/10 starter/pro/elite draft. Registry: `src/config/plans.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 3C ✓      |
| A4  | **Locked in Phase 3C** — trial is 7 days, no card required, unlocks every feature, and grants exactly **1** active trading account — an explicit constant (`TRIAL_ACCOUNT_LIMIT`, `src/lib/entitlements/resolve.ts`), never derived from any paid plan's limit (not the highest, not Starter's, not `Math.max(...)`). Starts when workspace **onboarding completes** (`completeOnboarding`), not at first login — chosen so a trial is never consumed by an unverified account that never onboards, and so a trial-to-Starter conversion needs no account-count migration (both are exactly 1 account).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase 3C ✓      |
| A5  | Personal workspace auto-created on signup; team invites deferred post-MVP — **decided in Phase 02**: implemented via `ensurePersonalWorkspace()`, see [ADR 0011](docs/decisions/0011-tenant-workspace-authorization-model.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Phase 02 ✓      |
| A6  | Strategy versions are immutable once a trade references them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase 06        |
| A7  | **Locked in Phase 07B** — deleted Trades are soft-deleted via `trades.deleted_at`, the one deliberate exception to this codebase's otherwise-universal `is_archived` convention (a Trade is a personal record a trader may remove entirely from their own numbers, not a reversible business-lifecycle entity). No hard-delete flow exists or is planned.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Phase 07B ✓     |
| A8  | **Updated in Dashboard D1 shell follow-up** — Dark is the default; users may choose only Dark or Light. OS/System preference is not a product mode, and a legacy persisted `system` value migrates to Dark before paint. See `docs/design-system.md` §3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Phase 00b ✓     |
| A9  | **Locked in Phase 09** — demo fixtures carry no formulas, remain isolated to the labelled public `/demo` surface, and are never imported by authenticated `/app` or `/app/analytics`; see ADR 0006                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase 09 ✓      |
| A10 | Onboarding completion is workspace-scoped (`workspaces.onboarding_completed_at`), not user-scoped — a future team workspace completes onboarding once, for every member                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Phase 3B        |
| A11 | Active trading account is a per-user preference (`user_preferences.active_trading_account_id`), re-validated against the current active workspace on every read rather than trusted from the stored reference — no cross-workspace FK exists to enforce this at the database layer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase 3B        |
| A12 | `trading_accounts.base_currency` is an unconstrained (shape-validated only) ticker, not the closed fiat `CurrencyCode` registry — deliberately allows crypto (BTC, ETH, USDT, USDC) alongside fiat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Phase 3B        |
| A13 | **Enforced starting Phase 3C** — account-count entitlement limits (A3/A4) are now checked server-side inside `createTradingAccount`'s and `restoreTradingAccount`'s existing locked transactions (`src/server/services/entitlement.ts`'s `lockAndResolveEntitlement`, row-locked on `workspace_entitlements`); idempotency is checked before the limit, archive/edit/switch are never gated, and archived accounts never count toward the limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Phase 3C ✓      |
| A14 | Trading-account mutation authorization is centralized in one function (`requireTradingAccountManagement`, `src/server/auth/dal.ts`), currently requiring only the `'member'` role — this project's only role in active use is `'owner'` (ADR 0011), and nothing yet distinguishes owner-only vs member-permitted account actions; a future shared-workspace policy narrows this one call site, not every action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Phase 3C        |
| A15 | Trading-account creation idempotency is a client-generated UUID (`trading_accounts.mutation_key`) under a workspace-scoped unique index, not a separate idempotency-key table — chosen because the only mutation needing this guarantee is account creation, and the existing `INSERT ... ON CONFLICT DO NOTHING` idiom (`ensurePersonalWorkspace`) already covers it without new infrastructure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Phase 04 ✓      |
| A16 | Workspace entitlement state (`workspace_entitlements`: `status`, `plan_key`, `trial_started_at`, `trial_ends_at`, `current_period_ends_at`) lives in its own table, one row per workspace (unique-indexed), not folded into `workspaces` — mirrors the `trial_expired` effective status computed on read (`now >= trial_ends_at`) rather than a cron-updated persisted transition. `plan_key` values are exactly `starter`/`trader`/`professional` (migration `0004_rename_plan_keys_trader_professional` renamed the retired `pro`/`elite` draft keys and reinstalled the CHECK constraint); an unrecognized `plan_key` fails closed (blocks create/restore) rather than guessing a limit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Phase 3C ✓      |
| A17 | **Locked in Phase 04 ✓** — the only payment provider is a mock provider (`src/server/payments/mock-payment-provider.ts`) behind a narrow `PaymentProvider` interface; checkout, immutable billing snapshots, and `current_period_ends_at` maintenance are implemented (`src/server/services/checkout.ts`, `src/server/services/subscription-lifecycle.ts`). **Locked in Phase 04H-A** — the mock provider is reachable only in `development`/`test` `NODE_ENV`, or in production behind a guarded, CI-only automated-test seam requiring `E2E_TEST_MODE=true`, a loopback `BETTER_AUTH_URL`, and a trusted provisioned e2e identity (`src/config/billing-capability.server.ts`); ordinary production checkout returns `payment_provider_unavailable` and creates no billing row. Admin-only VAT configuration remains Phase 11's job. A real payment provider is still required before public paid activation can launch.                                                                                                                                                                                                                                                                                                                                                                                                                            | Phase 04 ✓      |
| A18 | VAT is disabled at launch because the business is not initially VAT registered. Future VAT is admin-only enable/disable with a configurable rate initially prepared as 7%, calculated exclusively on top of displayed prices. Disabled means no VAT line or notice. Enabled public notices are exactly TH `ราคาไม่รวมภาษีมูลค่าเพิ่ม 7%` and EN `Prices exclude 7% VAT.`; checkout shows subtotal/VAT/final total. Server configuration determines the rate and tax, calculations use integer minor units with deterministic rounding, and historical price/tax snapshots are immutable. **Locked in Phase 04 ✓** — conditional presentation, server-side calculation, and immutable snapshotting were implemented (`src/lib/billing/vat.ts`) with VAT disabled by default via a launch-fixture constant. **Locked in Phase 11F ✓** — the admin enable/disable UI (`/admin/vat`) and DB-authoritative runtime wiring are implemented: `platform_vat_configuration` (Phase 11B schema) is now the one production source (`src/server/services/platform-vat-configuration.ts`), read by every quotation/checkout/billing-presentation call site with no default fallback; `src/config/billing.server.ts`'s constant was renamed `VAT_CONFIGURATION_LAUNCH_FIXTURE` and is a test-fixture literal only. Only Phase 12's hardening verification remains. | 04 ✓, 11F ✓, 12 |

---

## Appendix A — Master instructions (verbatim)

The original commissioning brief, preserved unaltered. Sections 1–11 above are the working elaboration of it; this appendix is the source of truth for intent, except where an approved Product Contract in `docs/product-contracts/` covers a domain. For Add Trade that contract supersedes the appendix — notably a trader-selected Trader Outcome instead of tolerance classification, a common Risk-at-Entry baseline for Actual R and System R, and Win / Loss / BE reserved for Trader Outcome.

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
- System Edge Captured
- Execution Gap

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
