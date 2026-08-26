# Dashboard D5A — Execution Comparison Data & Time-Series Foundation

A data/domain/DTO phase. No chart, no Execution Gap visual card, no System
Edge Captured gauge, no comparative badge, no calendar/balance/drawdown/
discipline widget, no template editor, no presets, no drag-and-drop. D5A
freezes the contract; D5B builds the presentation on top of it.

## Population contract (unchanged, re-confirmed)

| Population        | Eligibility                                     | Date axis          |
| ----------------- | ----------------------------------------------- | ------------------ |
| A — Trader/Actual | closed, `actual_r`, outcome, `exited_at`        | Actual `exited_at` |
| B — System        | `system_status = 'resolved'`, R, outcome, ts    | `system_exited_at` |
| C — Paired        | same-Trade intersection of complete A **and** B | Actual `exited_at` |

**Everything D5 plots is Population C.** Both the System and the Actual series
describe the same paired Trade universe, so a cumulative comparison never sets
an independent Population A total against an independent Population B total.
The visual fixture makes exactly why that matters measurable: A totals +23.10R
over 66 Trades and B totals +36.25R over 68, while the paired 64 total +22.00R
and +35.80R. Plotting 23.10 against 36.25 would be comparing two different
populations and would not equal the Gap.

Bounded Population C is anchored **only** to Actual `exited_at`. `system_exited_at`
stays required for System completeness and travels with every series point as
metadata, but it is never a second range gate, never a sort key, and never a
bucket key.

## Paired trade series

`ExecutionComparisonTradePoint`, one per paired Trade, in canonical order:

| Field                     | Meaning                                              |
| ------------------------- | ---------------------------------------------------- |
| `tradeId`                 | identity                                             |
| `exitedAt`                | Actual exit, ISO-8601 UTC — the comparison timestamp |
| `systemExitedAt`          | System exit, ISO-8601 UTC — metadata only            |
| `systemR` / `actualR`     | canonical 4-dp R                                     |
| `executionGapR`           | canonical `actualR - systemR`                        |
| `cumulativeSystemR`       | running System total **including** this Trade        |
| `cumulativeActualR`       | running Actual total including this Trade            |
| `cumulativeExecutionGapR` | running Gap including this Trade                     |

**Ordering:** Actual `exited_at` ascending, then Trade ID ascending. The
composer sorts for itself rather than trusting the caller — the DAL already
returns this order, but a cumulative path that depends on an upstream
`ORDER BY` is one refactor away from a silently different chart. Identical
timestamps therefore can never produce two different cumulative paths for the
same data; a test feeds the same three same-instant Trades in both directions
and asserts the series is identical.

**Invariant:** `cumulativeGapR = cumulativeActualR - cumulativeSystemR` at
every point, because the gap accumulator is the difference of the same two
accumulators rather than an independent sum. The final point equals the
summary exactly: `pairedSystemTotalR`, `pairedActualTotalR` and
`executionGapR` all reconcile.

**Gap formula is not duplicated.** Per-Trade gaps, the paired total, the
average and System Edge Captured all come from `src/lib/calc/attribution.ts`.

## Daily comparison series

`ExecutionComparisonDailyPoint`, keyed on the local calendar date in the
**resolved workspace analytics IANA timezone** — never the server's zone,
never the browser's, and never a UTC boundary unless UTC is what the user
configured. Each day carries `pairedTradeCount`, that day's `systemR`,
`actualR` and `executionGapR`, plus the three cumulative fields through that
date. The same identity holds per day and in the cumulative fields, and the
last daily point equals the last trade point and the summary.

**Days with no paired Trades are absent, not zero-filled.** A zero row asserts
"the Trader matched the System exactly that day", which is a different and
false claim from "nothing paired closed that day". D5B can densify for a
continuous axis; it needs the truthful sparse series to do so.

## Gap distribution

Three counts and two extremes, derived from the canonical paired Gap:
`underperformedCount` (gap < 0), `matchedCount` (gap exactly 0),
`outperformedCount` (gap > 0), plus `minimumExecutionGapR` and
`maximumExecutionGapR`.

`matched` is an **exact** zero, not a tolerance band.
`BREAK_EVEN_TOLERANCE_R` classifies a Trade's own outcome; borrowing it here
would silently reclassify a real −0.04R execution difference as "matched the
System" — a different claim about a different quantity. A test pins that.

No leakage score, no trader grade, no thresholds, no emotional
interpretation. CLAUDE.md's standing refusal to invent a Discipline Score
applies here with the same force.

## Availability

`comparison` is a discriminated union, not an array that might be empty:

- `available` — summary + `tradeSeries` + `dailySeries` + `distribution`
- `empty` — `reason: 'no_comparable_trades'`, summary still present
- `error` — `reason: 'data_integrity_error'`, summary still present

`summary` is present in every state, so a caller can always render the
truthful D2 model without first proving the series exists.
`availability.comparison` mirrors `comparison.status` and gained `error` so a
failed R parse is never reported as "nothing paired".

**A zero or negative paired System total stays `available`.** The series, the
Gap and the distribution are all still real; only
`summary.systemEdgeCaptured` goes unavailable with `system_has_no_edge`.
Hiding the whole comparison because one ratio is undefined would throw away
the answer to the question D5 exists to ask. Captured % is never clamped —
`137%` and `−22%` are both legitimate.

## Partial closes

The composer reads Trade-level records and never sees an exit leg, so one
position is one Trade is one series point **by construction**, not by
filtering. The visual fixture's 10 partial-close Trades are all paired and
produce exactly 10 series points.

## Numeric safety

Every running total accumulates as a full-precision `CalcDecimal` and rounds
exactly once, when each point is emitted — never by summing already-rounded
per-point strings, which is how a "deterministic" cumulative line drifts from
its own summary total. `Number` never touches an R value on this path, so no
point can be `NaN` or `Infinity`. The composer formats no display strings;
values stay domain-shaped for D5B.

## Query architecture

**5 major Dashboard reads before, 5 after** — unchanged
(`trader`, `system`, `paired`, `attention`, `recentTrades` in one
`Promise.all` inside `getDashboardRawData`). The series, the daily rollup, the
distribution and the extremes all compose in memory from the Population C
records the D2 bundle already fetches. `ComparisonMetricRecord` already
carried `actualExitedAt` and `systemExitedAt`, so not even a column was added.
A service test asserts `getDashboardRawData` is called exactly once.

## Layout metadata

Unchanged from D4.5 and re-asserted: `execution.gap` is the sole member of the
full-width `execution-gap` section (`desktopColumns: 1`, `desktopSpan: 1`,
`mobileSpan: 2`), ordered after `trader.performance`. Basic KPI remains a
five-column desktop section; System/Trader remains an equal two-column
section. No visual component was built.

## Visual fixture terminology

The seed report's `A 2 / B 4 / C 64` line counts **exclusive** membership. The
`VisualPopulation` label on each blueprint says which case a row was authored
to exercise, not which canonical population it lands in:

|          | Exclusive | Canonical D1 population               |
| -------- | --------- | ------------------------------------- |
| A-only   | 2         | Trader Population A = 64 + 2 = **66** |
| B-only   | 4         | System Population B = 64 + 4 = **68** |
| Paired C | 64        | Population C = **64**                 |

B-only is 4 because the two `'B'`-labelled (planned) rows and the two
`'operational'`-labelled (open) rows are all System-resolved without a
complete Actual side. Documented on `VisualPopulation` in
`scripts/visual-dashboard-fixture.ts`. **No seed record was changed.**

## Files changed

| File                                                | Change                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `src/lib/dashboard/execution-comparison.ts`         | **new** — the D5A composer and contract                                      |
| `src/lib/dashboard/execution-comparison.test.ts`    | **new** — 26 focused cases                                                   |
| `src/lib/dashboard/page-data.ts`                    | `comparison` becomes the D5A object; `availability.comparison` gains `error` |
| `src/lib/dashboard/page-data.test.ts`               | summary paths + a series-delivery case                                       |
| `src/lib/dashboard/widgets.test.ts`                 | §18 Execution Gap section assertions                                         |
| `src/server/services/dashboard.test.ts`             | one-read + D5 composition case                                               |
| `src/server/services/analytics.integration.test.ts` | 2 real-PostgreSQL D5A cases                                                  |
| `src/server/services/analytics.ts`                  | legacy overview reads `comparison.summary`                                   |
| `src/components/dashboard/real-dashboard.tsx`       | `ComparisonPanel` reads `comparison.summary`                                 |
| `src/components/dashboard/real-dashboard.test.tsx`  | comparison fixture helpers                                                   |
| `scripts/visual-dashboard-fixture.ts`               | population terminology documentation only                                    |
| `scripts/validate-visual-dashboard-d5.ts`           | **new** — read-only fixture validation                                       |
| `package.json`                                      | `validate:visual-dashboard-d5` script                                        |
