# Dashboard D7B Risk Performance Visual

Presentation and server-boundary wiring for the two reserved D7 widgets. No
D7A formula, threshold, series shape or availability reason changed; no
migration; no new analytics.

## What D7B is

D7A produced a domain model and a focused server read that nothing rendered.
D7B renders it, once, as a single compact section at the foot of the
Dashboard — and does nothing else. There is no second Analytics page here: no
underwater drawdown chart, no drawdown-episode table, no duration analytics,
no Recovery Factor, Ulcer Index, Sharpe or Sortino, no deposit/withdrawal
ledger, no real-time equity, and no new ratio of any kind.

The section answers exactly four questions:

- What is my modeled closed balance?
- How much did it change in this selected period?
- Am I currently below my modeled high-water mark?
- What was the largest balance drawdown in this period context?

## Architecture

```
server  getRiskPerformanceData (D7A, unchanged)
          -> RiskPerformanceData        canonical minor units, typed states
        composeRiskPerformanceView      pure, tested, formats ONCE
          -> RiskPerformanceView        strings, tones, plot coordinates
React   RiskPerformanceSection          async server component, 1 read
        RiskPerformanceCard             server, presentational
        ModeledBalanceChart             client, Recharts only
```

`src/lib/dashboard/risk-performance-presentation.ts` is the only place a D7A
figure becomes text. It never sums a delta, divides an amount by a peak,
re-derives an ending balance from an opening balance plus a visible period
P&L, or invents a percentage D7A declined to publish. The single `number` it
emits is an SVG y-coordinate, and every point carries its exact canonical
string beside it.

`ModeledBalanceChart` is the only client component. It receives finished
points and draws them; it computes nothing. Its one unit-less string is the
Y-axis tick, which is a gridline coordinate Recharts chose rather than a
stored figure.

## Terminology

**Modeled Balance**, everywhere. Never broker balance, live balance, equity
or real-time equity — this product records no deposit, withdrawal, transfer,
credit, broker adjustment or open-position mark, and the copy never borrows
authority those records would give it. A component test asserts the absent
vocabulary rather than trusting review.

The info popover is a real keyboard-operable button (shared `MetricInfo`, not
a hover tooltip) and states both limits: what the balance is built from, and
what it does not include.

## Summary hierarchy

| Region             | Widget            | Figures                                       |
| ------------------ | ----------------- | --------------------------------------------- |
| 7 of 12 columns    | `account.balance` | Modeled Balance, Period P&L, opening sentence |
| 5 of 12 columns    | `risk.drawdown`   | Current Drawdown, Max Drawdown, Peak Balance  |
| full width beneath | (shared)          | the Modeled Balance curve                     |

Modeled Balance and Period P&L are the two hero figures. Peak Balance is
deliberately secondary and lives with the drawdowns, because it is the
high-water mark those two are measured from — not a fifth headline and not a
card of its own.

Only Period P&L carries signed colour. Modeled Balance is neutral at every
value; a drawdown greater than zero takes the restrained negative foreground
and a drawdown of exactly zero stays neutral, because standing at your own
high-water mark is not bad news. Both drawdowns always print an amount **and**
a percentage as text, so colour is never the only carrier.

## Balance semantics

The displayed ending balance is D7A's `endingBalanceMinor`. It is never
`Starting Balance + the period P&L on screen`, because a bounded window
carries real history into its opening state. The section states the carried
opening in words directly under the two hero figures:

> This range opened at $11,270.00, carried in from Trades closed before it.

For the All range there is no bounded opening to carry and, per the D7A
contract, no trustworthy financial inception timestamp either — so the copy
names the declared Starting Balance and claims no date:

> Modeled from the declared Starting Balance of $10,000.00.

No surface says "Account opened on…" or "Balance since account creation".

## The curve

One plot. `type="stepAfter"` — never `monotone`, `basis` or any spline: a
modeled closed balance changes at Trade-close realizations and holds flat
between them, and a curved interpolation would draw balances the Account
never modeled at every instant in between. A component test reads the
rendered path's `d` attribute and fails on any curve command, so this cannot
regress into a spline silently.

The line is the interaction blue at every value (`var(--primary)`), never
green: positive/negative semantics belong to the outcomes beside the chart,
not to the identity of the balance series. Grid and axes are restrained
neutrals from the existing tokens; no theme token changed and no navy
returned.

The x-axis is CATEGORICAL over each point's unique key rather than over a
timestamp, for two reasons: several Trades can close on one date, and the All
range's opening anchor deliberately has no timestamp to place. Axis and
tooltip labels are resolved on the server in the workspace timezone.

The high-water mark is a `ReferenceLine` drawn from D7A's single canonical
`peakBalanceMinor` scalar — no time series is rescanned and no running peak is
recomputed in React. In a bounded range it can sit above every visible point,
which is the truthful reading.

**Event kinds are not flattened.** `opening`, `trade_close` and `as_of` are
distinguished in the tooltip and in the table fallback: an anchor is never
labelled as a Trade, an anchor carries no P&L line, and a grouped instant says
how many Trades closed at it.

**Partial closes.** Presentation consumes parent-Trade realizations only.
Ten partially closed positions with 24 Exit legs contribute ten balance
steps, and the fixture test asserts exactly that.

## Filter scope

Account and date range move this section. Strategy, Setup and Strategy
Version deliberately do not, because a modeled balance is an Account-level
fact — D7A validates those identities and never applies them. The section
says so in the info popover always, and raises a visible note only while such
a filter is actually applied; standing copy explaining a filter nobody set is
clutter. The figures are asserted identical with and without the filter in
both the component tests and the E2E.

The active range appears as a **label**, not a control. D7 introduces no
second date-range control; it follows the one the Dashboard already has.

## States

Every typed reason has its own words. Nothing collapses to "No data".

| Status          | Reason                                                                                                                                       | Treatment                               |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| available       | 0 closed Trades                                                                                                                              | all four figures + a sentence; no chart |
| unavailable     | `select_single_account`                                                                                                                      | asks for one Account, explains why      |
| unavailable     | `missing_starting_balance`                                                                                                                   | points at Account settings              |
| unavailable     | `incomplete_money_history`                                                                                                                   | says nothing was silently excluded      |
| unavailable     | `currency_mismatch`                                                                                                                          | says balances are never converted       |
| unavailable     | `unsupported_currency_scale`                                                                                                                 | names the registry limit                |
| error (`alert`) | `invalid_starting_balance`, `invalid_money_data`, `invalid_actual_exit_timestamp`, `invalid_range`, `invalid_money_display`, `service_error` | announced, and never "no data"          |

**All Accounts** renders a purposeful state, not zeros: no `$0`, no `0%`, no
empty axes, no metric nodes at all, and no FX aggregation is attempted.

**An Account with a Starting Balance and no closed Trades is AVAILABLE.**
Every figure is true, so all four are shown at `$10,000.00 / $0.00 / $0.00 ·
0.00% / $0.00 · 0.00%`; only the chart is withheld, because a flat line adds
nothing the sentence beside it does not. It is never an error.

Integrity and service failures stay distinct from product limitations, and
carry `role="alert"`.

## Query boundary

Unchanged from D7A and re-verified:

- Dashboard core — **5** major projections
- Risk — **1** focused projection, three columns per row

`RiskPerformanceSection` is an async server component with its own Suspense
boundary, streamed exactly like the D6 Calendar. There is no client
`useEffect` read, no per-point query, no N+1, and Risk was not folded into the
five core reads to dodge declaring a boundary. A thrown read is caught at the
section and rendered as a service failure, so the KPI band, the two
baselines, the Execution Gap and the Calendar — all from a different read —
stay on screen.

## Registry

`account.balance` and `risk.drawdown` were the last two
`implementation: 'later'` widgets. Both are now `current`, both map onto one
shared `risk-performance` section (12 columns, 7 + 5), and no third arbitrary
widget ID was invented. The retired `reserved` holding section is removed: its
only members are built, and an empty section would be a prediction about a
widget nobody has specified rather than a record of the page. This is still
not a layout engine — no persistence, no editor, no drag/drop, no resize.

## Responsive

Desktop is a summary strip over a wide curve. Mobile stacks to one column and
source order **is** priority order: Modeled Balance, Period P&L, Current
Drawdown, Max Drawdown, then the supporting Peak, then the chart. Asserted
off the DOM in both the component test and the E2E at 390 and 320.

## Accessibility

- Every critical value exists as text outside the plot.
- The plot has an accessible name; the figure has a caption.
- A visually hidden table carries every point — kind, date, balance, delta —
  so the per-point figures are not pointer-only.
- The info popover is a button, reachable by keyboard and touch.
- Signed P&L and both drawdowns are never colour-only.
- `prefers-reduced-motion` is honoured by the chart's entry animation.

## Files changed

| File                                                           | Change                                     |
| -------------------------------------------------------------- | ------------------------------------------ |
| `src/lib/dashboard/risk-performance-presentation.ts`           | new — the pure view model                  |
| `src/lib/dashboard/risk-performance-presentation.test.ts`      | new — 20 tests                             |
| `src/components/dashboard/risk/risk-performance-section.tsx`   | new — the server boundary                  |
| `src/components/dashboard/risk/risk-performance-card.tsx`      | new — the presentational section           |
| `src/components/dashboard/risk/modeled-balance-chart.tsx`      | new — the stepped client chart             |
| `src/components/dashboard/risk/risk-performance-card.test.tsx` | new — 20 component tests                   |
| `src/lib/dashboard/widgets.ts`                                 | both D7 widgets `current`, shared section  |
| `src/lib/dashboard/widgets.test.ts`                            | retires the `reserved` assertion           |
| `src/components/dashboard/real-dashboard.tsx`                  | `riskSlot` + skeleton block                |
| `src/components/dashboard/real-dashboard.test.tsx`             | slot stub                                  |
| `src/app/[locale]/(app)/app/(main)/page.tsx`                   | Suspense boundary + account label          |
| `src/server/services/risk-performance.ts`                      | comment only                               |
| `messages/en.json`, `messages/th.json`                         | `dashboard.riskPerformance`                |
| `scripts/visual-dashboard-risk-performance.test.ts`            | D7B presentation block on the same fixture |
| `e2e/dashboard.spec.ts`                                        | three Risk Performance E2E cases           |

No migration. `drizzle-kit check` clean.

## UAT artifacts

`docs/reviews/dashboard-d7b-risk-uat/` — 14 cases with `metrics.json` and a
committed `capture.ts`, taken from the shipping section running the shipping
CSS against a real production build on the guarded test database. Contexts run
with `reducedMotion: 'reduce'`, which is why the frames show the settled chart:
Recharts animates a line in by growing a clip rect over an already-final path,
so there is nothing to poll for, and two earlier fixed waits both published a
half-drawn line. Nothing was restyled to manufacture a state.

The seed is anchored to `now` rather than to the fixture's fixed reference
instant, and is arranged so the headline figures land on the contract's
numbers. Maximum drawdown deliberately differs — matching it too would have
needed the fixture's whole 66-Trade shape, and the fixture's own maximum
drawdowns are locked by unit test instead.

| Range |    Opening |     Ending |     Period |       Peak |      Current DD |          Max DD | Points |
| ----- | ---------: | ---------: | ---------: | ---------: | --------------: | --------------: | -----: |
| All   | $10,000.00 | $12,310.00 | +$2,310.00 | $12,420.00 | $110.00 · 0.89% | $890.00 · 8.09% |     14 |
| 90D   | $10,110.00 | $12,310.00 | +$2,200.00 | $12,420.00 | $110.00 · 0.89% | $890.00 · 8.09% |     10 |
| 30D   | $11,270.00 | $12,310.00 | +$1,040.00 | $12,420.00 | $110.00 · 0.89% | $540.00 · 4.57% |      6 |
| Empty | $10,000.00 | $10,000.00 |      $0.00 | $10,000.00 |   $0.00 · 0.00% |   $0.00 · 0.00% |      0 |

Measured, not asserted in advance:

| Case                        |    Section | Page overflow | Section overflow |
| --------------------------- | ---------: | ------------: | ---------------: |
| 1440 dark/light populated   | 1312 × 632 |         **0** |            **0** |
| 1440 with a Strategy filter | 1312 × 697 |         **0** |            **0** |
| 1440 empty Account          | 1312 × 357 |         **0** |            **0** |
| 1440 All Accounts           | 1312 × 178 |         **0** |            **0** |
| 1920                        | 1792 × 632 |         **0** |            **0** |
| 390 dark/light              |  358 × 930 |         **0** |            **0** |
| 320                         | 288 × 1034 |         **0** |            **0** |

- **No horizontal overflow at any width**, 1920 down to 320.
- **`stepAfter` confirmed from the DOM**: every captured path is `M` followed
  by `L` commands only — `chartCurveCommands: false` in all 14 cases.
- **The three openings are visibly different**, which is the point: the 30D
  frame reads "$12,310.00 · +$1,040.00 · opened at $11,270.00" and cannot be
  read as $10,000 becoming $12,310 in a month.
- **Compact**: the populated section is 632px at 1440 against a 2767px page,
  and the two unavailable states collapse to 357px and 178px rather than
  holding a chart's worth of empty space.

### Three defects the captures found, all fixed

1. **The Y-axis was anchored to zero.** Recharts' default numeric domain is
   `[0, 'auto']`, so a $10,000–$12,420 account plotted against 0 · 3,500 ·
   7,000 · 10,500 · 14,000 and every real movement — including the drawdown
   this section exists to show — was squeezed into a flat band at the top.
   Now `domain={['auto', 'auto']}` explicitly.
2. **The high-water `ReferenceLine` label sat on top of the data.** Recharts
   renders it as a filled box straddling the line, and it covered the plotted
   balance. Removed; the legend names that stroke and its dash style, which is
   where identification belongs.
3. **An Account with no Trades was told a history it does not have.** A
   bounded range whose opening equals the Starting Balance was still rendering
   "carried in from Trades closed before it". The opening is now a three-way
   typed case — `all`, `carried`, `at_starting_balance` — with its own
   sentence each, and a unit test covers the third.

## Gates

| Gate                                         | Result                           |
| -------------------------------------------- | -------------------------------- |
| Unit suite                                   | 2596 passed / 179 files          |
| Integration (PostgreSQL)                     | 981 passed / 983, 60 of 61 files |
| Dashboard + Calendar + theme + app-shell E2E | 230 passed, both projects        |
| Typecheck · lint · format                    | clean                            |
| Production build · `scan:client`             | clean                            |
| `drizzle-kit check` · `git diff --check`     | clean, no migration              |

The two integration tests that did not pass on the full run were
`analytics.integration.test.ts`'s membership-removal and D6A month-intersection
cases, both failing at exactly the 20s `testTimeout` in a file that took 198s
because a second suite was running against the same remote test database at the
time. Re-run in isolation, that file passes 28/28. Neither test touches D7.
