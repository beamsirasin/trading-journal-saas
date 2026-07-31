# Calculation Specification

**Status:** Specification only. `src/lib/calc/` does not exist yet — it lands in Phase 06. This document is the contract that implementation must satisfy, and the reference its tests are written against.

Every formula here must be implemented in `src/lib/calc/`, documented in code, and unit-tested including the edge cases listed. Analytics may never reimplement a formula inline.

---

## 1. Numeric rules

**Floating point is banned for financial values.**

| Quantity                                      | Storage                              | In TypeScript         |
| --------------------------------------------- | ------------------------------------ | --------------------- |
| Monetary amounts (P&L, fees, balances)        | `BIGINT` minor units + ISO-4217 code | `bigint`              |
| Instrument prices (entry, stop, target, exit) | `NUMERIC(20,10)`                     | `string` → decimal.js |
| R-multiples and ratios                        | `NUMERIC(12,4)`                      | decimal.js            |

Currency scale comes from a lookup, never a hardcoded `100` — JPY has zero minor decimals. Rounding happens once, at the presentation boundary, never mid-calculation.

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
