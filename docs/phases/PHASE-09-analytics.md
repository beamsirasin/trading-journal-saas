# Phase 09 — Dashboard & Analytics

**Depends on:** 08 · **Blocks:** 12

## Goal

Make the product's central question visually obvious at a glance:

> Did the trader lose because the strategy has no edge, or because they did not follow the strategy?

Every chart on the dashboard exists to answer that. Anything that does not is cut.

## Scope

> **Load the `dataviz` skill before writing any chart code, choosing chart colors, or laying out the KPI row.**

### Dashboard (`/app/dashboard`)

**1. Attribution summary — the hero**

Side-by-side System vs Trader KPI columns with a delta between them:

```
                 SYSTEM      TRADER      Δ
Total R           +24.5R      +11.2R    −13.3R
Win rate           58%         44%       −14pt
Avg R             +0.41R      +0.19R    −0.22R
Expectancy        +0.41R      +0.19R    −0.22R
Profit factor      1.9         1.3       −0.6
Max drawdown      −6.2R      −11.8R     −5.6R
```

Plus a plain-language verdict driven by explicit thresholds, not vibes:

- system edge positive + high leakage → _"Your strategy is working. Execution is costing you 13.3R."_
- system edge negative → _"The strategy itself has no edge in this sample. Execution is not the primary problem."_
- both negative → both stated, most severe first
- insufficient sample → _"Not enough closed trades to draw a conclusion (12 of 30)."_

**Never state a verdict below the minimum sample size.** A confident conclusion from 6 trades is worse than no conclusion.

**2. Dual equity curve** — cumulative system R and actual R on one axis. The gap between the lines _is_ edge leakage, and it is the single most important visual in the product.

**3. Attribution KPI row** — Edge Leakage (R), Execution Efficiency (%), Discipline Score, Followed-Plan Rate. Animated counters; `null` results render their reason, never `0`.

**4. Outcome quadrant matrix** — 2×2 of system × trader outcome, counts and total R per cell, click-through to the filtered trade list. The _system win / trader loss_ cell is visually emphasized: it is where the money is going.

**5. Mistake analysis** — mistakes ranked by **total R cost**, not frequency. A rare severe mistake outranks a common trivial one.

**6. Supporting** — R distribution histogram, performance by strategy version, day-of-week / time-of-day, current open positions.

### Filters

Date range, trading account, strategy, strategy version. Applied server-side, reflected in the URL, shareable, and **workspace-scoped regardless of the URL contents**.

### Query & performance

- Aggregations in SQL over persisted derived columns; no per-row decimal work in the request path
- Indexes on `(workspace_id, trading_account_id, exited_at)` and `(workspace_id, strategy_version_id)`
- Date bucketing in the **user's timezone** (`CLAUDE.md` §7), not UTC and not the server's zone
- Exclude soft-deleted and open trades from closed-trade aggregates
- Target < 500ms at 5,000 trades; seed a benchmark fixture and measure

### Presentation

- Skeletons matching final layout (no layout shift), smooth chart transitions, animated KPI values
- Empty state teaches: what the dashboard will show once trades exist, with a link to log one
- Charts degrade on mobile — fewer ticks, simplified legends, scroll containers for wide content; **never a horizontally scrolling page**
- Chart color follows the `dataviz` skill's palette and semantic tokens; system vs actual must remain distinguishable in both themes and for color-vision deficiency (not color alone — differentiate by line style/weight too)

## Out of scope

Custom report builder, PDF export, scheduled email reports, AI commentary, benchmark comparison, Monte Carlo.

## Deliverables

```
src/server/db/queries/analytics.ts
src/server/services/analytics.ts
src/components/charts/**   src/components/dashboard/**
src/app/(app)/dashboard/**
drizzle/0008_analytics_indexes.sql
tests/analytics/{aggregation,timezone-bucketing,verdict-thresholds}.test.ts
```

## Definition of Done

- [ ] System vs trader comparison is the first thing visible
- [ ] Verdict logic threshold-driven and unit-tested, including the insufficient-sample path
- [ ] Dual equity curve renders correctly with sparse and dense data
- [ ] Quadrant matrix links through to correctly filtered lists
- [ ] `null` calc results render their reason, never `0`
- [ ] Timezone bucketing tested across a DST boundary and a non-UTC user
- [ ] Filters cannot widen scope beyond the workspace
- [ ] < 500ms at 5,000 trades on the benchmark fixture
- [ ] Charts readable in dark and light, and without color discrimination
- [ ] Four states, responsive, accessible, reduced-motion honored
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Small samples produce confident nonsense.** Enforce a minimum-sample gate on every verdict; show the count driving each conclusion.
- **Dashboard scope creep.** Six sections is already a lot. Anything not serving the attribution question is deferred.
- **Timezone bucketing bugs are invisible.** They quietly shift trades between days and skew every time-based insight. Test explicitly against DST.
