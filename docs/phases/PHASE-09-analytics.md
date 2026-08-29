# Phase 09 — Dashboard & Analytics

**Depends on:** 08 · **Blocks:** 12

**Status:** Complete. Phase 09A–09F delivered and verified the authenticated analytics read model, canonical composition, real Dashboard, deep Analytics experience, and full closeout. Phase 10 — Settings is next.

> This file records the Phase 09 closeout state. The later
> [Dashboard Global Controls & Date Range Foundation](../reviews/dashboard-global-controls-date-range-foundation.md)
> extends its shared date vocabulary with period-to-date and custom ranges while preserving the
> original 30D/90D/All meanings.

## Goal

Answer three different questions without collapsing their populations:

1. **System performance:** what the resolved Strategy/Setup counterfactual produced.
2. **Trader performance:** what the trader actually achieved on closed Trades.
3. **Paired comparison:** the difference on the same Trades eligible on both axes.

Phase 07D remains the only canonical formula authority.

## Delivered scope

### Filters and date semantics

- Dashboard `/app`: active Trading Account only; `30d`, `90d`, `all`; default `90d`.
- Deep `/app/analytics`: active Account by default, explicit All Accounts, archived historical Account identities, Strategy, Setup, and Strategy Version; `30d`, `90d`, `all`; default `90d`.
- Unknown URL keys, array values, malformed UUIDs, invalid dependencies, and foreign-workspace identities return the same closed invalid-filter result and never broaden scope.
- Bounded presets mean today plus the preceding 29/89 calendar days in the persisted user IANA timezone. Bounds are `[local start midnight, local day-after-end midnight)` converted to UTC through the shared DST-aware time primitives. No fixed-hour subtraction or browser/server timezone authority is used.

Not implemented: `7d`, YTD, custom date, Symbol, Direction, Timeframe, or Session global filters.

### Populations

- **Trader:** `status = closed`, nondeleted, Actual R/outcome present, `exited_at` present; System state is irrelevant. Bounded filtering uses `exited_at`.
- **System:** `system_status = resolved`, nondeleted, System R/outcome present, `system_exited_at` present; execution state is irrelevant. Bounded filtering uses `system_exited_at`.
- **Paired:** the same Trade satisfies both eligibility contracts. In a bounded scope, both timestamps must fall inside the selected interval.
- **Rules/Mistakes:** closed, nondeleted Trader population using `exited_at`.

The DAL uses five fixed-shape workspace-scoped projections with no N+1 query path and no aggregate formula in SQL. Reads require an authenticated active membership but not a writable entitlement, so `writable`, `over_limit`, and `read_only` remain readable; removed members are denied.

### Metrics and availability

System and Trader independently expose sample count, Total R, Win Rate, Expectancy/Average R, Profit Factor, Maximum Drawdown R, Average Win/Loss R, Payoff Ratio, and their own equity curve. The UI presents the identical Average R/Expectancy contract once as **Expectancy (Average R)**.

Paired comparison exposes comparable count, paired System Total R, paired Actual Total R, Execution Gap, and System Edge Captured. Paired totals always come from the identical same-Trade population. Bounded pairing is anchored to Actual `exited_at`; `system_exited_at` stays required metadata but is not a second range gate. Execution Gap is `Actual R − System R` and is not clamped. System Edge Captured is available only when paired System Total R is positive and may be negative or above 100%.

Every calculated value is `available`, explicitly `unavailable`, or a sanitized `data_integrity_error`. Supported unavailable reasons are `no_trades`, `no_wins`, `no_losses`, `no_profit_or_loss`, `no_comparable_trades`, `system_has_no_edge`, and `no_rule_checks`. None is rendered as accidental numeric zero, `NaN`, or `Infinity`.

### Equity, Rules, and Mistakes

- Trader and System equity are independent event timelines ordered by their own exit timestamp and Trade id. They are not synchronized, interpolated, or interpreted as a visual Edge Leakage gap.
- Charts use canonical cumulative-R strings; JavaScript number conversion occurs only for final SVG coordinates. Tooltips and accessible fallback tables retain high-precision canonical sources, use the persisted user timezone, honor reduced motion, and remain usable at 320px.
- Rule Analytics preserves exactly `followed`, `violated`, `not_checked`, and `not_applicable`, plus evaluated count. Adherence is `followed / (followed + violated)`; unknown/inapplicable states stay outside the denominator.
- Mistake Analytics supports the nine canonical system labels and ranks distinct Trade count only, deterministically by count then key. Multiple Mistakes per Trade are supported without cost, percentage, severity, or leakage attribution.

### Product surfaces and isolation

- `/app` renders real active-Account System and Trader headline panels, paired comparison, and recent real Trades with pinned historical Strategy/Setup labels. It intentionally has no equity or deep-filter duplication.
- `/app/analytics` renders the complete metric panels, strict filters, paired comparison, two independent equity charts, Rule summary, and count-only Mistakes.
- Authenticated routes import no `demoBundle` or fixture analytics. Static fixtures remain only for the explicitly labelled public `/demo`, which remains functional.
- Analytics are R-first: no aggregate currency P&L, money equity/drawdown, or FX conversion exists.
- No verdict, grade, confidence layer, Discipline Score, mistake-cost attribution, or “costliest mistake” claim exists in authenticated analytics.

## Historical identity behavior

Filter selectors use immutable IDs. Archived Accounts, Strategies, Setups, and Strategy Versions remain selectable when nondeleted Trade history exists. Selector presentation may use a current label when available, but Trade list/detail always render each Trade’s pinned Version labels; renaming current framework content does not rewrite historical Trade display.

## Performance and migration result

The guarded `pnpm run analytics:benchmark` creates and removes a deterministic 5,000-Trade fixture only in `TEST_DATABASE_URL`. At 09F closeout, all eight representative plans used indexes; execution ranged from 0.288 ms to 5.118 ms, with bounded in-memory sorts and zero shared-block reads. No measurable regression justified another index, so migrations `0000`–`0008` remain unchanged and no migration `0009` exists.

## Closeout verification

- Focused analytics unit/component: 8 files, 90 tests passed.
- Focused Phase 06–09 PostgreSQL: 13 files, 340 tests passed.
- Complete guarded PostgreSQL: 35 files, 541 tests passed on PostgreSQL 18.4.
- Focused production Analytics/Dashboard/public-demo matrix: 31 passed; four intentional cross-project skips (desktop-only on Mobile Chrome and mobile-only on Chromium).
- Full repository production E2E: 383 passed and six intentional project-matrix skips across 389 collected tests, after correcting stale pre-Phase-09 empty-state assertions and completing a later uncontaminated full run.
- Repository format, lint, typecheck, unit, schema check, production build, and client scan passed as final clean closeout gates; see the Phase 09F handoff for command-level detail.

## Deferred

- Discipline Score and weighted mistake penalties.
- Mistake-cost/lost-R/leakage attribution and custom Mistake taxonomy.
- Verdicts, grades, confidence, and minimum-sample policy.
- FX/currency portfolio analytics and aggregate money equity/drawdown.
- Custom date, `7d`, YTD, and Symbol/Direction/Session/Timeframe global filters.
- Advanced breakdowns, outcome quadrant UI/drill-down, broker imports, Monte Carlo, AI coaching, partial fills, scaling, and multi-leg analytics.

## Phase 10 readiness

Phase 10 is **Settings**: profile/preferences, workspace controls, subscription/billing history, data export, and danger-zone lifecycle. Existing authentication, membership/role checks, entitlement modes, active-account preferences, persisted IANA timezone, billing snapshots, and complete Phase 09 analytics provide its dependencies.

Before implementation, Phase 10 must resolve its stale/provisional assumptions about custom Mistake taxonomy versus Phase 09’s explicit deferral, references to nonexistent historical Discipline Scores, configurable break-even defaults versus the global Phase 07C constant, workspace/account soft-delete and hard-delete-job semantics, OAuth provider metadata, importable export schema/versioning, and which existing `/app/settings` surface is replaced or extended.
