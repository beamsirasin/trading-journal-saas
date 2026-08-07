# Phase 07 — Trade Model & Calculation Engine

**Depends on:** 06 · **Blocks:** 08, 09

**Status:** 07A (repository audit) and 07B (trade domain and discipline schema) are complete — the `trades`/`mistake_types`/`trade_mistakes`/`trade_rule_checks` schema below is real, migrated (`drizzle/0008_trade_domain_and_discipline.sql`), and guarded-PostgreSQL-tested. No service, DAL, Server Action, UI, or `src/lib/calc/` calculation function exists yet — that is 07C onward. The schema below reflects what was actually built, correcting the pre-implementation sketch this document originally carried (see the Phase 07A audit for the itemized mismatches: a missing Setup/Setup Version link, a stale `checklist_item_id`/`trade_checklist_results` design, a `price × quantity × contract multiplier` monetary formula abandoned as not universally valid, and an undifferentiated System "pending vs. never-would-have-happened" state).

## Goal

The trade schema and a **pure, deterministic, exhaustively tested** calculation engine. No UI in this phase. Every number the product ever shows originates here.

This is the phase that makes the product's core claim credible. If the engine is wrong, everything downstream is confidently wrong.

## Scope

### Trade schema (Phase 07B — implemented)

One Trade is one complete trading idea/position — never a single execution, never a multi-leg composite. No partial entries, partial exits, scale-in/scale-out, or `trade_executions` child table exist; the shape below deliberately keeps that door open for later without needing to change today.

Every normal Trade pins its full decision framework at creation — Trading Account, Strategy, the exact Strategy Version, Setup, and the exact Setup Version — all five **non-nullable**. A general-purpose Strategy uses an explicit "General Setup"-style Setup rather than a nullable Setup reference, so every Trade preserves one exact, unambiguous historical snapshot. The system/actual/planned separation is expressed structurally — three parallel sets of columns, none derived from the others.

```
trades
  id workspace_id mutation_key
  trading_account_id strategy_id strategy_version_id setup_id setup_version_id

  symbol direction ∈ { long, short }
  timeframe session confirmation_notes confidence(1..5) tradingview_url notes

  -- PLAN (the system's proposal) — entry/stop required from creation
  planned_entry planned_stop planned_target        NUMERIC(20,10)
  planned_position_size                            NUMERIC(20,10)  (informational only)

  -- ACTUAL (what the trader did) — actual_initial_stop is the stop AS FIRST PLACED, never as later moved
  actual_entry actual_initial_stop actual_exit     NUMERIC(20,10)
  actual_position_size                             NUMERIC(20,10)  (informational only)
  entered_at exited_at                             timestamptz

  -- AUTHORITATIVE MONEY (BIGINT minor units, account currency) — see below
  actual_initial_risk_minor gross_pnl_minor net_pnl_minor
  commission_minor fees_minor swap_minor

  -- SYSTEM COUNTERFACTUAL — independent lifecycle from Trade execution status
  system_status ∈ { pending, resolved, no_trade }
  system_exit_price system_exited_at
  system_exit_reason ∈ { target_hit, stop_hit, break_even_rule, trailing_exit,
                          time_exit, rule_exit, manual_system_valid_exit, setup_invalidated }
  system_cost_r                                    NUMERIC(12,4), >= 0, default 0
  system_resolved_at

  -- DERIVED, persisted at compute time, never client-supplied
  planned_r actual_r system_r                      NUMERIC(12,4)
  trader_outcome system_outcome ∈ { win, loss, break_even }
  calc_version                                     integer

  status ∈ { planned, open, closed, canceled }
  followed_plan(bool) deleted_at created_at updated_at
```

**Authoritative monetary source of truth.** `actual_initial_risk_minor` and `net_pnl_minor` — not `price × quantity × contract multiplier` — are what Actual R is computed from. That formula is not universally valid across Forex, gold, crypto and indices, especially when account currency differs from quote currency; prices/quantity/position-size columns above are informational primitives only, never authoritative monetary inputs.

**`system_cost_r` semantics are locked (Phase 07B correction): `systemR = systemGrossR − systemCostR`.** `system_cost_r` is a user-supplied estimate of costs attributable to the counterfactual System execution, expressed directly in R, non-negative, default `0`, supplied only when _resolving_ the System result — it is never automatically copied from Actual `commission_minor`/`fees_minor`/`swap_minor`, and never calculated from a per-account cost constant in MVP.

**System status is a third, independent lifecycle**, distinct from `status` (Trade execution) and from `trader_outcome`/`system_outcome` (classification). `pending` (no System R/outcome yet) is not the same state as `no_trade` (the approved Strategy/Setup would not have permitted the Trade at all) — collapsing these was the exact defect the Phase 07A audit found in this document's original sketch. `setup_invalidated` is valid only under `system_status = 'no_trade'`; every other exit reason belongs only to `resolved`. There is no `still_open` exit reason — an unresolved System counterfactual is `system_status = 'pending'` with null terminal fields, not a reason describing an in-progress market. `system_cost_r` is pinned to exactly `0` under both `pending` and `no_trade` — it is meaningless before a System result is resolved, and there is no counterfactual execution to attribute a cost to when there was no trade at all. `resolved` additionally requires `system_r`/`system_outcome` to be present — resolving the System result and computing its R/outcome are one atomic requirement, not two separable steps. Database `CHECK` constraints make every impossible combination of these fields unrepresentable (`drizzle/0008_trade_domain_and_discipline.sql`'s `trades_system_status_consistency_check`).

**Trade execution status** (`planned`/`open`/`closed`/`canceled` — American spelling) is separately consistency-checked: each status requires or forbids an exact set of actual-execution fields (`trades_status_consistency_check`), so e.g. a `closed` Trade cannot exist without `actual_exit`/`net_pnl_minor`/`exited_at`/`actual_r`/`trader_outcome`. There is deliberately no `invalidated` Trade status — an idea that should never have been taken is represented on the System axis (`system_status = 'no_trade'`), never as an execution state of its own. `canceled` is unconstrained in shape and excluded from Trader metrics by query, not by schema.

```
mistake_types    id workspace_id(nullable) key label
                 severity ∈ { minor, moderate, severe }  default_weight
                 is_system(bool) is_archived(bool) sort_order

trade_mistakes   trade_id mistake_type_id workspace_id note
                 severity_at_time weight_at_time (snapshotted)
                 PRIMARY KEY(trade_id, mistake_type_id)

trade_rule_checks   id workspace_id trade_id
                     strategy_rule_id strategy_version_id rule_key (all three jointly FK-verified)
                     check_status ∈ { followed, violated, not_applicable, not_checked }
                     title category is_required is_pre_trade_check sort_order (all snapshotted)
```

A seeded mistake taxonomy ships as `is_system` rows (moved stop, early exit, oversized position, no setup, revenge trade, chased entry, ignored invalidation, moved target, no stop) — `workspace_id IS NULL`, globally shared, archive-only lifecycle. **Every one of the nine is seeded with one deliberately neutral default: `severity = 'moderate'`, `default_weight = '1.0000'`** (Phase 07B correction). The source documents name these nine types but define no evidence-backed relative severity or weight; rather than silently inventing differentiated weights with no evidentiary basis, Phase 07 MVP treats them as equally weighted, pending a later phase's explicit, evidence-backed differentiation decision. `mistake_types.default_weight`/`trade_mistakes.weight_at_time` are `NUMERIC(12,4)` (the CLAUDE.md §5 R-multiple precision, not an arbitrary shorter scale) precisely so `1.0000` is stored exactly, not rounded. `src/config/mistakes.ts`'s `MISTAKE_SEVERITY_WEIGHTS` (minor `0.15` / moderate `0.35` / severe `0.60`) remains a separate, general severity → weight framework — reserved for a future differentiated-weighting decision, not applied to these nine rows. Workspaces may add their own custom types (`workspace_id` set, unique per workspace) in a later phase; the schema already supports it. `trade_rule_checks` replaces the stale `trade_checklist_results(trade_id, checklist_item_id, was_satisfied)` sketch — Phase 06 never built a separate "checklist item" entity, and a boolean cannot distinguish "genuinely inapplicable" from "never reviewed" the way the four-value `check_status` does. Both `strategy_rule_id` (the exact Rule row in the pinned Version) and `rule_key` (the stable identity that survives copy-on-write) are stored, and a composite foreign key against `strategy_rules(id, strategy_version_id, rule_key)` guarantees they are mutually consistent with one real row. Category/title/required/pre-trade-check/sort-order are snapshotted at check-save time, the same "a later rename never rewrites what a past trade meant" pattern `strategy_setup_versions` already established.

### Why derived values are persisted

`actual_r` could be recomputed on read. It is stored anyway, because:

- Analytics over thousands of trades must not recompute decimals per row
- A later engine fix must not silently rewrite historical numbers
- Recomputation is explicit, versioned, and auditable

Persisted values carry `calc_version`. A backfill migration is the only thing that may change them, and it is deliberate.

### The engine (`src/lib/calc/`)

Pure functions. No database, no I/O, no `Date.now()`, no globals. Input: plain data. Output: plain data. This is what makes it testable and trustworthy.

```
risk.ts        riskPerUnit, initialRiskAmount
trade.ts       plannedR, actualR, systemR, classifyOutcome
aggregate.ts   winRate, avgR, expectancy, profitFactor, totalR, maxDrawdownR
attribution.ts edgeLeakage, executionEfficiency, disciplineScore
equity.ts      equityCurveR, drawdownSeries
```

All arithmetic via `decimal.js` (prices, R) and `bigint` (money). A JS `number` in a financial path is a bug.

### Formulas

Canonical definitions live in `CLAUDE.md` §6. Implementation notes:

**Risk per unit** — `long: entry − stop`, `short: stop − entry`. Must be **strictly positive**; non-positive means the stop is on the wrong side of entry. Reject at validation. Never proceed with a negative denominator.

**System R uses planned inputs; actual R uses actual inputs.** Different denominators, deliberately (`CLAUDE.md` §6). Both are in R, which is exactly what makes them comparable when the trader sized differently from plan. Trader size errors show up as edge leakage, not as distorted system performance.

**Break-even** — `|R| ≤ breakEvenToleranceR`. `breakEvenToleranceR` is `src/config/trade-calc.ts`'s `BREAK_EVEN_TOLERANCE_R` (`'0.0500'`) — a **global Calculation Engine Version 1 constant**, identical for every Workspace and Trading Account, not per-trading-account configuration. Never `== 0`.

**Profit factor** — `Σ R⁺ / |Σ R⁻|`. Zero losses returns `null` with reason `no_losing_trades`, **never `Infinity`**, never a fake large number.

**Max drawdown in R** — running peak of cumulative R; `max(peak − current)`. Reported as a positive magnitude.

**Edge leakage** — `systemTotalR − actualTotalR`. Positive = trader destroyed edge. Negative is meaningful and must not be clamped: it means the trader added value by deviating, which is itself a finding worth surfacing.

**Execution efficiency** — `actualTotalR / systemTotalR`, defined **only when `systemTotalR > 0`**. Against a zero or negative system edge the ratio is not merely undefined, it is misleading — return `null` with reason `system_has_no_edge`.

**Discipline score** — `100 × (1 − mean(perTradePenalty))`, `perTradePenalty = min(1, Σ severityWeight)`, weights in `src/config/mistakes.ts` (minor 0.15 / moderate 0.35 / severe 0.60). Unsatisfied _required_ checklist items contribute a `minor` penalty each.

### Null-result discipline

Every aggregate returns a discriminated result, never a silent zero:

```ts
type CalcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: 'no_trades' | 'no_losing_trades' | 'system_has_no_edge' | 'insufficient_data';
    };
```

`NaN`, `Infinity`, and "0 means no data" are all forbidden. The UI renders the reason, so an empty dashboard explains itself instead of claiming a 0% win rate.

### Test coverage (the real deliverable)

- Golden-set fixtures: hand-computed trades, long and short, verified by hand before coding
- Every quadrant of the system × trader outcome matrix
- Boundary cases: exactly at break-even tolerance, one tick either side
- Degenerate: zero trades, all wins, all losses, single trade, zero-risk rejection, stop on wrong side
- Costs: fees/commission/swap flipping a gross win into a net loss
- Precision: 5-decimal FX, JPY pairs (2 decimals), crypto (8 decimals), JPY account currency (0 minor decimals)
- Property-based: `totalR == Σ R` across random valid sets; drawdown never negative; efficiency ∈ expected bounds
- Determinism: identical input → byte-identical output across runs

## Out of scope

Any UI, any query layer, any chart. This phase produces functions and tables only.

## Deliverables

```
src/server/db/schema/{trades,mistake-types,trade-mistakes,trade-rule-checks}.ts   [07B — done]
src/lib/trades/constants.ts                                                        [07B — done]
src/config/{mistakes,trade-calc}.ts                                                [07B — done]
drizzle/0008_trade_domain_and_discipline.sql                                       [07B — done]
src/server/db/schema/trade-domain{,-migration}.integration.test.ts                 [07B — done]

src/lib/calc/{risk,trade,aggregate,attribution,equity,types}.ts                    [07C/07D — pending]
tests/calc/**  (golden fixtures + property tests)                                  [07C/07D — pending]
docs/formulas.md                                                                   [07E — pending]
```

## Definition of Done

- [ ] Every formula documented in code with its definition
- [ ] Golden-set fixtures hand-verified before implementation
- [ ] All four outcome quadrants representable and tested
- [ ] No `number` arithmetic in any financial path (lint rule or explicit review)
- [ ] No `NaN` or `Infinity` reachable from any exported function
- [ ] Break-even uses configured tolerance; no equality-to-zero comparison exists
- [ ] Determinism test passes
- [ ] Coverage of `src/lib/calc/` ≥ 95%
- [ ] Typecheck, lint, tests, build pass

## Assumptions

- **A1** break-even tolerance `0.0500R` — declared in `src/config/trade-calc.ts`'s `BREAK_EVEN_TOLERANCE_R` (07B, corrected). This is a **global Calculation Engine Version 1 constant**, identical for every Workspace and Trading Account — not workspace-wide configuration, not a database column, not user-configurable during the MVP. `trading_accounts` has no per-account override column (see `docs/data-dictionary.md`'s note on `break_even_tolerance_r`), and none is planned for this engine version.
- **A2** severity weights (minor 0.15 / moderate 0.35 / severe 0.60) — declared in `src/config/mistakes.ts`'s `MISTAKE_SEVERITY_WEIGHTS` (07B), a general framework **not applied** to the nine canonical system types (see below). Every one of the nine is seeded with a single deliberately neutral default instead: `severity = 'moderate'`, `default_weight = '1.0000'` (07B correction) — the source documents name the nine types but define no evidence-backed relative severity or weight, so Phase 07 MVP does not invent one.
- **A7** soft-delete trades — implemented (07B): `trades.deleted_at`, the one deliberate exception to this codebase's otherwise-universal `is_archived` convention.
- **New (07B):** `calc_version` defaults to `src/config/trade-calc.ts`'s `CALC_VERSION` (`1`), stored on every Trade from creation, not only "at close" — a `planned` Trade has no derived R yet, but the column exists uniformly.

## Risks

- **`system_exit_price` requires trader honesty.** The counterfactual is self-reported; the product cannot verify it. Phase 08 UI must make it easy and neutral to record truthfully, and the docs should be candid that garbage in yields garbage attribution.
- **`system_cost_r` semantics are resolved (07B correction), not an open question.** `systemR = systemGrossR − systemCostR`. `system_cost_r` is a user-supplied estimate of costs attributable to the counterfactual System execution, expressed directly in R, non-negative, default `0`, supplied only when resolving the System result — never automatically copied from Actual costs, never calculated from a per-account cost constant in MVP. `trades_system_status_consistency_check` enforces `system_cost_r = 0` under `pending`/`no_trade` and `system_r`/`system_outcome` presence under `resolved`. Phase 07C's `systemR` implementation reads this column directly; no further product decision is pending here.
- **Denominator asymmetry is counterintuitive.** Documented above and in `docs/formulas.md`; a future contributor "fixing" it to a shared denominator would break the core measurement. Comment it at the call site.
- **Persisted derived values drift** if the engine changes. `calc_version` plus an explicit backfill is the only sanctioned path.
- **Multi-currency accounts** are out of scope. One currency per trading account; the engine assumes it.
- **Deterministic Actual/System ordering** for sequence calculations (equity curves, drawdown) is `exited_at`, tie-broken by `id` (UUIDv7 sorts chronologically as a secondary key) — recorded here so 07C's `equity.ts` does not need to re-derive it; not yet exercised by any query since no query layer exists in this phase.
