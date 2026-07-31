# Phase 07 — Trade Model & Calculation Engine

**Depends on:** 06 · **Blocks:** 08, 09

## Goal

The trade schema and a **pure, deterministic, exhaustively tested** calculation engine. No UI in this phase. Every number the product ever shows originates here.

This is the phase that makes the product's core claim credible. If the engine is wrong, everything downstream is confidently wrong.

## Scope

### Trade schema

The system/actual separation is expressed structurally — two parallel sets of columns, neither derived from the other.

```
trades
  id workspace_id trading_account_id strategy_id strategy_version_id
  symbol direction ∈ { long, short }
  status  ∈ { planned, open, closed, cancelled }

  -- PLAN (the system's proposal)
  planned_entry planned_stop planned_target        NUMERIC(20,10)
  planned_position_size                            NUMERIC(20,10)

  -- ACTUAL (what the trader did)
  actual_entry actual_initial_stop actual_exit     NUMERIC(20,10)
  position_size contract_multiplier                NUMERIC(20,10)
  entered_at exited_at                             timestamptz

  -- SYSTEM COUNTERFACTUAL (what the rules would have produced)
  system_exit_price                                NUMERIC(20,10)
  system_outcome ∈ { win, loss, break_even, no_trade }
  system_exit_reason ∈ { target_hit, stop_hit, rule_exit, still_open }

  -- COSTS  (BIGINT minor units, account currency)
  commission fees swap

  -- DERIVED, persisted at close (see "Why persist" below)
  initial_risk_amount gross_pnl net_pnl            BIGINT
  planned_r system_r actual_r                      NUMERIC(12,4)
  trader_outcome ∈ { win, loss, break_even }

  followed_plan(bool) confidence(1..5)
  tradingview_url notes
  created_at updated_at deleted_at
```

```
mistake_types    id workspace_id key label
                 severity ∈ { minor, moderate, severe }
                 is_system(bool) sort_order

trade_mistakes   trade_id mistake_type_id note
                 PRIMARY KEY(trade_id, mistake_type_id)

trade_checklist_results   trade_id checklist_item_id was_satisfied
```

A seeded mistake taxonomy ships as `is_system` rows (moved stop, early exit, oversized, no setup, revenge trade, chased entry, ignored invalidation, moved target, no stop). Workspaces may add their own.

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

**Break-even** — `|R| ≤ breakEvenToleranceR` (per trading account, default 0.05). Never `== 0`.

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
src/server/db/schema/{trades,mistakes,trade-mistakes,checklist-results}.ts
src/lib/calc/{risk,trade,aggregate,attribution,equity,types}.ts
src/config/mistakes.ts
drizzle/0006_trades.sql   drizzle/0007_mistake_taxonomy_seed.sql
tests/calc/**  (golden fixtures + property tests)
docs/formulas.md
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

- **A1** break-even 0.05R · **A2** severity weights · **A7** soft-delete trades

## Risks

- **`system_exit_price` requires trader honesty.** The counterfactual is self-reported; the product cannot verify it. Phase 07 UI must make it easy and neutral to record truthfully, and the docs should be candid that garbage in yields garbage attribution.
- **Denominator asymmetry is counterintuitive.** Documented above and in `docs/formulas.md`; a future contributor "fixing" it to a shared denominator would break the core measurement. Comment it at the call site.
- **Persisted derived values drift** if the engine changes. `calc_version` plus an explicit backfill is the only sanctioned path.
- **Multi-currency accounts** are out of scope. One currency per trading account; the engine assumes it.
