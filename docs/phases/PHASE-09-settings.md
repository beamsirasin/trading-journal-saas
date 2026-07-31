# Phase 09 — Settings

**Depends on:** 03, 07 · **Blocks:** 12

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
- Mistake taxonomy management: add / edit / archive custom types, set severity. **Editing severity does not retroactively rewrite historical discipline scores** — the trade's penalty is snapshotted at save time. Say so in the UI.
- Owner-only actions gated by role, server-side

### Subscription (`/app/settings/billing`)

- Current plan, status, trial or period end date
- Usage against limits (accounts, strategies) with clear "3 of 3 used" framing
- Upgrade / downgrade / cancel / resubscribe, reusing Phase 03 flows
- Mock billing history
- Cancellation: explain exactly what happens (read-only, data retained, resubscribe restores) — no dark patterns, no guilt-trip interstitial

### Data & danger zone

- **Export all workspace data as JSON and CSV.** Available even in read-only/expired state — a user's data is theirs regardless of payment status.
- Delete workspace: type-to-confirm, explicit list of what is destroyed, 30-day soft delete before hard delete
- Delete account: cascades owned workspaces, same confirmation rigor

### Preferences

- Default risk model for new accounts
- Default break-even tolerance for new accounts
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
