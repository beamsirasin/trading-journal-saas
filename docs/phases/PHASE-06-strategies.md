# Phase 06 — Strategies & Strategy Versions

**Depends on:** 05 · **Blocks:** 07, 09

## Goal

Strategies with **immutable versioning**, so that "did the system have an edge?" is answerable per ruleset rather than smeared across every rule change the trader ever made.

## Why versioning is load-bearing

A trader tweaks their rules every few weeks. Without versioning, analytics blends 40 trades under rules A with 60 under rules B and reports one meaningless win rate. Version pinning is what makes system performance a real measurement.

## Scope

### Schema

```
strategies          id workspace_id name description
                    instrument_class timeframe
                    is_archived created_at updated_at deleted_at

strategy_versions   id workspace_id strategy_id version_number
                    entry_rules exit_rules risk_rules      -- markdown text
                    setup_checklist(jsonb)                 -- [{ id, label, required }]
                    is_locked(bool) locked_at
                    change_note created_at
                    UNIQUE(strategy_id, version_number)
```

`current_version_id` on `strategies` for fast default selection.

### Immutability rule (assumption A6)

A version is **editable while no trade references it**. On the first referencing trade it locks permanently.

- Editing a locked version creates version _n+1_ — copy-on-write, with a required change note
- Existing trades keep pointing at the version they were executed under. History never mutates retroactively.
- UI must make this legible: "Version 3 is locked (used by 47 trades). Saving creates version 4."

This is the single most important behavior in the phase. Silent retroactive edits would corrupt every system-performance metric in the product.

### Setup checklist

Ordered items, each `{ id, label, required }`. Phase 07 records which were satisfied per trade; Phase 06 uses **required-but-unchecked** items as a rule-violation signal feeding the discipline score. Checklist item IDs are stable and never reused, so historical trades remain interpretable.

### UI (`/app/strategies`)

- List with per-strategy trade count and version count
- Detail: rules, version history timeline, diff between versions
- Editor with markdown preview and checklist builder (add/reorder/toggle required)
- Explicit lock indicator and copy-on-write confirmation dialog
- Archive; delete only when unreferenced
- Unlimited strategies and setups on the trial and every paid plan; no plan-specific strategy entitlement gate

## Out of scope

Backtesting, rule automation, sharing/marketplace, importing strategies, per-rule analytics (Phase 08 at most reports checklist adherence).

## Deliverables

```
src/server/db/schema/{strategies,strategy-versions}.ts
src/server/services/strategy.ts
src/server/actions/strategy.ts
src/app/(app)/strategies/**
drizzle/0005_strategies.sql
tests/strategies/{version-lock,copy-on-write,checklist-stability}.test.ts
```

## Definition of Done

- [ ] Unreferenced version edits in place; referenced version locks
- [ ] Editing a locked version creates the next version, requires a change note
- [ ] Historical trades still resolve to their original version content
- [ ] Checklist item IDs stable across edits
- [ ] Strategy and setup creation remains unlimited and identical across all plans
- [ ] Version diff readable on mobile
- [ ] Four states, responsive, accessible
- [ ] Typecheck, lint, tests, build pass

## Assumptions

- **A6** — versions immutable once referenced.

## Risks

- **Lock-check race.** Two concurrent edits could both see "unlocked". Check and update under one transaction with row locking.
- **Version sprawl.** Frequent editors will generate many versions. Acceptable for MVP; consider draft-then-publish if it becomes noisy.
