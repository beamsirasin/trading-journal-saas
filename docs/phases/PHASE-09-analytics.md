# Phase 09 — Dashboard & Analytics

**Depends on:** 08 · **Blocks:** 12

**Status:** Next implementation phase. Phase 08 now provides persisted, server-derived Trade snapshots and authenticated workspace-scoped reads. Phase 09 must build analytics read models over those snapshots; it must not rederive per-Trade R/outcomes or introduce the still-unapproved Discipline Score, mistake-cost attribution, or verdict thresholds by assumption.

## Goal

Make the product's central question visually obvious at a glance:

> Did the trader lose because the strategy has no edge, or because they did not follow the strategy?

Every chart on the dashboard exists to answer that. Anything that does not is cut.

## Scope

> **Load the `dataviz` skill before writing any chart code, choosing chart colors, or laying out the KPI row.**

### Dashboard (`/app` overview and `/app/analytics` detail)

Replace the remaining Phase 01 fixture-backed overview/analytics data sources in the existing localized route structure; do not add a parallel `/app/dashboard` route.

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

Plus a plain-language verdict only after Phase 09 explicitly approves and tests minimum-sample/edge/leakage thresholds, not vibes:

- system edge positive + high leakage → _"Your strategy is working. Execution is costing you 13.3R."_
- system edge negative → _"The strategy itself has no edge in this sample. Execution is not the primary problem."_
- both negative → both stated, most severe first
- insufficient sample → _"Not enough closed trades to draw a conclusion (12 of 30)."_

**Never state a verdict until an approved minimum sample size exists, and never state one below it.** The threshold is a Phase 09 product decision, not an existing Phase 07/08 formula.

**2. Dual equity curve** — cumulative system R and actual R on one axis. The gap between the lines _is_ edge leakage, and it is the single most important visual in the product.

**3. Attribution KPI row** — paired Edge Leakage (R), Execution Efficiency (%), and objective Rule Adherence. A Followed-Plan Rate is allowed only if Phase 09 proves the stored population is meaningfully populated. Discipline Score remains deferred until an approved formula exists. Animated counters; `null` results render their reason, never `0`.

**4. Outcome quadrant matrix** — 2×2 of system × trader outcome, counts and total R per cell, click-through to the filtered trade list. The _system win / trader loss_ cell is visually emphasized: it is where the money is going.

**5. Mistake analysis** — frequency and filtered Trade drill-down may use canonical Mistake snapshots. Ranking Mistakes by R cost remains deferred because multi-Mistake Trades need an explicit non-double-counting attribution policy.

**6. Supporting** — R distribution histogram, performance by strategy version, day-of-week / time-of-day, current open positions.

### Filters

Date range, trading account, Strategy, Setup, and Strategy Version. Applied server-side, reflected in the URL, shareable, and **workspace-scoped regardless of the URL contents**.

### Query & performance

- SQL/read models own workspace scoping, soft-delete/status eligibility filters, filter joins, stable occurrence timestamps, and timezone date buckets. They read persisted R/outcome snapshots and never rederive them from prices/money.
- The server analytics service consumes the canonical Phase 07D functions: `selectTraderEligible`/`selectSystemEligible`, `totalR`, `averageR`, `expectancyR`, `winRate`, `averageWinR`, `averageLossR`, `payoffRatio`, `profitFactor`, `equityCurveR`, `maximumDrawdownR`, `selectComparisonEligible`, `pairedEdgeLeakageR`, `executionEfficiency`, and `ruleAdherenceRate`. Do not duplicate those formulas in SQL or React; benchmark the read-model projection and only introduce materialization with an explicit consistency design.
- Trader eligibility: closed, not deleted, `actual_r` and `trader_outcome` present, regardless of System state. System eligibility: resolved, not deleted, `system_r` and `system_outcome` present. Comparison eligibility is the paired intersection on the same Trade. `pending`, `no_trade`, open, canceled, and soft-deleted rows are never coerced to `0R`.
- Indexes on `(workspace_id, trading_account_id, exited_at)` and `(workspace_id, strategy_version_id)`
- Trader occurrence uses `exited_at`; System occurrence uses `system_exited_at`. Date bucketing and user-entered filter boundaries use the persisted user's **IANA timezone** (`CLAUDE.md` §7), converted to half-open UTC ranges—never browser/server timezone authority.
- Exclude soft-deleted and open trades from closed-trade aggregates
- Target < 500ms at 5,000 trades; seed a benchmark fixture and measure

### Presentation

- Skeletons matching final layout (no layout shift), smooth chart transitions, animated KPI values
- Empty state teaches: what the dashboard will show once trades exist, with a link to log one
- Charts degrade on mobile — fewer ticks, simplified legends, scroll containers for wide content; **never a horizontally scrolling page**
- Chart color follows the `dataviz` skill's palette and semantic tokens; system vs actual must remain distinguishable in both themes and for color-vision deficiency (not color alone — differentiate by line style/weight too)

## Out of scope

Custom report builder, PDF export, scheduled email reports, AI commentary, benchmark comparison, Monte Carlo, Discipline Score, weighted mistake penalties, mistake-cost attribution/ranking, custom Mistake taxonomy CRUD, and recalculation of authoritative Trade snapshots.

## Deliverables

```
src/server/dal/analytics.ts (or one documented analytics read-model boundary)
src/server/services/analytics.ts
src/components/charts/**   src/components/dashboard/**
src/app/[locale]/(app)/app/(main)/{page.tsx,analytics/**}
drizzle/0009_*.sql only if measured query plans require indexes (Phase 09, never Phase 08)
src/**/{analytics,timezone-bucketing,verdict-thresholds}*.test.ts
```

## Definition of Done

- [ ] System vs trader comparison is the first thing visible
- [ ] Any verdict thresholds are explicitly approved, documented, and unit-tested, including the insufficient-sample path; otherwise no verdict is rendered
- [ ] Dual equity curve renders correctly with sparse and dense data
- [ ] Quadrant matrix links through to correctly filtered lists
- [ ] Trader/System/paired populations differ exactly as the calculation spec defines; all exclude soft-deleted Trades
- [ ] `null` calc results render their reason, never `0`
- [ ] Timezone bucketing tested across a DST boundary and a non-UTC user
- [ ] Filters cannot widen scope beyond the workspace
- [ ] No authoritative snapshot or aggregate formula is recalculated in React
- [ ] < 500ms at 5,000 trades on the benchmark fixture
- [ ] Charts readable in dark and light, and without color discrimination
- [ ] Four states, responsive, accessible, reduced-motion honored
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Small samples produce confident nonsense.** Enforce a minimum-sample gate on every verdict; show the count driving each conclusion.
- **Dashboard scope creep.** Six sections is already a lot. Anything not serving the attribution question is deferred.
- **Timezone bucketing bugs are invisible.** They quietly shift trades between days and skew every time-based insight. Test explicitly against DST.
