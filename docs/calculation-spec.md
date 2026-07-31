# Calculation Specification

**Status:** Specification. `src/lib/calc/` does not exist yet — it lands in Phase 07. This document is the contract that implementation must satisfy, and the reference its tests are written against.

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

### Initial risk amount

```
initialRiskAmount = riskPerUnit × positionSize × contractMultiplier    [minor units]
```

### Net result

```
netResult = grossPnL − commission − fees − swap                        [minor units]
```

Costs are always subtracted. A gross win can be a net loss, and the product must show that.

### R-multiples

```
plannedR = plannedRewardPerUnit / plannedRiskPerUnit
actualR  = netResult / actualInitialRiskAmount
systemR  = systemNetResult / plannedInitialRiskAmount
```

### Why system and actual use different denominators

This looks like a bug and is not. Do not "fix" it.

- **System R** uses `plannedEntry` and `plannedStop`. It answers: _what did the strategy offer?_
- **Actual R** uses `actualEntry` and `actualInitialStop`. It answers: _what did the trader take?_

Both are expressed in R, and that normalisation is precisely what makes them comparable when the trader sized differently from the plan. A trader who doubled their position shows up as edge leakage — which is the correct attribution — rather than as distorted system performance.

Comment this at the call site. A future contributor unifying the denominators would break the product's core measurement.

## 3. Break-even

```
|R| ≤ breakEvenToleranceR  →  BREAK_EVEN
```

`breakEvenToleranceR` is configured per trading account, defaulting to `0.05` (assumption A1).

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

Open trades and soft-deleted trades are excluded from every closed-trade aggregate.

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
