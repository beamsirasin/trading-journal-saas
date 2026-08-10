# Phase 10 — Settings

**Depends on:** 04, 08 · **Blocks:** 12

**Status:** In progress. Phase 10A audit, Phase 10B Profile & Preferences, Phase 10C Workspace & Billing Integration, Phase 10D Workspace Data Export, and Phase 10E Account Security are delivered; Phase 10F remains pending.

## Phase 10E delivery

- The single `/app/settings` page now includes account-level Security with safe sign-in-method labels, credential capability, password change, and active-session management. No raw auth account/session rows cross into React.
- Password capability is derived server-side from a real `credential` account with a password. OAuth-only users receive truthful provider-based read-only copy; password creation, provider linking/unlinking, and email change remain deferred.
- Change-password input is strict and reuses the complete registration password policy. Better Auth 1.6.25 verifies the current password and owns the credential mutation. The server then invokes Better Auth's separate canonical revoke-other-sessions operation and verifies readback; this preserves the current session row/cookie while revoking every other active session.
- Better Auth's direct server API bypasses the HTTP-router rate limiter, so password attempts reuse the existing database-backed `rate_limits` table through a narrow per-user five-attempt/60-second application key. No migration was needed.
- Active sessions are a SELF-only, token-free DTO with server-derived current-session identity, canonical created/expiry timestamps, and conservative browser/platform labels. Expired sessions, IP addresses, raw user agents, tokens, user IDs, and provider identifiers are excluded.
- Individual revocation accepts only a session UUID. The server resolves a caller-owned OTHER session to its token entirely inside the server boundary, then invokes Better Auth's canonical token-based API. Current-session submission is rejected; foreign/missing IDs share the same idempotent non-revealing result.
- Bulk revocation accepts an empty strict input and uses Better Auth's canonical revoke-other-sessions endpoint. A canonical readback must show no remaining active other sessions before a structural audit is written.
- Password and session success audits are structural only (`changedFields`, `scope`, and `revokedCount`). Credential update, other-session revocation, and application audit persistence are separate canonical operations/transactions; no false atomicity is claimed. Password success is returned only after revocation readback and the audit write, and failures before those complete create no success audit.
- Security has no Workspace, onboarding, membership, Trading Account, role, or entitlement dependency. It remains usable before onboarding and in `read_only`/`over_limit` modes.
- Phase 10E adds no migration and no IP display, OAuth unlinking/linking, set-password flow, email change, MFA/passkeys, account/workspace deletion, team security, Audit Log UI, security alerts, device trust, or API keys. Phase 10 remains in progress pending 10F.

## Phase 10D delivery

- Workspace owners can download a versioned `schemaVersion: 1` relational export as structured JSON or a normalized CSV ZIP from the Settings Data Export section.
- One explicit export registry governs both formats. It includes Workspace, Trading Accounts, Strategies and all versioned Setup/Rule history, Mistake identities referenced by Trades, Trades and their Rule/Mistake snapshots, and sanitized immutable Billing History.
- Archived domain records and soft-deleted Trades remain present. Stored snapshots and relational identities are exported; analytics aggregates, recalculations, and unsupported scoring semantics are not.
- Authentication records, credentials, sessions, tokens, OAuth/provider identifiers, mutation/idempotency keys, raw metadata, Audit Logs, server secrets, and payment-provider internals are excluded.
- Export authorization is server-derived and owner-only. It remains available while writable, read-only/expired, over the Account limit, or before onboarding is complete.
- JSON and CSV preserve exact decimal and large-integer money values as strings and timestamps as ISO 8601. User-authored CSV cells receive spreadsheet-formula injection protection.
- A structural-only `data.exported` Audit event is required before a generated artifact is returned; Audit Log rows themselves are never included in exports.
- The direct Route Handler uses one repeatable-read database snapshot and bounded in-memory generation. Phase 10D adds no migration, async export jobs, Import, Account Archive, Security/session controls, or deletion lifecycle.
- Security remains Phase 10E; deletion remains deferred.

## Phase 10C delivery

- Settings composes a narrow, authenticated active-Workspace summary with the real personal Workspace name, kind, caller role, and canonical access mode; slug is hidden and cannot be edited.
- Workspace owners may rename the active Workspace only under canonical `ordinary_write` authorization. Members, removed memberships, `read_only`, and `over_limit` callers are denied server-side.
- Rename validation is strict and Unicode-safe. Same-name requests are no-ops; changed name plus field-name-only `workspace.updated` audit commit atomically in PostgreSQL.
- Trading Accounts displays the canonical active Account and links to `/app/accounts`; no CRUD or second default-Account preference was duplicated.
- Subscription reuses the Phase 04 presentation and links to `/app/plan`; Billing truthfully links to the immutable-snapshot history at `/app/billing`. No payment lifecycle or VAT control was duplicated.
- Profile and Preferences remain available in every access mode. Pre-onboarding Settings remains reachable while Account, Plan, and Billing route guards remain unchanged.
- Teams/member/invite UI remains deferred. Export is delivered in Phase 10D, Security remains Phase 10E, and deletion remains deferred.
- No migration was required.

## Phase 10B delivery

- The single authenticated `/app/settings` route is reachable before onboarding completes; unrelated `(main)` routes retain their onboarding guard.
- Display name is editable through the canonical Better Auth user API. Email, verification state, provider names, and an existing avatar are display-only.
- Timezone is the database-authoritative account preference. Changing it affects future display and analytics date-range interpretation without rewriting stored timestamps.
- Theme remains browser/device-authoritative through `next-themes`; the database records only the last authenticated observation.
- Locale remains URL/cookie-routing-authoritative; the database records only the last authenticated observation.
- The fabricated reporting currency and authenticated Settings demo fixtures were removed.
- Trading Account, Plan, and Billing management remain in their canonical routes and are truthfully onboarding-gated from Settings.
- No migration was required.
- Workspace/Billing Settings integration remains Phase 10C, Export remains 10D, Security remains 10E, and deletion remains deferred from Phase 10 pending a separately approved lifecycle contract.

The original scope notes below are planning history. Locked slice briefs take precedence where they narrow or supersede an earlier provisional bullet.

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
