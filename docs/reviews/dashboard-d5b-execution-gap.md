# Dashboard D5B — Execution Gap Visual Experience

Presentation only. Population A/B/C, the date axes, the Execution Gap
formula, the cumulative calculations, the `DashboardPageData.comparison`
semantics, the query architecture, the fixture data, the App Shell and the
schema are all unchanged. No migration.

## Chart library

**Recharts 3.10.1, already a dependency and already used** by
`equity-chart.tsx`, `cumulative-r-chart.tsx`, `mistake-cost-chart.tsx` and
`admin-activity-chart.tsx`. **No new chart dependency was added.** The
existing conventions were reused rather than reinvented: `ChartContainer`'s
figure/caption/legend/sr-only-table pattern, `equity-chart.tsx`'s
"carry the canonical string in the payload and format it at the tooltip
boundary" technique, `usePrefersReducedMotion`, and the theme CSS variables
for every stroke, grid and surface.

`ChartLegendItem` gained one optional `swatchClassName` so a chart that
deliberately paints its series differently from the product's System/Trader
hues can keep its legend truthful. That is the only shared-primitive change.

## Component architecture

```
ExecutionGapSection            server — orchestrates, owns states, labels dates
  ExecutionGapSummary          server — the four canonical figures
  CumulativeComparisonChart    client — paired System vs Actual
  DailyGapChart                client — per-day Gap, zero-centred
  GapDistribution              server — three relative counts
  ComparisonFallbackTable      server — sr-only data table
```

No 800-line component, no chart-plugin framework, and **no second
composition layer**: every figure is a D5A model value formatted once at the
presentation boundary. The charts convert canonical strings to SVG
coordinates and do no arithmetic.

A server component cannot hand a function to a client one, so the date
labeller runs on the **server** and the charts receive plain pre-labelled
points. That also keeps the axis label next to where the timezone was
resolved, so it cannot drift from the figures above it.

## Section hierarchy

One card, five beats, top to bottom: header (+ definition popover) → summary
strip → cumulative comparison → daily Gap strip → distribution. Not five
competing cards.

| Element                   | Presentation                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Total Execution Gap**   | `-13.80R` at `text-2xl`, signed, negative tone; positive stays `+4.20R` positive, exact zero `0.00R` neutral. Formula never reversed. |
| **Average Execution Gap** | `-0.22R` — D5A's `averageExecutionGapR`, never `total / count` re-derived                                                             |
| **System Edge Captured**  | `61.45%` as a **number**. No progress bar, no radial gauge, nothing that clamps.                                                      |
| **Paired Trades**         | `64` — Population C, allowed to differ from D4's 68 / 66                                                                              |

## Primary chart

Cumulative paired System against cumulative paired Actual, one shared R axis,
`type="linear"` (never a spline through cumulative equity — it would draw
values the account never held). Zero reference drawn; the y-axis is never
cropped to positives. Tooltip shows date, cumulative System R, cumulative
Actual R, cumulative Gap R and paired Trades through that date, all from
canonical strings.

**Series identity.** System = interaction blue (`--primary`), **dashed**
because it is counterfactual. Actual = neutral foreground (`--foreground`) —
near-white on dark, graphite on light — **solid** because it happened.
Deliberately not green/red, and not the System/Trader hues.

The dataviz palette validator was run for both themes rather than eyeballed:

| Check                         | Dark (`#2563eb` / `#ececef` on `#18181c`) | Light (`#1d4ed8` / `#0b1220` on `#ffffff`) |
| ----------------------------- | ----------------------------------------- | ------------------------------------------ |
| CVD separation                | PASS ΔE 41.2 (target 8)                   | PASS ΔE 35.9                               |
| Normal-vision floor           | PASS ΔE 45.1 (floor 15)                   | PASS ΔE 35.7                               |
| Contrast vs surface           | PASS, both ≥ 3:1                          | PASS, both ≥ 3:1                           |
| Lightness band / chroma floor | **FAIL on the Actual slot**               | **FAIL on the Actual slot**                |

Those two FAILs are the validator correctly reporting that one slot is
achromatic. That is the brief's requirement, not a defect — and the redundant
encoding (dashed vs solid, named in the legend, plus the sr-only table) is
what carries identity for anyone the hue does not reach. Reported rather than
hidden.

## Daily Gap

A short strip beneath the cumulative plot, sharing the same local-date
x-axis so one day can be followed down the page. Zero-centred bars from
D5A's `executionGapR`; negative restrained red, positive restrained green,
exact zero neutral. Direction relative to the zero line already says the
sign, so colour is never the only channel. Nothing is recomputed.

## Distribution

`Underperformed System 45 · Matched System 2 · Outperformed System 17` —
relative execution classification, derived from the canonical Gap. No "good"
or "bad" Trades, no grade, no score, no threshold band.

## States

- **Empty** — a titled explanation ("A Trade joins this comparison only once
  it has both a completed Actual outcome and a resolved System outcome"). No
  plot frame, no axes, no legend: a chart of nothing still reads as a chart.
- **Captured unavailable** — only that metric shows
  `No positive paired System edge`. The chart, Total Gap, Average Gap, the
  daily strip and the distribution all still render.
- **Integrity error** — a distinct `role="alert"` that never says "no Trades
  yet", because more Trades cannot fix a stored-data problem.

## Accessibility

Both plots carry `role="img"` with descriptive labels; a visually hidden
`<table>` carries every number (date, paired count, all three cumulatives,
that day's Gap) so essential data is never pointer-only; the legend names
both series and their stroke style in text; unavailable reasons are words;
signed Gap meaning is in text. `prefers-reduced-motion` disables animation.

## Fixture reconciliation — measured, not asserted

Captured from the real Dashboard with the deterministic generator seeded into
the guarded test database (no fixture record edited):

|                       | Value                                                   |
| --------------------- | ------------------------------------------------------- |
| Total Execution Gap   | **-13.80R**                                             |
| Average Execution Gap | **-0.22R**                                              |
| System Edge Captured  | **61.45%**                                              |
| Paired Trades         | **64**                                                  |
| Distribution          | **45 / 2 / 17**                                         |
| **Final chart point** | System **+35.80R**, Actual **+22.00R**, Gap **-13.80R** |
| Daily rows            | 64                                                      |

`35.80 − 22.00 = 13.80` — the chart ends on the paired totals, **not** on
D4's independent +36.25R / +23.10R. The same page shows D4 at 68 and 66
Trades beside D5 at 64; that difference is intentional and preserved.

## Responsive

| Viewport | Section width             | Page overflow | Section overflow |
| -------- | ------------------------- | ------------- | ---------------- |
| 1920     | 1792px (full D4.5 canvas) | 0             | 0                |
| 1440     | 1312px                    | 0             | 0                |
| 390      | 358px                     | 0             | 0                |
| 320      | 288px                     | 0             | 0                |

Summary is two columns on mobile, four at `lg`. Axis ticks thin out via
`interval="preserveStartEnd"` + `minTickGap` rather than shrinking to
unreadable sizes — 320px shows three date labels. No horizontal pan.

## UAT artifacts

`docs/reviews/dashboard-d5b-execution-gap-uat/` — 8 cases, each an isolated
section capture plus a full-page frame, with `metrics.json`.

**One capture caveat, stated because it looks like a bug and is not:** in the
`-page.png` full-page frames the chart lines/bars are absent while the axes
are present. That is a Playwright `fullPage` artifact — the capture resizes
the viewport, Recharts' `ResponsiveContainer` re-measures mid-capture and the
SVG paths blank. Every `-section.png` element capture at the same viewport
shows both series drawn correctly, and the DOM measurements above were taken
from the live page. Read the section captures for the chart and the page
captures for hierarchy.
