# Phase 08 — Trade Journal

**Depends on:** 07 · **Blocks:** 09

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
