# Dashboard D2 Data Contract

Measured and verified 2026-08-26 against the current D1 analytics contracts.
D2 changes delivery architecture only; it does not change any calculation or
population rule.

## Route-level contract

`DashboardPageData` is the one widget-facing payload. The route parses one
URL-backed `DashboardFilterState`, the Dashboard service resolves one
authenticated scope, and the DAL executes the required independent reads in
parallel. Widgets receive composed metric states and never fetch analytics.

Supported public filters are Account (active, explicit, all), 30D/90D/All,
Strategy, and Setup. Strategy Version remains a typed advanced/internal field.
Unit mode is a separate display preference (`money`, `r`, `percentage`) and
does not change eligibility. Symbol, side, session, timeframe, rule adherence,
mistake, and emotion have type-extension space but are not accepted until a
future phase implements their end-to-end filter contracts. Pips/ticks/points,
free-text Confirmation, and unstructured Wave/market context are not accepted.

## Projection count

Before D2, the Dashboard called `getAnalyticsSnapshot`, whose raw bundle ran
14 major analytics projections: Trader, System, pending System count, paired,
Rules, Mistakes, Trader/System Setup Adherence, Trader/System Conditions,
Trader/System Confidence, and Trader/System Emotions. It then separately read
Recent Trades and workspace Needs Attention, while the route also resolved the
active Account independently.

After D2, `getDashboardRawData` resolves scope once and runs five major reads:

1. Population A / Trader
2. Population B / System
3. Population C / paired comparison
4. workspace-operational Needs Attention counts
5. Dashboard-filtered Recent Trades

This removes 9 of the 14 deep analytics projections from the Dashboard path, a
64.3% reduction before counting the former separate rich Journal-list batch
reads. The full Analytics page remains unchanged.

The repaired D1 query-plan baseline remains the relevant database reference:
Trader 90D 0.347 ms, System 90D 3.567 ms, and Actual-exit-anchored paired 90D
0.323 ms over 5,000 fixture Trades. D2 adds no index or cache. Recent Trades and
Needs Attention are intentionally simple bounded/count projections; this phase
records the structural query reduction rather than presenting local warm-cache
wall time as a production SLA.

## Scope decisions

- A/B/C retain their D1 predicates and independent date axes.
- Needs Attention remains workspace-wide operational backlog. The DTO carries
  `scope: 'workspace_operational'` so later copy cannot imply it follows the
  performance filters.
- Recent Trades follows Dashboard Account/Strategy/Setup and date range using
  lifecycle `occurred_at = exited_at ?? entered_at ?? created_at`. This is an
  explicit operational-list axis, not a replacement for any D1 metric axis.
- Recent rows carry explicit Actual/System unresolved values and a typed
  per-row Execution Gap state composed with the canonical `Actual R - System R`
  calculator only when both axes are complete.
- All-Account R remains aggregatable. Net P&L retains D1 empty, incomplete,
  mixed-currency, unsupported-scale, and available states; no FX is introduced.

## Static widget foundation

The code-level registry assigns stable IDs and data capabilities. The default
layout defines deterministic desktop spans plus one/two-column mobile spans and
ordering. Later widgets are reserved but have no component, persistence,
template editor, drag/drop, or resize behavior in D2.
