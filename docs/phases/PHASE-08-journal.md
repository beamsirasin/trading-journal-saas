# Phase 08 — Trade Journal

**Depends on:** 07 · **Blocks:** 09

**Status:** In progress. 08A (repository audit), 08B (Trade domain services and lifecycle — `src/server/services/trade-management.ts`, `trade-discipline.ts`), and 08C (authenticated Trade DAL, strict Zod validation, and Server Actions — `src/server/dal/trades.ts`, `src/lib/trades/{schemas,errors}.ts`, `src/server/actions/trades.ts`) are complete; no UI exists yet (08D's job). 08C's boundary follows the exact Strategy Action/DAL conventions (Phase 06D): every Action returns one closed, JSON-serializable discriminated result — no `bigint`, no `Date` object — with account-currency money transported as integer minor-unit strings and timestamps as ISO-8601 strings, converted at the trusted server boundary via `@/lib/time`'s `parseInstant`, never `new Date(string)` or browser-locale parsing; the client supplies primitive inputs only, never a derived/trusted field (`strategyVersionId`, `actualR`, `calcVersion`, `status`, audit metadata, etc — `.strict()`-rejected structurally); `requireTradeManagement` (`src/server/auth/dal.ts`) is authentication + active-membership only, deliberately never entitlement, so an exact `mutationKey` replay stays replayable under `read_only`/`over_limit`, exactly mirroring `requireStrategyManagement`. The Trade list/detail DAL (`listWorkspaceTrades`/`getWorkspaceTradeDetail`) resolves every Strategy/Setup label from the Trade's own pinned `strategy_version_id`/`setup_version_id` snapshot, never the Strategy's _current_ Version — proven directly by an integration test that renames a Strategy/Setup after a Trade exists and confirms the old Trade still reports the old names while a new Trade reports the new ones. 08B locked the following corrections to this document's original pre-implementation prose, superseding it where they conflict:

- **The server, never the client, resolves and pins `strategy_version_id`/`setup_version_id`.** The client supplies only `tradingAccountId`/`strategyId`/`setupId`; the create transaction resolves the current Strategy Version and the matching Setup Version snapshot under lock, exactly like every other guarded mutation in this codebase (CLAUDE.md §4). The line below in "1. Plan" describing the client "pinning" both version ids was ambiguous on this point — read it as "the service pins," never as a client-supplied value.
- **`planned_target` is optional.** A Trade may be created with a Plan and no Target; `planned_r` is then `null`, not a validation failure.
- **`canceled` is reachable only from `planned`.** Once an actual entry exists (`open`/`closed`), a Trade can never be hidden from Trader performance by canceling it — a genuinely erroneous record uses soft deletion instead.
- **The System axis has no artificial ordering against the Trader axis.** System may resolve before, during, or after the Trader side closes, and may remain `pending` indefinitely after `closed` — there is no rule requiring one to precede the other.
- **No restore for a soft-deleted Trade exists or is planned in Phase 08.**
- **Workspace-defined custom mistake types remain deferred**, not part of Phase 08 — this document's "Workspace-custom mistake types" line (Mistake & discipline capture) exceeds the locked Phase 07 contract's scope; MVP uses only the nine canonical system types.
- **Correction/recalculation policy is locked**: any edit to Plan (`entry`/`stop`/`target`/`direction`) recomputes `planned_r` (and `system_r`/`system_outcome` if System is already resolved) via the same `composePlanned`/`composeSystemResolve` helpers used at first write — never a hand-duplicated formula; a post-close correction to `actual_initial_risk_minor`/`net_pnl_minor` likewise recomputes `actual_r`/`trader_outcome` via `composeTraderClose`.

## Goal

Manual trade capture that makes recording the **system counterfactual** as natural as recording the actual result — because the entire product depends on that data existing.

## The design problem

Traders will not fill in "what would have happened if I followed my rules" if it feels like extra paperwork. If they skip it, the product has nothing to say. Every UI decision here optimizes for that field being filled honestly, quickly, and without judgment.

Two mitigations:

1. **Infer, then confirm.** When plan and actual are identical and the exit reason is target/stop, prefill the system outcome and let the trader confirm in one tap. Never silently derive it — `CLAUDE.md` §1 forbids inferring system outcome from actual profit.
2. **Neutral language.** "What the rules would have done" — not "your mistake". Discipline data only appears if logging it feels safe.

## Scope

### Trade entry

Three-step flow, each step independently valid:

**1. Plan** — account, Strategy AND Setup (both required, not optional — Phase 07B locked decision; a general-purpose Strategy uses an explicit "General Setup"-style Setup rather than a nullable one), pinning the current `strategy_version_id` AND `setup_version_id` together, symbol, direction, planned entry / stop / target, planned size. Live-computed **planned R** shown as the trader types (`src/lib/calc/trade.ts`'s `plannedR`), with a validation error if the stop is on the wrong side of entry.

**2. Execution** — actual entry, actual initial stop, size, entry time, actual exit, exit time, commission / fees / swap. Live **actual R** and net P&L.

**3. Review** — system exit price and outcome (prefilled per above), `followed_plan`, mistakes, Rule checks (`trade_rule_checks`: `followed`/`violated`/`not_applicable`/`not_checked` per Strategy/Setup Rule — not a boolean "was_satisfied" checklist), confidence, TradingView URL, notes.

Additional flows:

- **Quick entry (mobile)** — single scrolling screen, minimum viable fields, finish later
- **Plan-first** — log a `planned` trade before execution, complete it after
- Open trades: enter now, close later; open positions excluded from closed-trade analytics but visible on the dashboard

### Validation (Zod, server-side)

- Stop on the correct side of entry for the direction — hard error, with a plain-language explanation
- `riskPerUnit > 0`
- `exited_at ≥ entered_at`
- Prices positive, decimal precision within instrument bounds
- Costs non-negative
- Closing requires exit price and exit time
- Trading account and strategy version must belong to the caller's workspace _(scoped queries, not client-supplied IDs)_

On save: engine computes derived values, persisted with `calc_version`. Use `src/lib/calc/trade.ts`'s composition helpers as the atomic unit of work — `composePlanned` for the Plan step, `composeTraderClose` for closing the Trader side (never requires System data), `composeSystemResolve` for resolving the System side (independently, since `system_status` can remain `pending` after `status = 'closed'`) — never hand-combine `actualR`/`systemR`/`classifyOutcome`/`CALC_VERSION` at the call site. The first Trade insert referencing a Strategy Version must call `lockStrategyVersionForReferenceInTx` (`src/server/services/strategy-versioning.ts`, already built in Phase 06) in the same transaction, after acquiring the same canonical lock order Phase 06's services already establish (workspace → membership → entitlement → strategy row → current version row → setup row). Phase 07D's aggregate/attribution functions (`aggregate.ts`/`attribution.ts`/`equity.ts`) are multi-Trade calculations and do not belong in a single-Trade write path — they are Phase 09's job, reading already-persisted snapshots, never recomputed per write.

### TradingView

Store the URL. Validate it is a well-formed `https://` URL on a TradingView host, render as a safe external link with `rel="noopener noreferrer"`. Optional thumbnail placeholder. **No API integration, no scraping, no embedding** — out of scope per `CLAUDE.md` §9.

### Mistake & discipline capture

- Multi-select from the workspace taxonomy (nine seeded system types, `severity = 'moderate'`/`weight = 1.0000` neutral defaults — Phase 07B; not yet a differentiated scoring model), with optional per-mistake note
- Workspace-custom mistake types
- Required Rule checks left `not_checked`, or explicitly marked `violated`, surface as an inline prompt, not a scolding
- No Discipline Score or mistake-cost-ranking preview — no approved formula exists yet (explicitly deferred through Phase 07); do not invent one when building this step

### Trade list (`/app/trades`)

- Table: date, symbol, direction, strategy, system R, actual R, outcome pair, mistakes, net P&L
- **System vs actual rendered side by side in every row** — the comparison is the product
- Filters: account, strategy, version, date range, outcome, mistake, followed-plan
- Sort, paginate, saved views optional
- Mobile: cards, not a horizontally scrolling table
- Detail view with full breakdown, R math shown explicitly, chart link, edit, soft delete

## Out of scope

CSV import, broker sync, OCR, screenshot upload, AI review, partial fills, scale-in/scale-out, multi-leg positions.

## Deliverables

```
src/server/services/trade.ts        src/server/actions/trade.ts
src/server/db/queries/trades.ts
src/components/trade/**
src/app/(app)/trades/**
tests/trades/{validation,derived-values,workspace-scope}.test.ts
```

## Definition of Done

- [ ] Full desktop entry flow works end to end
- [ ] Mobile quick entry works one-handed at 320px
- [ ] System outcome is prefilled but always requires explicit confirmation
- [ ] All four outcome quadrants can be recorded
- [ ] Wrong-side stop rejected with a clear message
- [ ] Derived values match the engine's golden fixtures
- [ ] Foreign account/strategy IDs rejected server-side
- [ ] Open trades excluded from closed-trade analytics
- [ ] TradingView URL validated and safely linked
- [ ] Four states, responsive, no horizontal overflow, accessible
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Form length is the adoption risk.** If the full flow takes too long it will not be used. Ruthlessly defer optional fields to step 3, and make partial saves work.
- **Prefilled system outcome invites rubber-stamping.** Accepted trade-off: an easy confirm beats an empty field. Revisit with real usage.
- **Editing a closed trade** must recompute derived values and never leave stale R. Cover in tests.
