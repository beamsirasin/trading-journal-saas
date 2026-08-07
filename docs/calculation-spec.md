# Calculation Specification

**Status:** Specification. `src/lib/calc/` does not exist yet — it lands in Phase 07C/D. The `trades` schema this document's formulas read from is real as of Phase 07B (`drizzle/0008_trade_domain_and_discipline.sql`); this document is the contract the engine implementation must satisfy against that schema, and the reference its tests are written against.

**Implemented in Phase 00b:** the money and time primitives the engine builds on — [`src/lib/money/`](../src/lib/money/) and [`src/lib/time/`](../src/lib/time/). See [ADR 0002](decisions/0002-money-representation.md) and [ADR 0003](decisions/0003-time-model.md).

Every formula here must be implemented in `src/lib/calc/`, documented in code, and unit-tested including the edge cases listed. Analytics may never reimplement a formula inline.

---

## 1. Numeric rules

**Floating point is banned for financial values.**

| Quantity                                      | Storage                              | In TypeScript         | Status       |
| --------------------------------------------- | ------------------------------------ | --------------------- | ------------ |
| Monetary amounts (P&L, fees, balances)        | `BIGINT` minor units + ISO-4217 code | `bigint`              | ✅ Phase 00b |
| Instrument prices (entry, stop, target, exit) | `NUMERIC(20,10)`                     | `string` → decimal.js | Phase 07     |
| R-multiples and ratios                        | `NUMERIC(12,4)`                      | decimal.js            | Phase 07     |

Currency scale comes from a lookup, never a hardcoded `100` — JPY, KRW, VND and IDR have zero minor decimals. Rounding happens once, at the presentation boundary, never mid-calculation.

**`decimal.js` is not yet a dependency.** Minor units in `bigint` are exact by construction, and the money module's parsing and formatting use string arithmetic with no intermediate `Number`. The library becomes justified in Phase 07, when `NUMERIC(20,10)` prices arrive — `1.08532` has no minor-unit representation and genuinely needs arbitrary-precision decimal arithmetic.

**Available now:** `add`, `subtract`, `negate`, `absolute`, `sum`, `compare`, `equals`, and predicates. Mixing currencies is an error, never a silent coercion.

**Deliberately absent:** multiplication, division, percentages. Each needs a rounding rule tied to a specific formula, so they belong in the engine rather than in a general-purpose money helper.

### Reading money and time at the boundary

```ts
import { formatMoney, parseMoney } from '@/lib/money';
import { calendarDateIn, dayRangeIn } from '@/lib/time';

// User input -> storage. Rejects rather than rounding silently.
const parsed = parseMoney('1,234.56', 'USD'); // -> 123456n

// Which day does this trade belong to, for the user's timezone?
const day = calendarDateIn(trade.exitedAt, user.timezone);

// Half-open [start, end) range for a day's query.
const range = dayRangeIn('2026-07-31', user.timezone);
```

Every one of these returns a discriminated result. There is no throwing variant, because these failures are routine rather than exceptional.

## 2. Per-trade primitives

### Risk per unit

```
long:  riskPerUnit = entry − initialStop
short: riskPerUnit = initialStop − entry
```

**Must be strictly positive.** A non-positive value means the stop sits on the wrong side of the entry. Reject it at validation with a plain-language error. Never proceed — a negative denominator silently inverts every downstream sign.

### Initial risk amount — Actual is stored, not derived

`Trade.actual_initial_risk_minor` and `Trade.net_pnl_minor` (both `BIGINT` account-currency minor units) are the **authoritative** monetary inputs to Actual R — never `riskPerUnit × positionSize × contractMultiplier`. That formula is not universally valid across Forex, gold, crypto and indices, especially when account currency differs from quote currency; a pip value in JPY-quoted pairs, a per-contract multiplier for an index future, and a crypto position sized in the base asset do not reduce to one multiplication safely. Phase 08's entry form computes and stores `actual_initial_risk_minor`/`net_pnl_minor` directly (however it derives them for a given instrument — that derivation is Phase 08's job, not the engine's); `src/lib/calc/` only ever reads these two stored bigints, never recomputes them from price/quantity. `Trade.actual_entry`/`actual_exit`/`actual_position_size` remain stored as informational primitives (`NUMERIC(20,10)`) for display and audit, but are not inputs to any R formula.

**Planned R has no such ambiguity** — it is a pure per-unit price ratio and never touches position size or account currency at all (below).

### Net result

```
netResult = grossPnL − commission − fees − swap                        [minor units]
```

`Trade.gross_pnl_minor` is an optional persisted snapshot for transparency; `net_pnl_minor` (see above) is what `actualR` actually divides.

Costs are always subtracted. A gross win can be a net loss, and the product must show that.

### R-multiples

```
plannedR = (plannedTarget − plannedEntry) / (plannedEntry − plannedStop)              [long]
         = (plannedEntry − plannedTarget) / (plannedStop − plannedEntry)              [short]

actualR  = netPnlMinor / actualInitialRiskMinor

systemGrossR = (systemExitPrice − plannedEntry) / (plannedEntry − plannedStop)        [long]
             = (plannedEntry − systemExitPrice) / (plannedStop − plannedEntry)        [short]
             (same denominator shape as plannedR, using the resolved systemExitPrice
              in place of plannedTarget)

systemR  = systemGrossR − systemCostR
         (locked formula, Phase 07B correction — `system_cost_r` is a
          user-supplied cost estimate expressed directly in R, subtracted
          without any currency conversion; see "System cost semantics" below)
```

`plannedR` is undefined (`null`) whenever `Trade.planned_target` is absent — a Trade may legitimately have a planned entry/stop without a committed target.

### Why system and actual use different denominators

This looks like a bug and is not. Do not "fix" it.

- **System R** uses `plannedEntry` and `plannedStop`. It answers: _what did the strategy offer?_
- **Actual R** uses `actualEntry` and `actualInitialStop`. It answers: _what did the trader take?_

Both are expressed in R, and that normalisation is precisely what makes them comparable when the trader sized differently from the plan. A trader who doubled their position shows up as edge leakage — which is the correct attribution — rather than as distorted system performance.

### System cost semantics (locked, Phase 07B correction)

`Trade.system_cost_r` is a **user-supplied** estimate of costs attributable to the counterfactual System execution, expressed directly in R:

- Non-negative, default `0`.
- Supplied only when _resolving_ the System result (`system_status = 'pending' → 'resolved'`) — meaningless before resolution, so it is database-pinned to exactly `0` under both `pending` and `no_trade` (`trades_system_status_consistency_check`).
- **Never** automatically copied from Actual `commission_minor`/`fees_minor`/`swap_minor` — the System counterfactual's costs are not assumed to equal what the trader actually paid.
- **Never** calculated from a per-account modelled cost constant in MVP — there is no such constant; the trader estimates it directly, the same self-reported posture the rest of the System counterfactual already has (product-spec §8's "known limitation").

This was an open question in an earlier draft of this document; it is resolved as of Phase 07B and does not need revisiting in Phase 07C.

Comment this at the call site. A future contributor unifying the denominators would break the product's core measurement.

## 3. Break-even

```
|R| ≤ breakEvenToleranceR  →  BREAK_EVEN
```

`breakEvenToleranceR` is `'0.0500'` (assumption A1), declared as `src/config/trade-calc.ts`'s `BREAK_EVEN_TOLERANCE_R` constant — a **global Calculation Engine Version 1 constant** (Phase 07B correction), identical for every Workspace and every Trading Account. It is not workspace-wide configuration, not a database column, and not user-configurable during the MVP: `trading_accounts` has no `break_even_tolerance_r` column (see `docs/data-dictionary.md`'s note on that table), and none is planned for this engine version. A future calculation-engine version could introduce per-workspace or per-account tolerance as an explicit product decision — that would be a new `CALC_VERSION` and a new constant, not a mutation of this one.

**Never compare to zero with `==`.** After costs, an exact zero is vanishingly rare, so equality would classify almost every scratched trade as a win or a loss.

## 4. Aggregates

```
winRate      = wins / closedTrades      (break-evens are excluded from the
                                         numerator, included in the denominator)
avgR         = mean(R)
expectancy   = mean(R)                  (equivalently winRate·avgWinR − lossRate·|avgLossR|)
totalR       = Σ R
profitFactor = Σ R⁺ / |Σ R⁻|
maxDrawdownR = max over t of (runningPeak(ΣR) − ΣR at t)     (positive magnitude)
```

Open trades and soft-deleted trades (`Trade.deleted_at IS NOT NULL`) are excluded from every closed-trade aggregate. `canceled` trades are excluded from every Trader-performance aggregate (a locked Phase 07B product decision) — this is a query-level filter, not a schema-shape constraint, since `Trade.status = 'canceled'` deliberately leaves every other field unconstrained.

**Deterministic ordering.** Sequence calculations (equity curves, drawdown) order the closed-trade set by `Trade.exited_at`, tie-broken by `Trade.id` — UUIDv7 sorts chronologically as a secondary key (`src/lib/identifiers.ts`). Both the Actual and System series plot against this one shared per-trade ordering (matching `DemoEquityPoint`'s one-label/two-values shape in `src/lib/demo/types.ts`), never two independently-ordered series by `exited_at` vs `system_exited_at` — a System counterfactual that resolved on a different date from the actual close is still compared trade-for-trade, not re-sequenced by its own resolution time.

## 5. Attribution metrics

```
edgeLeakageR        = systemTotalR − actualTotalR
executionEfficiency = actualTotalR / systemTotalR       (only when systemTotalR > 0)
disciplineScore     = 100 × (1 − mean(perTradePenalty))
perTradePenalty     = min(1, Σ severityWeight(mistake))
```

**Edge leakage** positive means the trader destroyed edge. Negative means the trader added value by deviating from the rules — a real and interesting finding. **Do not clamp it to zero.**

**Execution efficiency** is undefined when `systemTotalR ≤ 0`. Against a zero or negative system edge the ratio is not merely undefined, it is actively misleading: capturing 50% of a losing system is not a 50% score. Return `null` with reason `system_has_no_edge`.

**Severity weights** live in `src/config/mistakes.ts` (assumption A2):

| Severity | Weight |
| -------- | ------ |
| minor    | 0.15   |
| moderate | 0.35   |
| severe   | 0.60   |

A required-but-unsatisfied setup-checklist item contributes one `minor` penalty.

## 6. Null-result discipline

Every aggregate returns a discriminated result:

```ts
type CalcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: 'no_trades' | 'no_losing_trades' | 'system_has_no_edge' | 'insufficient_data';
    };
```

`NaN`, `Infinity`, and "0 means no data" are all forbidden.

A dashboard showing `0%` win rate for a user with no trades is stating something false. Showing "no closed trades yet" is stating something true. The type system should make the false version hard to write.

| Situation                                 | Result                                        |
| ----------------------------------------- | --------------------------------------------- |
| No closed trades                          | `{ ok: false, reason: 'no_trades' }`          |
| No losing trades (profit factor)          | `{ ok: false, reason: 'no_losing_trades' }`   |
| `systemTotalR ≤ 0` (execution efficiency) | `{ ok: false, reason: 'system_has_no_edge' }` |
| Below the verdict sample threshold        | `{ ok: false, reason: 'insufficient_data' }`  |

## 7. Required test coverage

- **Golden fixtures** — trades computed by hand, long and short, verified before the implementation is written.
- **All four outcome quadrants** — including system loss / trader win.
- **Boundaries** — exactly at the break-even tolerance, and one tick either side.
- **Degenerate inputs** — zero trades, all wins, all losses, a single trade, zero risk, stop on the wrong side.
- **Costs** — fees turning a gross win into a net loss.
- **Precision** — 5-decimal FX, JPY pairs at 2 decimals, crypto at 8 decimals, and a JPY account currency with zero minor decimals.
- **Property-based** — `totalR == Σ R` over random valid sets; drawdown never negative.
- **Determinism** — identical input produces byte-identical output across runs.

Target: ≥ 95% coverage of `src/lib/calc/`, with no `number` arithmetic anywhere in a financial path.

## 8. Worked example

A long trade, account in USD.

```
plannedEntry  1.08500     actualEntry   1.08540    (0.4 pip slippage)
plannedStop   1.08000     actualStop    1.08000
plannedTarget 1.09500     actualExit    1.08900    (exited early)
positionSize  100,000     commission    $7.00

plannedRiskPerUnit = 1.08500 − 1.08000 = 0.00500
plannedR (target)  = 0.01000 / 0.00500 = +2.00R

actualRiskPerUnit  = 1.08540 − 1.08000 = 0.00540
actualRiskAmount   = 0.00540 × 100,000 = $540.00      (54000 minor units)
grossPnL           = (1.08900 − 1.08540) × 100,000 = $360.00
netResult          = $360.00 − $7.00 = $353.00        (35300 minor units)
actualR            = 35300 / 54000 = +0.6537R

systemExit (target hit per rules) → systemR = +2.00R (less modelled costs)

edgeLeakage on this trade = 2.00 − 0.65 = 1.35R
```

The trade was profitable. The trader still gave up 1.35R against the system by exiting early — which a P&L-only journal would report as an unqualified win.
