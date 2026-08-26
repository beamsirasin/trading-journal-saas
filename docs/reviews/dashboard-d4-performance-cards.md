# Dashboard D4 — System & Trader Performance

Implemented 2026-08-26 on top of D1 (calculations), D2 (data contract) and D3
(Basic KPI row). D4 is presentation only: no formula, no population rule, no
`DashboardPageData` field, no migration, and no App Shell token changed.

## Scope

The two registered D2 widgets, `system.performance` and `trader.performance`,
rebuilt as analytical cards. Execution Gap, System Edge Captured, paired
comparison, comparative arrows, and any "you missed X R" framing are D5 and are
absent by construction — `composePerformanceCards` reads `data.system` and
`data.trader` and never touches `data.comparison`, which a test asserts.

## Architecture

One shared shell, one side-specific model, no per-side conditionals sprawl.

- `src/lib/dashboard/metric-display.ts` — the display value shape and the
  `signedMetric` / `neutralMetric` / `plainValue` helpers, now shared by D3's
  Basic KPI model and D4's. D3's `BasicKpiValue` became an alias of the shared
  generic; the shape is structurally identical, so its 23 model tests and 23
  component tests passed unchanged through the refactor.
- `src/lib/dashboard/performance-card.ts` — `composePerformanceCards(data)`
  runs both sides through one composer, so their geometry, metric order, and
  state handling cannot drift.
- `src/components/dashboard/performance/performance-card.tsx` — the shared card
  shell, the `PerformanceCell` primitive, the `PerformanceFigure` state
  renderer, and the per-side definition list.

## Card hierarchy

Header (identity mark · title · one-line tagline · definition affordance) →
hero Total R → W/BE/L composition → a 6-cell supporting grid. Two type sizes,
not seven equal ones: the hero sits a step above the D3 KPI scale and the
supporting cells a step below it, so these read as the heavier analytical
surface without becoming enlarged KPI cards or a spreadsheet.

|         | System                                                                | Trader                |
| ------- | --------------------------------------------------------------------- | --------------------- |
| Tagline | Strategy outcomes                                                     | Your actual execution |
| Hero    | System Total R                                                        | Actual Total R        |
| Grid    | Win Rate · Avg R · Expectancy · Profit Factor · Max Drawdown · Trades | identical             |

## Deliberate decisions

**Identity, never verdict.** Both cards use the same neutral `bg-card` surface.
The System teal and Trader blue survive only as a 36px header mark; the former
4px coloured top border is gone, because a teal band sits close enough to the
positive green that it would read as "System = good". A test asserts neither
card carries a `bg-positive|negative|system|trader` surface or a `border-t-4`.

**Only the hero is signed.** Total R takes positive/negative/neutral colour.
Win Rate, Avg R, Expectancy, Profit Factor, Max Drawdown and Trades stay
neutral however strong they read — a Win Rate is a measurement, not a verdict
(CLAUDE.md §1) — and the sign still appears in the text (`-0.04R`), so nothing
is carried by colour alone. §7 permits signing Avg R and Expectancy; D4
declines, because "supporting analytics should remain mostly neutral" is better
served by one coloured figure per card than by three.

**Maximum Drawdown is a magnitude, not an outcome.** `maximumDrawdownR` is
non-negative by construction (`src/lib/calc/equity.ts`), so rendering it with
the `r` style would print `+2.00R` and tone it positive — a 2R drawdown reading
as a 2R gain. A new presentation-only `magnitude` style renders `2.00R` with a
neutral tone. This is a display addition; the calculation is untouched, and the
Analytics page's existing `style="r" forceNeutral` rendering was left alone as
out of scope.

**Sizes are spelled explicitly, not layered onto `MetricValue`.**
tailwind-merge does not recognise this project's custom `--text-metric` scale
as a font-size group, so `cn('text-metric', 'text-4xl')` keeps both utilities
and stylesheet order decides the winner. Verified directly against
`tailwind-merge` before relying on it.

**One definition affordance per card, not six.** Six icon buttons inside a
six-cell grid would be the spreadsheet these cards are meant not to be. The
header button opens the D3 Popover carrying the card's purpose and all six
metric definitions as a compact `<dl>`; the popover now scrolls inside its own
available height so a short viewport cannot cut it off. Keyboard- and
touch-operable, as in D3.

**Counts are never reconciled.** Population B and Population A are independent
axes, so the two Trade counts legitimately differ under one filter — 3 vs 3 in
the 90D E2E fixture, 3 vs 0 in the System-only UAT fixture. Nothing in the
model or the UI harmonises them, and a test asserts each side reads its own
population.

## Independent metric availability

An empty population and an unavailable metric are different facts and look
different:

- **Population empty** — header, one worded notice (`No eligible System Trades
in this range yet.`), and the truthful `Trades 0`. No hero, no grid of five
  repetitions of the same sentence. The other card is unaffected.
- **Metric unavailable over a real population** — that cell alone says why
  (`No losing Trades`), carries `data-performance-metric-reason`, and its
  neighbours keep their values. Profit Factor never renders `Infinity`.
- **Integrity error supplied by D2** — that cell says `Metric temporarily
unavailable`; the rest of the card stands.

## Layout

- **Desktop** — one `lg:grid-cols-2 items-stretch` row. E2E asserts the two
  cards share a top edge and match in width and height to within 1px. The
  supporting grid is three columns.
- **Mobile** — both cards full width, stacked, supporting grid at two columns.
  E2E checks 390px and 320px for stacking, equal widths, no inner horizontal
  scroll, a ≥12px computed metric font size, and no page overflow.

**Recorded discrepancy, for a later decision.** D2's `DEFAULT_DASHBOARD_LAYOUT`
records this pair as `desktopSpan` 2 and 3 of a five-column grid — 40/60. D4 §10
requires two balanced equal-width cards with neither side dominant, and two
equal integer spans cannot fill a five-wide row. Rather than silently rewriting
D2's metadata to fake parity, the pair renders in its own balanced two-column
grid (as it already did before D4) and each card still emits its layout
metadata as data attributes. If the five-column model should become the
authority for this row, that is a D2 metadata decision, not a D4 one.

## Accessibility

Each card is a `role="group"` named by its `<h3>`. Metric labels are `<dt>` and
values `<dd>`. Definition affordances are real buttons at 32px (clears WCAG
2.5.8 AA), operable by pointer, touch and keyboard, closing on Escape.
Unavailable reasons and the hero's sign are always in text.

## Verification

| Check                                   | Result                                         |
| --------------------------------------- | ---------------------------------------------- |
| Unit tests (`vitest run`)               | 2304 passed / 160 files                        |
| Lint (`eslint src e2e`)                 | clean                                          |
| Typecheck (`tsc --noEmit`)              | clean                                          |
| Format (`prettier --check .`)           | clean                                          |
| Production build (`next build`)         | compiled successfully, 48 pages                |
| `git diff --check`                      | clean                                          |
| Dashboard E2E, chromium + mobile-chrome | passed against the guarded `TEST_DATABASE_URL` |
| Analytics + demo-dashboard E2E          | passed                                         |
| Theme + app-shell E2E                   | 196 passed, 1 skipped                          |

New tests: 23 model cases (`performance-card.test.ts`), 31 component cases
(`performance-card.test.tsx`), 2 RealDashboard integration cases, 1 presentation
case for the `magnitude` style. Two RealDashboard assertions were updated
because the presentation they described is superseded: the old `3 Trades` pill
is now a `Trades` metric cell, and the old empty state's four repetitions of
`No eligible Trades` are now one notice plus a zero count.

### Load-sensitive flakes, both pre-existing

Under a loaded machine (three specs, two workers) two assertions failed that
pass in isolation, and both are transient-duplication or hydration-timing
artifacts of the App Router's streamed tree rather than D4 behaviour:

- `analytics.spec.ts:442` — strict-mode violation on
  `getByLabel('Current analytics scope')` resolving to two identical `<p>`
  elements, on a page D4 does not touch. Passes alone.
- `dashboard.spec.ts` desktop — the 30D link click had not navigated within the
  timeout. The spec already carries a hydration-wait comment for this. Passes
  alone.

The equivalent exposure in the mobile dashboard test was in D4's path, so it is
now asserted rather than left to strict mode: `expect(system).toHaveCount(1)`
polls through a one-frame duplicate while still failing a panel that genuinely
rendered twice.

`e2e/i18n.spec.ts:120` remains failing for the reason recorded in the D3 review:
it asserts an orphaned Analytics heading key from this branch's uncommitted
Analytics restructure. Unrelated to D4.

## Visual UAT

`docs/reviews/dashboard-d4-performance-uat/` — each case captured in real
Dashboard context with the D3 KPI row and Needs Attention above it, so the
hierarchy can be judged, plus a full-page frame.

| #   | Case                                                                |
| --- | ------------------------------------------------------------------- |
| 01  | desktop 1440 dark — both populated, System +12.10R vs Trader −0.28R |
| 02  | desktop 1440 light — both populated                                 |
| 03  | desktop 1440 dark — System populated, Trader empty                  |
| 04  | desktop 1440 light — Trader populated, System empty                 |
| 05  | mobile 390 dark — both populated                                    |
| 06  | mobile 390 light — both populated                                   |
| 07  | mobile 320 dark — sanity check                                      |

The populated fixture is deliberately the product's most interesting quadrant —
a strongly positive System against a slightly negative Trader — so the colour
rules can be judged where they matter.
