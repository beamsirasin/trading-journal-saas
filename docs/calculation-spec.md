# Calculation Specification

**Status:** Phase 07's pure calculation engine, Phase 08's Trade Journal integration, and Phase 09's analytics composition are officially complete. Trade services call Phase 07C helpers for persisted snapshots; Phase 09 workspace-scoped read models project eligible rows and `src/lib/analytics/metrics.ts` delegates every aggregate, attribution, and equity result to Phase 07D. SQL, Actions, routes, React, and charts contain no second canonical formula. **This document is the one canonical formula document. Deliberately NOT implemented:** Discipline Score, weighted mistake penalties, mistake-cost attribution/ranking, verdict sample-size thresholds, or FX/currency portfolio analytics.

**Implemented in Phase 00b:** the money and time primitives the engine builds on — [`src/lib/money/`](../src/lib/money/) and [`src/lib/time/`](../src/lib/time/). See [ADR 0002](decisions/0002-money-representation.md) and [ADR 0003](decisions/0003-time-model.md).

Every formula here must be implemented in `src/lib/calc/`, documented in code, and unit-tested including the edge cases listed. Analytics may never reimplement a formula inline.

---

## 1. Numeric rules

**Floating point is banned for financial values.**

| Quantity                                      | Storage                              | In TypeScript         | Status       |
| --------------------------------------------- | ------------------------------------ | --------------------- | ------------ |
| Monetary amounts (P&L, fees, balances)        | `BIGINT` minor units + ISO-4217 code | `bigint`              | ✅ Phase 00b |
| Instrument prices (entry, stop, target, exit) | `NUMERIC(20,10)`                     | `string` → decimal.js | ✅ Phase 07C |
| R-multiples and ratios                        | `NUMERIC(12,4)`                      | decimal.js            | ✅ Phase 07C |

Currency scale comes from a lookup, never a hardcoded `100` — JPY, KRW, VND and IDR have zero minor decimals. Rounding happens once, at the presentation boundary, never mid-calculation.

**`decimal.js` is a dependency**, used by `src/lib/calc/decimal.ts` behind a locally cloned constructor (`Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP })`) — never the library's own global default export, so nothing in this engine can silently change rounding/precision for an unrelated module that also imports `decimal.js` elsewhere in the codebase. `precision: 50` (significant digits) comfortably covers `NUMERIC(20,10)` prices with headroom for an unrounded intermediate division. `ROUND_HALF_UP` matches the one other rounding convention already documented in this repository (`src/lib/money/parse.ts`'s `fitFraction`: "round-half-up, on the magnitude ... rounds away from zero symmetrically for negative amounts") — the engine does not introduce a second, different rounding mode (e.g. banker's rounding) alongside it. Minor units in `bigint` remain exact by construction and never pass through `Decimal` at all; a `bigint` converts to `Decimal` only via exact string conversion (`src/lib/calc/decimal.ts`'s `bigintToCalcDecimal`), never through a JS `number`.

**Persisted R rounding.** Every R-producing function calculates at full 50-significant-digit precision and rounds exactly once, at its own final return, to `NUMERIC(12,4)`'s four decimal places (`src/lib/calc/decimal.ts`'s `toCanonicalR`) — never on an intermediate value. `systemR = systemGrossR − systemCostR`, for example, subtracts the cost from the raw unrounded gross R and rounds the difference once, rather than rounding `systemGrossR` first and subtracting from that already-rounded value (which would let a small rounding error compound). Canonical output is always a fixed-point string with exactly four decimal places and no exponent — `'3.0000'`, `'-1.0500'`, `'0.0000'` (never `'-0.0000'`) — never a JavaScript `number`.

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

`Trade.actual_initial_risk_minor` and `Trade.net_pnl_minor` (both `BIGINT` account-currency minor units) are the **authoritative** monetary inputs to Actual R — never `riskPerUnit × positionSize × contractMultiplier`. That formula is not universally valid across Forex, gold, crypto and indices, especially when account currency differs from quote currency; a pip value in JPY-quoted pairs, a per-contract multiplier for an index future, and a crypto position sized in the base asset do not reduce to one multiplication safely. Phase 08's execution forms accept these authoritative amounts directly and convert human currency input with the registry-aware exact money parser (or explicit raw minor units for an unknown currency); neither React nor the service derives them from price/quantity. `src/lib/calc/` reads the two stored bigints and `Trade.actual_entry`/`actual_exit`/`actual_position_size` remain informational primitives (`NUMERIC(20,10)`), not R inputs.

**Planned R has no such ambiguity** — it is a pure per-unit price ratio and never touches position size or account currency at all (below).

### Net result

`Trade.net_pnl_minor` is the authoritative stored Actual money result. `gross_pnl_minor`,
`commission_minor`, `fees_minor`, and `swap_minor` are informational snapshots. Analytics
must never reconstruct Net P&L by subtracting those fields again from an already-net result.
The recording model may use cost inputs while producing the authoritative value, but the
aggregate contract is only:

```
netPnl = Σ net_pnl_minor
```

The aggregate is available only for a non-empty, complete, single-currency eligible Actual
population whose currency has a known minor-unit scale. A missing result (including a
legitimate Price-mode Trade) is `incomplete`; multiple account currencies are
`mixed_currency`; an unregistered scale is `unsupported_currency_scale`; an empty population
is `empty`. No partial total, FX conversion, current FX rate, `NaN`, or `Infinity` is allowed.
`src/lib/calc/net-pnl.ts` owns this typed availability contract. R analytics remain available
when money is not.

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

`plannedR` is undefined whenever `Trade.planned_target` is absent — a Trade may legitimately have a planned entry/stop without a committed target; `src/lib/calc/trade.ts`'s `plannedR` reports this as `{ ok: false, reason: 'missing_input' }`, never `null` or `NaN`.

### Implementation mapping (Phase 07C)

| Formula above              | Implemented as                                                                | Source                  |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| `riskPerUnit`              | `plannedRiskPerUnit` / `resolvePlannedRiskContext`                            | `src/lib/calc/risk.ts`  |
| `plannedR`                 | `plannedR`                                                                    | `src/lib/calc/trade.ts` |
| `actualR`                  | `actualR`                                                                     | `src/lib/calc/trade.ts` |
| `systemGrossR`             | `systemGrossR`                                                                | `src/lib/calc/trade.ts` |
| `systemR`                  | `systemR` (raw resolved inputs) / `resolveSystemR` (respects `system_status`) | `src/lib/calc/trade.ts` |
| Outcome classification     | `classifyOutcome`                                                             | `src/lib/calc/trade.ts` |
| Atomic per-Trade snapshots | `composePlanned`, `composeTraderClose`, `composeSystemResolve`                | `src/lib/calc/trade.ts` |

### `calc_version` ownership

`src/config/trade-calc.ts`'s `CALC_VERSION` (`1`) is the single source every composed snapshot stamps (`composeTraderClose`/`composeSystemResolve`'s own `calcVersion` field) — no calculation function reads or infers it from anywhere else, and no literal `1` is duplicated inside `src/lib/calc/`. Bumping it is a deliberate, reviewed change to the engine paired with an explicit backfill migration for existing rows (CLAUDE.md's "Persisted derived values drift" risk) — Phase 07C does not perform that bump itself, it only establishes the constant every future snapshot stamps.

### `pending`/`no_trade` behavior

`resolveSystemR` (`src/lib/calc/trade.ts`) is the one function that respects `Trade.system_status`'s three-state lifecycle before attempting any arithmetic: `pending` returns `{ ok: false, reason: 'unresolved_system_outcome' }`, `no_trade` returns `{ ok: false, reason: 'system_no_trade' }`, and only `resolved` reaches `systemR`'s actual calculation. Neither `pending` nor `no_trade` is ever represented as a System R of `0` — CLAUDE.md's null-result discipline ("0 means no data" is forbidden) applies equally to the per-Trade engine and Phase 07D aggregates.

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
totalR       = Σ R                                          [aggregate.ts: totalR]
avgR         = totalR / eligibleCount                        [aggregate.ts: averageR]
expectancyR  = avgR (identical contract, not a second formula) [aggregate.ts: expectancyR]
winRate      = wins / eligibleResolvedCount   (break-evens excluded from the
                                               numerator, included in the denominator)
                                                               [aggregate.ts: winRate]
averageWinR  = mean(R where outcome = win)     (signed positive) [aggregate.ts: averageWinR]
averageLossR = mean(R where outcome = loss)    (signed negative) [aggregate.ts: averageLossR]
payoffRatio  = averageWinR / abs(averageLossR)                [aggregate.ts: payoffRatio]
profitFactor = grossPositiveR / abs(grossNegativeR)
             where grossPositiveR = Σ R where R > 0, grossNegativeR = Σ R where R < 0
                                                               [aggregate.ts: profitFactor]
equityCurveR    = per-Trade cumulative R, sorted by occurrence time then id
                                                               [equity.ts: equityCurveR]
maxDrawdownR = max over t of (runningPeak(ΣR) − ΣR at t)     (positive magnitude,
             runningPeak seeded at 0)                          [equity.ts: maximumDrawdownR]
```

**Implemented as of Phase 07D** — `src/lib/calc/{aggregate,equity}.ts`. These functions consume already-resolved R/outcome snapshots (Phase 07C's `trade.ts` output); none of them recalculates Actual R or System R from prices.

**Profit Factor uses the sign of R, not the outcome classification.** A `+0.0300R` Trade the outcome snapshot calls `break_even` still contributes its full value to `grossPositiveR`; a `-0.0300R` break-even Trade still contributes to `grossNegativeR`. `profitFactor` does not even accept an outcome field — it reads R values only. `winRate`/`averageWinR`/`averageLossR`, conversely, are classification-based and read the trusted `outcome` snapshot directly, never reclassifying `R` themselves.

**Break-even remains in the Win Rate denominator** — never removed, exactly as CLAUDE.md §6 requires. `averageWinR`/`averageLossR` exclude break-even Trades from their own subsets (a break-even Trade is neither a win nor a loss for averaging purposes), but `winRate`'s denominator still counts it.

**Population A — Trader eligible.** A Trade requires `status = 'closed'`, no soft deletion,
`actual_r`, `trader_outcome`, and `exited_at`. Strategy, Setup, and System resolution do not gate
global eligibility (classification matters only when its corresponding filter is selected).
The date axis and deterministic ordering are `exited_at`, then Trade ID.

**Population B — System eligible.** A Trade requires no soft deletion,
`system_status = 'resolved'`, `system_r`, `system_outcome`, and `system_exited_at`. Actual status
does not gate it. `pending` and `no_trade` are excluded, never zero-R records. Classification is
not required globally unless a Strategy/Setup filter is selected. The date axis and ordering are
`system_exited_at`, then Trade ID.

**These populations are independent, but not necessarily non-overlapping.** "Independent" means each is decided by its own predicate over its own required fields, never derived from the other. It does not mean disjoint: a fully-resolved Trade (`status = 'closed'`, `system_status = 'resolved'`) is simultaneously Trader-eligible and System-eligible — that overlap is the common case, not an edge case. Population C (§5) is the paired intersection.

**Day Win %.** Population A is bucketed by local calendar day using the persisted user analytics
IANA timezone and Actual `exited_at`. A day is eligible when at least one Population-A Trade
closes that day; open-only days are absent. Daily R is the full-precision sum: positive is a win,
zero is break-even, negative is a loss. `dayWinRate = winningDays / eligibleDays`; break-even
days remain in the denominator. `src/lib/calc/day-win-rate.ts` owns the DST-safe pure contract.

**Open, soft-deleted, and `canceled` trades** are excluded from every closed-trade aggregate exactly as before — `canceled` exclusion is a query-level filter the caller applies before calling these functions, not a schema-shape constraint (`Trade.status = 'canceled'` deliberately leaves every other field unconstrained).

**Deterministic ordering.** `equityCurveR`/`maximumDrawdownR` sort their own input — occurrence timestamp ascending, then `id` ascending as a stable tie-breaker (UUIDv7 sorts chronologically as a secondary key too, `src/lib/identifiers.ts`) — never trusting caller array order. A **Trader** curve's caller supplies `exited_at` as the occurrence timestamp; a **System** curve's caller supplies `system_exited_at`. Never `created_at`/`updated_at`/`system_resolved_at` — none of those describe when the position's outcome actually happened. The two axes are two independent curves over their own respectively-eligible populations, each internally ordered by its own occurrence time — not one merged series.

## 5. Attribution metrics

```
executionGapR         = actualR − systemR                          (per Trade)
                                                    [attribution.ts: executionGapR]
pairedExecutionGapR   = Σ (actualR − systemR) over the SAME paired-Trade population
                                                    [attribution.ts: pairedExecutionGapR]
averageExecutionGapR  = AVG(actualR − systemR) over the SAME paired-Trade population
                         (the PRIMARY period aggregate, Phase 13H — each comparable
                         Trade weighted equally; pairedExecutionGapR remains available
                         as the secondary summed/total figure)
                                                    [attribution.ts: averageExecutionGapR]
systemEdgeCaptured    = pairedActualTotalR / pairedSystemTotalR   (only when
                         pairedSystemTotalR > 0, same paired population both sides)
                                                     [attribution.ts: systemEdgeCaptured]
ruleChecksFollowedRate = followed / (followed + violated)   (check-level;
                          not_applicable/not_checked excluded)
                                                     [attribution.ts: ruleAdherenceRate]
tradeRuleAdherenceRate = compliant evaluated Trades / evaluated Trades
                                                     [attribution.ts: tradeRuleAdherence]
```

**Implemented as of Phase 07D** — `src/lib/calc/attribution.ts`. **Sign corrected and renamed in Phase 13H:** this table supersedes the Phase 07D `edgeLeakageR = systemR − actualR` naming/sign (positive meant "less captured"). The retired `edgeLeakageR`/`pairedEdgeLeakageR` no longer exist in the codebase; every call site — analytics/dashboard UI, marketing pages, demo fixtures — was updated to the new sign/name together, and `averageExecutionGapR` was added as the new primary aggregate.

**Population C — paired comparison.** A Trade must satisfy both Population-A and Population-B
completeness for the same Trade. For bounded analytics, inclusion is anchored only to Actual
`exited_at`; `system_exited_at` remains required and returned as metadata but is not a second
range gate. Therefore Actual-inside/System-outside is included, while Actual-outside/System-
inside is excluded. Ordering is Actual `exited_at`, then Trade ID. `PairedRTrade` couples one
`tradeId` to both values so independently filtered totals cannot be compared accidentally.

**Execution Gap** negative means the trader captured less R than the System; zero means they matched; **positive means the trader captured MORE R than the counterfactual System** — never described as an error, never clamped to zero. Both are real, meaningful findings.

**System Edge Captured** is the product/domain name for the existing ratio mathematics. It is
available only with at least one paired Trade and `pairedSystemTotalR > 0`; a non-positive System
total returns `system_has_no_edge`. It is never clamped: System +10R / Actual +13R is 130%, and
System +10R / Actual −2R is −20%. Neither is an integrity error. System-vs-Trader presentation
uses neutral identity semantics rather than positive/negative verdict coloring.

**Rule Checks Followed % is check-level.** The existing `ruleAdherenceRate` primitive remains
`followed / (followed + violated)` with `not_applicable` and `not_checked` excluded. It must not
be labeled Trade-level “Rule Adherence %”.

**Rule Adherence % is trade-level.** Snapshotted `is_required` makes the current model sufficient
without a migration. Optional checks are informational and do not classify the Trade. For each
Trade, required `followed`, `violated`, and `not_applicable` are resolved; any required
`not_checked` (or unknown future status) makes it incomplete and excludes it. A fully resolved
Trade needs at least one applicable required check (`followed` or `violated`) to be evaluated.
It is compliant only when zero applicable required checks are violated. All-`not_applicable`
Trades are resolved but not evaluated. `src/lib/calc/attribution.ts` returns the explicit counts
and `no_evaluated_trades` when a rate cannot be computed.

**Partial closes remain unchanged.** Core Population-A analytics include a position only after
its Exit legs total exactly 100%; Price mode sums direction-aware leg R weighted by closed
fraction, while Money mode sums authoritative realized leg P&L once (never weights P&L again).
The final parent `exited_at` is the chronologically latest Exit-leg timestamp.

### Discipline Score and mistake-cost attribution remain deliberately deferred

**There is no approved Discipline Score formula.** Although Phase 07B seeds the nine canonical mistake types with a neutral `default_weight`/`severity_at_time` snapshot, that is future-proofing for a later, evidence-backed weighting decision — it is not permission to invent `100 × (1 − mean(perTradePenalty))` or any other 0–100 scoring formula now. `src/lib/calc/` contains no such function, and none should be added until an explicit product decision defines one.

**Mistake-cost ranking (attributing lost R to individual mistake types) is also deferred.** A Trade may carry multiple mistake labels, so naively assigning its entire Execution Gap to every mistake on it would double-count attribution. `pairedExecutionGapR` calculates the paired total, but attributing any part of that total to specific mistake types does not exist and is left to a future phase's explicit attribution policy.

## 6. Null-result discipline

Every aggregate/attribution/equity function returns a discriminated result — implemented, not merely planned, as of Phase 07D:

```ts
type CalcResult<T> = { ok: true; value: T } | { ok: false; reason: CalcFailureReason };
```

The full closed `CalcFailureReason` set (`src/lib/calc/types.ts`) spans both Phase 07C's per-trade reasons and Phase 07D's aggregate/attribution/equity reasons:

| Reason                                                                                                                                                                                                                    | Phase | Returned by                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing_input`, `invalid_decimal`, `invalid_direction`, `zero_risk`, `invalid_risk_direction`, `invalid_target_direction`, `invalid_initial_risk`, `invalid_system_cost`, `unresolved_system_outcome`, `system_no_trade` | 07C   | `risk.ts`/`trade.ts`                                                                                                                                                |
| `no_trades`                                                                                                                                                                                                               | 07D   | `totalR`, `averageR`, `expectancyR`, `winRate`, `profitFactor`, `equityCurveR`, `maximumDrawdownR` — an empty eligible population is never a legitimate `0R` sample |
| `no_wins` / `no_losses`                                                                                                                                                                                                   | 07D   | `averageWinR`, `averageLossR`, `payoffRatio`                                                                                                                        |
| `no_profit_or_loss`                                                                                                                                                                                                       | 07D   | `profitFactor`, when every R is exactly zero                                                                                                                        |
| `system_has_no_edge`                                                                                                                                                                                                      | D1    | `systemEdgeCaptured`, when paired System Total R is not strictly positive                                                                                           |
| `no_comparable_trades`                                                                                                                                                                                                    | 07D   | paired Gap / System Edge Captured, when Population C is empty                                                                                                       |
| `no_rule_checks`                                                                                                                                                                                                          | 07D   | check-level Rule Checks Followed, when no `followed`/`violated` checks exist                                                                                        |
| `no_evaluated_trades`                                                                                                                                                                                                     | D1    | trade-level Rule Adherence, when no Trade is fully evaluated                                                                                                        |
| `no_trading_days`                                                                                                                                                                                                         | D1    | Day Win %, when Population A has no eligible local day                                                                                                              |
| `invalid_timezone` / `invalid_timestamp`                                                                                                                                                                                  | D1    | Day Win % input integrity failures                                                                                                                                  |

`NaN`, `Infinity`, and "0 means no data" are all forbidden across both phases' functions.

A dashboard showing `0%` win rate for a user with no trades is stating something false. Showing "no closed trades yet" is stating something true. The type system should make the false version hard to write.

| Situation                                       | Result                                        |
| ----------------------------------------------- | --------------------------------------------- |
| No closed trades                                | `{ ok: false, reason: 'no_trades' }`          |
| No losing trades (profit factor)                | `{ ok: false, reason: 'no_losses' }`          |
| `pairedSystemTotalR ≤ 0` (System Edge Captured) | `{ ok: false, reason: 'system_has_no_edge' }` |
| Below the verdict sample threshold              | `{ ok: false, reason: 'insufficient_data' }`  |

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

Execution Gap on this trade = 0.65 − 2.00 = −1.35R
```

The trade was profitable, while its −1.35R Execution Gap records that Actual captured less than
the System counterfactual. The sign remains Actual minus System.
