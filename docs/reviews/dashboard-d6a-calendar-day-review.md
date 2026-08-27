# Dashboard D6A — Recent Trades, Calendar & Day Review Data Foundation

A data/domain/DTO phase. No Calendar visual redesign, no Day Review modal, no
Quick Preview panel, no Recent Trades table restyle, no mobile sheets, no
animations. No migration. D1–D5B contracts unchanged.

## Existing Calendar architecture found

`src/server/dal/trade-calendar.ts` (Phase 14D) already had a sound
foundation, and D6A did **not** replace it:

- two bounded month reads (Trader by `exited_at`, System by
  `system_exited_at`), never one per day
- local-day bucketing in application code via `calendarDateIn`, never a SQL
  `date_trunc` that would cut on the server's boundary
- sparse days — a day only appears when it has a result
- `decimal.js`-backed `totalR`, never `SUM(numeric)`

What it lacked for D6: a Gap mode, per-day W/BE/L, Dashboard
Strategy/Setup/range scope (it is account-scoped only), Day Review rows, and
a URL-backed mode. It also serves the **Journal** page, which is workspace-
wide by design — so D6A adds a Dashboard-scoped path beside it rather than
rewriting it.

Two live defects the audit confirmed, both fixed by the new contract:
`selectDate` navigated to `view=log`, which destroys the Calendar; and the
axis lived in a `useState`, so refresh and deep links silently lost it.

## Calendar mode contract

| Mode     | Population                                 | Date axis                   |
| -------- | ------------------------------------------ | --------------------------- |
| `actual` | A — closed, `actual_r`, outcome            | Actual `exited_at`          |
| `system` | B — `system_status='resolved'`, R, outcome | `system_exited_at`          |
| `gap`    | C — same-Trade intersection                | Actual `exited_at` **only** |

One population is never reused for another mode. A Trade legitimately lands
on a **different local day** in `actual` than in `system`; nothing forces
alignment, and an integration test pins that.

## Day schemas — a discriminated union, not one wide row

```ts
CalendarPerformanceDay  // mode: 'actual' | 'system'
  date, eligibleTradeCount, totalR, wins, breakEvens, losses,
  classification: 'winning' | 'break_even' | 'losing'

CalendarGapDay          // mode: 'gap'
  date, pairedTradeCount, systemR, actualR, gapR,
  classification: 'outperformed' | 'matched' | 'underperformed',
  underperformedCount, matchedCount, outperformedCount
```

**Classification follows the day's TOTAL R, not majority outcome** — two
losses and one larger win is a winning day. The sign test is exact, mirroring
`dayWinRate` so the Calendar and the Day Win % KPI cannot disagree.

**Gap days are never "winning" or "losing".** A day the account lost money on
can still be a day the Trader outperformed the System, so the vocabulary is
relative. `CalendarMonthTotals` therefore counts
`classifiedDayCounts.positive/neutral/negative` rather than a `winningDays`
field that would be a false claim in Gap mode.

Cells calculate nothing: every value above is composed server-side.

## Month, timezone and empty days

Month bounds come from `monthRangeIn(year, month, timezone)` with the
timezone read from the same persisted preference the analytics context
resolves — never the browser's, never the server's, never a naive UTC month.
Tests cover Bangkok's evening rollover, a UTC-next-month instant that is still
the previous local day in New York, and the 8 March 2026 US DST transition.

**No fake zero rows.** Only populated dates appear; a no-trade day is not a
`0.0000R` performance day, and presentation builds the blank squares.

## Dashboard-range intersection (§23, adopted)

`Calendar month ∩ active Dashboard date bounds`. A Calendar showing August in
full while the Dashboard is scoped to 30D would put Trades on screen every
other figure on the page has excluded — the reader would add the squares up
and fail to reach the KPI total with nothing explaining why. A month entirely
outside the range is legitimately `empty`, never silently unfiltered. An
integration test proves the emptiness comes from the intersection by showing
the same month populated under `range=All`.

## Day Review DTO

`DayReviewData` = `available | empty | error`, carrying mode, local date,
timezone, a mode-specific `headline`, and rows.

**The headline is the clicked square's own numbers**, passed through from the
`CalendarDay` rather than re-summed — so the panel cannot disagree with the
cell. `reconcileDayReview` asserts rows still add up to it, in tests.

Rows (`DayReviewTradeRow`) reuse `DashboardRecentTrade` — the same shape and
the same `composeRecentTrade`, not a parallel one — plus `axisAt`, this
mode's own timestamp. Ordering is axis ascending then Trade ID, the same
deterministic rule D5A froze. Unresolved System stays unresolved.

## Navigation and deep-link contract

Four URL keys, sharing one address with the Dashboard filters:
`mode`, `month`, `day`, `trade`.

Two parsers, each owning its keys and each **still failing closed** on
genuinely unknown ones — `filters.ts` lists the calendar keys as tolerated,
`calendar-navigation.ts` lists the filter keys as tolerated. A typo'd
parameter is still an error.

Rejected: an unknown mode, a malformed or impossible date (`2026-02-31`), a
day outside the requested month, a non-UUID trade, and `trade` without `day`.
Every navigation href is built by `serializeCalendarState`, which produces
the filter half from the filters module itself — so opening a day, paging the
month, switching mode or opening a Trade **cannot** drop Account, Strategy,
Setup or range. Defaults are omitted, so a closed Day Review and one never
opened share a URL. Deep link, Back and refresh all work with no bespoke
history code.

Selecting a day keeps month + mode; changing mode clears the day, because a
day selected in Actual may hold nothing in System.

## Recent Trades

D2's contract preserved unchanged: Account/date/Strategy/Setup scope,
`occurred_at` axis, rows carrying symbol, side, strategy, setup, status,
Actual R, System R and the three-state Gap. A Trade with an unresolved System
side stays visible. **Current limit: 5** — a Dashboard preview, not the
Journal.

## Quick Preview data boundary

`getWorkspaceTradeDetail(tradeId)` already returns Actual, System,
Strategy/Setup, execution legs, context, rules/mistakes, image/link and notes,
workspace-scoped, and is already used by the Journal. **D6A reuses it and
duplicates nothing.** The boundary D6A establishes is the stable, validated
`selectedTradeId` in the navigation contract plus the guaranteed unique
`tradeId` on every Day Review row — one read, no new domain logic.

## Partial closes

One position is one Trade in Calendar counts and in Day Review rows, **by
construction**: both projections select Trades and join no `trade_exits` at
all. Legs remain Quick Preview's business. Unit tests pin it; the fixture's 10
partial-close Trades are validated in D5's own suite and re-checked here
through the day-count reconciliation.

## Query architecture and counts

| Surface        | Reads                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Dashboard core | **5, unchanged**                                                          |
| Calendar month | **1** bounded read for the requested mode                                 |
| Day Review     | **2** — the day's rows, plus the month projection its headline comes from |
| Quick Preview  | **1** — the existing `getWorkspaceTradeDetail`                            |

No query per day, no query per cell, no N+1 per row. Only the requested mode
is fetched; loading all three to render one would triple the cost.

The Day Review's second read buys the guarantee that the panel and the clicked
square agree by construction rather than by two aggregations happening to
match — an honest trade, stated rather than hidden.

## Dashboard loading strategy — option B

The Calendar is **not** in `DashboardPageData`. It is a separate
server-driven read invoked from its own boundary.

D2's five reads have survived D3, D4, D4.5 and D5 unchanged. Folding a month
in would add a sixth to _every_ Dashboard load — including loads where nobody
scrolls to the Calendar, and including every filter change, which re-runs the
whole bundle. The month is also a dimension the bundle does not have: paging
to July must refetch the Calendar and nothing else, which a fused payload
cannot express.

It remains server-driven: the widget performs **no client-side analytics
fetching**, receiving a composed model as props like every other widget.

## Registry and layout

`calendar.performance` and `trades.recent` are used as-is. No new registry, no
new widget id, and no layout metadata change — `calendar.performance` stays
`implementation: 'later'` because D6A builds no component. The 7/12 + 5/12
split is D6B's decision.

## Files changed

| File                                                | Change                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `src/lib/dashboard/calendar.ts`                     | **new** — modes, day union, month composers                    |
| `src/lib/dashboard/calendar.test.ts`                | **new** — 21 cases incl. DST/month boundaries                  |
| `src/lib/dashboard/calendar-navigation.ts`          | **new** — URL contract                                         |
| `src/lib/dashboard/calendar-navigation.test.ts`     | **new** — 19 cases                                             |
| `src/lib/dashboard/day-review.ts`                   | **new** — Day Review DTO + reconciliation                      |
| `src/lib/dashboard/day-review.test.ts`              | **new** — 11 cases                                             |
| `src/lib/dashboard/filters.ts`                      | tolerate the calendar keys, still fail closed                  |
| `src/lib/dashboard/page-data.ts`                    | export `composeRecentTrade` for reuse                          |
| `src/server/dal/analytics.ts`                       | calendar + day-review projections, reusing the analytics scope |
| `src/server/services/dashboard-calendar.ts`         | **new** — month/day services                                   |
| `src/server/services/analytics.integration.test.ts` | 7 real-PostgreSQL D6A cases                                    |
