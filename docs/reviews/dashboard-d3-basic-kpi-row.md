# Dashboard D3 — Basic KPI Row

Implemented 2026-08-26 on top of the completed D1 calculation baseline and D2
data contract. D3 is presentation only: it adds no query, no calculation, no
migration, and no change to `DashboardPageData`'s composition semantics.

## Scope

The five universal Basic widgets, and nothing else:

| Widget ID              | Metric             | Native unit |
| ---------------------- | ------------------ | ----------- |
| `basic.net-pnl`        | Net P&L            | money       |
| `basic.trade-win-rate` | Trade Win %        | percentage  |
| `basic.profit-factor`  | Profit Factor      | ratio       |
| `basic.day-win-rate`   | Day Win %          | percentage  |
| `basic.avg-win-loss`   | Avg Win/Loss Trade | ratio       |

System/Trader redesign, Execution Gap chart, Calendar, Account Balance,
Drawdown, template editor, presets, drag/drop, resize, custom layouts,
persistence, and advanced filter UI remain unimplemented, exactly as D3
required.

## Architecture

One pure presentation model plus one reusable card shell — neither a giant
metric-name switch nor five duplicated cards.

- `src/lib/dashboard/basic-kpi.ts` — `composeBasicKpis(data)` maps the D2
  `basic` states to display strings, tones, and translation-shaped context.
  Pure and React-free, so every state is unit-testable without rendering. It
  recomputes no formula and reads no DAL row.
- `src/components/dashboard/kpi/kpi-widget-card.tsx` — the fixed card anatomy
  (label · optional definition affordance · large value · context line), plus
  the span classes spelled from the D2 layout metadata.
- `src/components/dashboard/kpi/basic-kpi-row.tsx` — the metric-specific
  presenters and the row's grid.
- `src/components/dashboard/kpi/metric-info.tsx` and
  `src/components/ui/popover.tsx` — the definition affordance.

The D2 registry remains the only registry. `DASHBOARD_WIDGET_REGISTRY` now
marks the five `basic` entries `implementation: 'current'`; no widget ID,
capability, or ordering changed.

## Deliberate decisions

**Popover, not tooltip.** Radix `Tooltip` opens on hover and focus but has no
open gesture on touch. Mobile is a first-class surface here, so the definition
affordance is a real button backed by Radix `Popover`: pointer, tap, and
Enter/Space all open it, Escape closes it. The 32px target clears the WCAG
2.5.8 AA minimum (24px) without turning a quiet card header into a control
strip. Each trigger is labelled "About &lt;metric&gt;", never a generic "info".

**One `empty`, not five unavailable reasons.** When
`availability.trader === 'empty'` all five cards report `empty` ("No Trades
yet"). "No Trades yet" is one truthful fact about the current filter, not five
independent metric failures. Within a populated set, individual metrics still
report their own reason — `no_losses`, `no_wins`, `no_trading_days`,
`incomplete`, `mixed_currency`, `unsupported_currency_scale` — each in words,
never as a bare dash and never by colour alone.

**Colour only where the data is signed.** Net P&L is the one metric with a
true signed outcome, so it alone takes positive/negative semantic colour, with
zero staying neutral. Trade Win %, Profit Factor, Day Win %, and Avg Win/Loss
stay `text-foreground` however strong they are: a high Win Rate is not a
verdict on the system (CLAUDE.md §1).

**The gain sign is composed here, not by `formatMoney`.** `formatMoney`'s
`signDisplay: 'always'` places the sign after the symbol (`$+10.00`) and marks
a zero total as `+$0.00`. `formatNetPnl` therefore prepends `+` only for a
strictly positive total: `+$1,164.00`, `-$450.00`, `$0.00`. Currency scale
comes from the registry, so JPY renders `+¥124,350`, not a cents split.

**New `multiple` display style.** `formatAnalyticsMetric(metric, 'multiple')`
renders a canonical ratio as `2.36x` so the payoff ratio is not misread as an
R value or a percentage. The existing `r` / `percent` / `factor` styles are
unchanged.

**`basic.avg-win-loss` gains `mobileSpan: 2`.** Five one-column cards in a
two-column mobile grid leave the fifth dangling beside an empty cell, so the
last Basic KPI spans the narrow grid. This is a change to the D2 layout
metadata — the mechanism D3 was told to use — not a second layout system.

**Global unit mode is not consulted.** Each of the five keeps its native
semantic unit regardless of `filters.unitMode`; per-widget unit behaviour is a
later phase's contract.

## Responsive composition

Ordering and spans come from `DEFAULT_DASHBOARD_LAYOUT` in every case.

- `lg` and above: five equal columns, one balanced row. Verified in E2E that
  the five cards share one top edge and their widths differ by ≤1px.
- `md`: three columns — 1·2·3 then 4 plus the spanning fifth, filling both rows.
- Below `md`: two columns, with the fifth card spanning both.
- The value band is bottom-anchored inside the stretched grid row, so values
  and context lines stay on a common baseline even at 320px, where a label
  such as "Trade Win %" wraps onto a second line.
- No horizontal page overflow at 1440, 768, 390, or 320.

`DashboardSkeleton` reserves the same grid, the same span metadata, and a card
height matching the anatomy's three minimum-height regions, so the five cards
do not resize when the server payload arrives. No client-side fetching was
introduced; the Dashboard remains server-driven.

## Verification

| Check                                   | Result                                         |
| --------------------------------------- | ---------------------------------------------- |
| Unit tests (`vitest run`)               | 2247 passed / 158 files                        |
| Lint (`eslint src e2e`)                 | clean                                          |
| Typecheck (`tsc --noEmit`)              | clean                                          |
| Format (`prettier --check .`)           | clean                                          |
| Production build (`next build`)         | compiled successfully, 48 pages                |
| `git diff --check`                      | clean                                          |
| Dashboard E2E, chromium + mobile-chrome | passed against the guarded `TEST_DATABASE_URL` |
| Theme + app-shell E2E                   | 196 passed, 1 skipped                          |

### Known pre-existing failure, outside D3

`e2e/i18n.spec.ts:120` (`/th/app/analytics localizes real analytics sections
and empty Mistakes`) fails on both projects. It asserts a level-2 heading
`ผลการทำงานของระบบและเทรดเดอร์` (`analytics.real.performance.title`) that no
component references any more: this branch's uncommitted Analytics work
replaced that page's IA with Overview / Results / Edge / Behavior regions and
removed the Mistakes section. The spec is stale relative to that work. D3
touched no Analytics component, and updating that page or its spec is out of
D3 scope.

## Visual UAT

`docs/reviews/dashboard-d3-kpi-uat/` — captured in real Dashboard context, not
in isolation. Each case has a cropped KPI-row frame and a full-page frame.

| #   | Case                                 |
| --- | ------------------------------------ |
| 01  | desktop 1440 dark — populated        |
| 02  | desktop 1440 light — populated       |
| 03  | desktop 1440 dark — unavailable mix  |
| 04  | desktop 1440 light — unavailable mix |
| 05  | mobile 390 dark — populated          |
| 06  | mobile 390 light — populated         |
| 07  | mobile 320 dark — populated          |
| 08  | mobile 320 light — populated         |
| 09  | desktop 1440 dark — empty            |
| 10  | desktop 1440 light — empty           |

The unavailable-mix fixture is a price-mode population with no monetary
results and no losers, which exercises Net P&L → `incomplete` and Profit
Factor / Avg Win-Loss → `no_losses` while Trade Win % and Day Win % stay
available.
