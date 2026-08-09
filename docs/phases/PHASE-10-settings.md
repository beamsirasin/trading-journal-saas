# Phase 10 — Settings

**Depends on:** 04, 08 · **Blocks:** 12

**Status:** Next phase; not started. Readiness audit required before implementation because several original bullets below are provisional and conflict with later locked Phase 07–09 contracts.

## Goal

Users control their profile, workspace, preferences, and subscription — including leaving the product cleanly.

## Scope

### Profile (`/app/settings/profile`)

- Display name, avatar (initials fallback; upload optional and deferrable)
- Email shown read-only for OAuth accounts, with the linked provider named
- **Timezone** (IANA) — changing it re-buckets all date-grouped analytics; warn plainly before saving
- Preferred date format and number format
- Theme: dark / light / system

### Workspace (`/app/settings/workspace`)

- Name, slug (uniqueness validated; changing it invalidates existing links — warn)
- Default trading account and default strategy for new trades
- **Provisional decision:** Mistake taxonomy management (add/edit/archive custom types and severity) was explicitly deferred by Phase 09. Approve the taxonomy, localization, historical-selector, and authorization contract before including it. Existing snapshots cannot be described as historical Discipline Scores because no score exists.
- Owner-only actions gated by role, server-side

### Subscription (`/app/settings/billing`)

- Current plan, status, trial or period end date
- Usage against the active trading-account limit only; archived accounts are excluded. Do not show strategy, setup, trade, trade-history, analytics, or feature limits.
- Upgrade / downgrade / cancel / resubscribe, reusing the Phase 04 billing flows
- Billing history rendered from immutable price, currency, subtotal, tax-rate, tax-amount, and final-total snapshots rather than recalculating old payments from current configuration
- Cancellation: explain exactly what happens (read-only, data retained, resubscribe restores) — no dark patterns, no guilt-trip interstitial

All paid plans show the same included features and analytics. Plan comparison differs only by the maximum active trading-account count: Starter 1, Trader 5, Professional 15.

### Data & danger zone

- **Export all workspace data as JSON and CSV.** Available even in read-only/expired state — a user's data is theirs regardless of payment status.
- **Provisional decision:** workspace/account deletion requires type-to-confirm and an explicit destruction list, but the proposed 30-day soft-delete window and hard-delete job have no implemented schema/job contract yet. Decide ownership, recovery, retention, and cascade semantics before implementation.

### Preferences

- Default risk model for new accounts
- **Provisional decision:** a per-account/default break-even tolerance conflicts with Phase 07C's locked global Calculation Engine Version 1 constant. Do not add it without an explicit engine-versioning and historical-backfill decision.
- Reduced-motion override (independent of the OS setting)

## Out of scope

Team member management, invitations, API keys, webhooks, notification preferences, audit log UI.

## Deliverables

```
src/server/actions/{profile,workspace,export}.ts
src/server/services/export.ts
src/app/(app)/settings/**
tests/settings/{export-completeness,delete-cascade,role-gating}.test.ts
```

## Definition of Done

- [ ] Every settings mutation authorized server-side with role checks
- [ ] Timezone change warns and correctly re-buckets analytics
- [ ] Export contains all workspace data and is importable-shaped for future use
- [ ] Export works while read-only/expired
- [ ] Deletion requires type-to-confirm and soft-deletes before hard delete
- [ ] Mistake severity edits do not rewrite history
- [ ] Owner-only actions unreachable by `member`, verified by calling actions directly
- [ ] Four states, responsive, accessible
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Deletion cascades are hard to reverse.** The 30-day soft-delete window is the rollback path; verify the hard-delete job cannot run early.
- **Export completeness rots.** Every phase that adds a table must extend the export. Add a test that fails when a table is missing from the exporter.
