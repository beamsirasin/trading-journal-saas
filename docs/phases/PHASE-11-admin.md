# Phase 11 — SaaS Administration

**Depends on:** 04 · **Blocks:** 12

**Status:** 🚧 In progress. **11A** (repository audit, security-boundary design, contract decisions), **11B** (platform-admin persistence and authorization foundation), **11C** (admin route shell, operator Overview dashboard), **11D** (privacy-limited, read-only User and Workspace oversight), **11E** (three named Subscription Support mutations — Extend Trial, Grant Complimentary Plan, Revoke Complimentary Plan — plus a read-only Admin Audit UI), and **11F** (DB-authoritative platform VAT configuration, wired into every canonical quotation/checkout/billing-presentation path, plus `/admin/vat`) are delivered. 11G (closeout) remains undelivered. Phase 11 is not complete.

**11C delivered the first `/admin` UI** — a read-only Overview dashboard at `/admin`, deliberately outside `[locale]` and outside the customer `(app)` shell, EN-only (no `next-intl`), with its own root HTML layout (`src/app/admin/layout.tsx`) and a nested, authoritative auth-guard layout (`src/app/admin/(dashboard)/layout.tsx`) that calls `requirePlatformAdmin()` — never Workspace/entitlement/onboarding state. An authenticated non-admin gets a privacy-limited 404 (`src/app/admin/not-found.tsx`), never a 403 that would confirm the surface exists. The locked metric catalogue (total users, total workspaces, effective subscription-state counts, plan distribution, a supporting entitlement-source breakdown, and two 30-UTC-calendar-day activity trends — new users and Trades logged) is served by a dedicated cross-tenant admin DAL/service (`src/server/dal/admin/metrics.ts`, `src/server/services/admin/metrics.ts`) that reuses the canonical `resolveEffectiveEntitlement` resolver rather than a one-off SQL CASE expression. No admin mutation, no User/Workspace oversight page, no Audit UI, and no VAT UI/runtime wiring exist yet as of 11C — the first two shipped in 11D below.

**11D delivered `/admin/users` and `/admin/workspaces`** — bounded, keyset-paginated, searchable list pages plus read-only detail pages, all still strictly read-only (no Server Action, no mutation affordance anywhere). A dedicated Admin DAL (`src/server/dal/admin/{users,workspaces,entitlements}.ts`) stays structurally isolated from ordinary tenant-scoped DAL — no `workspaceId?`/`skipTenantCheck?`/`adminMode?` escape hatch was added to any existing tenant DAL function, verified directly by a new tenant-isolation regression test. Search accepts either an exact ID or a case-insensitive name/email prefix (`src/lib/admin/search.ts`, safely `ILIKE ... ESCAPE '\'`-escaped); Workspaces additionally filter on `plan` and `source` (never on effective status, which is resolved for display only). A locked privacy contract enumerates fields that must never appear in any oversight DTO — password hash, session/token/IP, raw `accounts`/`sessions` rows, Trade P&L/R/outcome/content, Strategy content, billing-provider identifiers — enforced by both the DTO types themselves and a JSON-round-trip content assertion in every integration test. An unknown `userId`/`workspaceId` renders the same shared privacy-limited 404 the layout guard uses, never a 403. No `drizzle/0010_*.sql` — a dedicated benchmark (`scripts/benchmark-admin-oversight.mjs`) found every material query executes in under 5ms with under 300 shared buffer reads at ~5,000 users/Workspaces/entitlements/memberships scale, matching 11C's own "no migration without measured evidence" outcome.

**11E delivered exactly three named Admin mutations** — `extendTrialByAdmin`, `grantComplimentaryPlan`, `revokeComplimentaryPlan` — and nothing else; no generic `adminPatchEntitlement`/`adminSetStatus`/`adminSetPlan` exists or may be added. Each is a thin transactional shell (`src/server/services/admin/subscription-support.ts`) around pure, unit-tested eligibility/validation logic (`src/lib/entitlements/admin-transitions.ts`) that locks the acting admin's grant row (`SELECT ... FOR UPDATE`, re-verified inside the SAME transaction that mutates the entitlement — a stale pre-transaction admin check is never trusted alone) and the target Workspace+entitlement in the exact `workspaces`-then-`workspace_entitlements` order every customer-facing transition in `subscription-lifecycle.ts` already uses (that helper is now exported and reused, never duplicated). The state write and the `admin_audit_log` insert happen in the same transaction — a failed audit insert rolls back the mutation, and no audit is ever written after a failed mutation. **Extend Trial** requires `source:'trial'` and the canonical `trialing` status, takes an absolute `newTrialEndsAt` (never `daysToAdd`, so a retry is naturally idempotent), and is bounded to 90 days from the transaction's own `now` with no silent clamping. **Grant/Change Complimentary Plan** requires `source` of `'trial'` or `'complimentary'` — never `'paid'`, the one hard boundary — and preserves the original trial's `trialStartedAt`/`trialEndsAt` baseline untouched so **Revoke Complimentary** can restore it exactly; no `billing_transactions` row, provider identifier, or fabricated payment ever results from any of the three. A locked reason-code vocabulary narrower than the DB's own CHECK constraint applies per action. `/admin/audit` is a new, fourth, strictly read-only nav entry (Overview/Users/Workspaces/Audit) backed by a dedicated DAL/service (`src/server/dal/admin/audit.ts`, `src/server/services/admin/audit.ts`) that reuses the Phase 11D `(createdAt,id)` keyset cursor and parses `before_state`/`after_state` jsonb through an explicit field allowlist (`src/lib/admin/audit-snapshot.ts`) before any DTO is built — a malformed/legacy snapshot with an unlisted key is silently dropped, never leaked. No `drizzle/0010_*.sql` — a dedicated benchmark (`scripts/benchmark-admin-audit.mjs`) found every Audit list/filter query and both in-transaction row locks execute in under 1ms using index scans at representative scale.

**11E-patch corrected two closeout-review blockers, still within 11E, before commit.** (1) Complimentary access is now represented with a genuinely null commercial shape — `status:'active'`, `source:'complimentary'`, `currentPeriodStartedAt`/`currentPeriodEndsAt`/`billingCurrency`/`billingInterval` all `null` — rather than the originally-implemented fabricated 100-year period and a placeholder `'USD'`/`'monthly'`. `resolveEffectiveEntitlement` (`src/lib/entitlements/resolve.ts`) gained a dedicated `source === 'complimentary'` branch, gated by an optional `EntitlementRecord.source` field, that grants the plan's account allowance without validating any commercial fields, and fails closed to `expired`/`malformed_entitlement` for any legacy/corrupt row that carries a non-null period, currency, interval, or cancellation flag — this state is never silently trusted as either shape. No `drizzle/0010_*.sql` was needed: the existing `workspace_entitlements` CHECK constraints already tolerate a null period for any status; the fix was entirely in application/resolver logic. (2) A complimentary Workspace can now convert to real paid ONLY through the existing canonical Phase 04 trusted paid-activation path — `activatePaidSubscriptionInTransaction` (`src/server/services/subscription-lifecycle.ts`) accepts an active-complimentary row as a valid entry point (a genuinely active PAID period still requires upgrade/recovery, unchanged), and `checkout.ts`'s `determineCheckoutIntent` treats `source:'complimentary'` as an `'activation'` intent so a real customer checkout — not just an internal API call — can reach it. Every paid field this produces (plan, currency, interval, period, provider identifiers) comes from the trusted checkout/activation input, never from the complimentary row it replaces; no Admin mutation can set `source:'paid'`, and `grantComplimentaryPlan` still rejects an already-paid row. Separately, `scripts/benchmark-admin-audit.mjs` was rewritten to seed and `EXPLAIN ANALYZE` entirely inside one transaction that is always rolled back (never committed), so it — unlike the append-only `admin_audit_log` table it benchmarks — leaves zero permanent residue; a new guarded `scripts/reset-test-database.mjs` (`pnpm db:test:reset`) TRUNCATEs the disposable TEST database between full integration-suite runs for the same reason (TRUNCATE does not fire the row-level append-only DELETE trigger, so no bypass is needed).

**11F wired the DB-authoritative platform VAT configuration into the runtime.** `platform_vat_configuration` (Phase 11B, migration 0009) was persisted but never read by production code until now — `src/config/billing.server.ts`'s `DEFAULT_VAT_CONFIGURATION` (renamed `VAT_CONFIGURATION_LAUNCH_FIXTURE`, kept only as a test-fixture literal) was the live fallback. `src/server/services/platform-vat-configuration.ts`'s `getEffectivePlatformVatConfiguration()`/`...InTx()` is now the ONE production resolver: the latest row with `effective_at <= now`, ordered `(effective_at, created_at, id)` all `DESC` for a deterministic tie-break, missing entirely means `VatConfigurationUnavailableError` (fails closed — a missing tax configuration is never silently treated as "VAT disabled"). Every production consumer now requires an explicit resolved configuration with no default parameter — `getBillingPresentation`/`getCheckoutQuotePresentation` (`src/server/billing/presentation.ts`), `buildSubscriptionManagementPresentation`, and `checkout.ts`'s `prepareCheckout` (resolved through the SAME open transaction as the rest of that checkout, via `getEffectivePlatformVatConfigurationInTx`, so one commercial operation can never straddle two different configurations) — a forgotten call site is now a compile error, not a stale/wrong VAT state. The Admin mutation (`src/server/services/admin/vat-configuration-support.ts`'s `changeVatConfiguration`) mirrors 11E's transactional shell exactly, with one addition: a platform-wide singleton needs its own mutex, so every mutation first locks the immutable migration-0009 baseline row (`FOR UPDATE`, oldest `created_at`) before re-reading the current config and deciding no-op vs. insert — concurrent Admin changes serialize through that lock rather than racing. A change always INSERTS a new row (never UPDATEs) with `effective_at` set to the transaction's own trusted `now` (immediate changes only — no browser-submitted effective date, no scheduling UI); disabling VAT still stores the configured rate, never erasing it. `enabled`/`ratePercent` parsing (`parseExactVatRatePercent`/`formatExactVatRatePercent`, `src/lib/billing/vat.ts`) is pure string-to-integer arithmetic — no `parseFloat`, at most two decimal places, exact basis points. `/admin/vat` (a fifth, EN-only, strictly-scoped nav entry) shows the current configuration plus a bounded 20-row recent history, both resolved independently so history can never disagree with what checkout actually applies; the mutation dialog requires typing `VAT` to confirm. `vat.configuration_changed` Admin Audit entries and the `configuration_change`/`other` reason vocabulary already existed from 11B, unused until now. No `drizzle/0010_*.sql` — a dedicated benchmark (`scripts/benchmark-vat-configuration.mjs`, same transaction-and-rollback zero-residue pattern as `benchmark-admin-audit.mjs`) found the effective-lookup, history, and mutex-lock queries all execute in under 1ms at 1,000-row scale using the existing `platform_vat_configuration_effective_idx`.

**11B locked a deliberate deviation from this document's original sketch**, after the 11A audit's own instruction to "strongly assess whether a dedicated `platform_admins` table... is preferable": platform-admin authority is a dedicated **grant-history table** (`platform_admins`, one row per grant lifecycle, partial-unique-indexed to at most one active grant per user), not a `users.is_platform_admin boolean` flag. This isolates platform authority from a table Better Auth itself owns the shape of, and gives revocation history for free — see `docs/data-dictionary.md`'s "Phase 11B — Platform administration foundation" section for the implemented schema, and `src/server/auth/admin-dal.ts` for `requirePlatformAdmin()`. Every other locked decision below (single `platform_admin` role, DB-only provisioning via `scripts/platform-admin.mjs`, `admin_audit_log` dedicated table, VAT admin-owned persistence) matches this document's original intent.

## Goal

Minimum viable operator tooling: see who signed up, what they are paying, and fix a subscription when the mock flow misbehaves. Deliberately small.

## Scope

### Platform admin role

Separate from workspace roles. A workspace `owner` is not a platform admin.

```
users.is_platform_admin  boolean not null default false
```

- Granted only by direct database update — **no UI to promote an admin**, no self-service escalation path
- `/admin/*` guarded by middleware **and** re-checked in every admin action; middleware alone is not the authorization boundary
- Every admin action written to `admin_audit_log` (actor, action, target, before/after, timestamp). Non-negotiable: admins act on other people's data.

### Metrics (`/admin`)

Total users, workspaces, active subscriptions by plan, trials active / converted / expired, trial→paid conversion rate, signups over time, trades logged over time.

Simple SQL aggregates. No analytics pipeline, no warehouse.

### Users (`/admin/users`)

- List: email, signup date, workspace count, plan, status, last activity
- Search by email; filter by plan and status
- Detail: workspaces, subscription, usage counts
- **No trade data.** Operators do not need to read customers' trading records to run the business, and the default should be that they cannot.

### Subscriptions (`/admin/subscriptions`)

- List with filters
- Manual overrides: extend trial, change plan, change status, comp an account
- Every override requires a **reason**, recorded in the audit log
- Overrides reuse the Phase 04 billing state machine — no direct row edits that could produce an invalid state

### VAT configuration

VAT configuration belongs to the admin phase; customer-facing calculation and checkout behavior belongs to Phase 04.

- Admin-only enable/disable control; there is no customer or public mutation path
- Disabled by default at launch because the business is not initially VAT registered
- Configurable rate prepared initially as 7%
- Changing the setting or rate affects only future checkouts; historical billing, price, rate, tax, and total snapshots remain immutable
- Every change requires a reason and an `admin_audit_log` entry with before/after values
- The server supplies the effective VAT setting and rate to Phase 04 billing logic; client input can never select or override either the rate or tax amount

## Out of scope

Impersonation, support ticketing, refunds, email campaigns, feature flags, per-user config, content moderation, reading customer trade data.

## Deliverables

```
src/server/db/schema/admin-audit-log.ts
src/server/auth/admin-guard.ts
src/server/actions/admin.ts
src/app/admin/**
drizzle/0009_admin.sql
tests/admin/{access-control,audit-log,override-state-machine}.test.ts
```

**11B actually delivered** (persistence/authorization foundation only — paths adapted to repository convention; tests are co-located `*.test.ts` / `*.integration.test.ts`, not a separate `tests/admin/` directory):

```
src/server/db/schema/platform-admins.ts
src/server/db/schema/admin-audit-log.ts
src/server/db/schema/platform-vat-configuration.ts
src/server/db/schema/workspace-entitlements.ts     (added .source column)
src/config/admin-audit-actions.ts
src/server/auth/admin-dal.ts                        (requirePlatformAdmin / getOptionalPlatformAdmin)
src/server/services/admin-audit-log.ts              (insertAdminAuditLog)
src/server/services/platform-admin-provisioning.ts  (grantPlatformAdmin / revokePlatformAdmin)
src/server/services/entitlement.ts                  (startTrialInTx now sets source: 'trial')
src/server/services/subscription-lifecycle.ts        (activatePaidSubscriptionInTransaction now sets source: 'paid')
scripts/platform-admin.mjs                          (operational grant/revoke — no UI, no route)
drizzle/0009_platform_admin_foundation.sql
+ co-located unit and *.integration.test.ts files for all of the above
```

Still outstanding after 11B: `src/server/actions/admin.ts`, `src/app/admin/**` — both delivered in 11C below (mutations remain deferred). `src/server/auth/admin-guard.ts` is superseded by `admin-dal.ts`'s naming (matching this document's own §3's "conceptually, `src/server/auth/admin-dal.ts`").

**11C actually delivered** (the first `/admin` UI — read-only route shell and operator Overview dashboard; no `admin.ts` Server Action file exists because 11C has no mutations to guard):

```
src/app/admin/layout.tsx                            (root HTML document — EN-only, no NextIntlClientProvider)
src/app/admin/not-found.tsx                          (privacy-limited 404 — no AdminShell chrome)
src/app/admin/(dashboard)/layout.tsx                 (authoritative guard: requireSession + requirePlatformAdmin)
src/app/admin/(dashboard)/page.tsx
src/app/admin/(dashboard)/loading.tsx
src/app/admin/(dashboard)/error.tsx
src/components/admin/admin-shell.tsx                 (header, "Overview"-only nav, sign-out)
src/components/admin/admin-sign-out-button.tsx
src/components/admin/admin-copy.ts                   (plain EN copy — no next-intl keys added)
src/components/admin/admin-overview-page.tsx          (+ AdminOverviewSkeleton, + .test.tsx)
src/components/admin/admin-count-table.tsx
src/components/admin/admin-chart-container.tsx        (i18n-free fork of product/chart-container.tsx)
src/components/admin/admin-activity-chart.tsx
src/lib/admin/date-window.ts                          (resolveUtc30DayWindow, + .test.ts)
src/server/dal/admin/metrics.ts                       (cross-tenant aggregate queries)
src/server/services/admin/metrics.ts                  (getAdminOverviewDashboard, + .test.ts, + .integration.test.ts)
src/proxy.ts                                          (narrow /admin optimistic branch, before next-intl)
src/app/[locale]/(public)/login/page.tsx               (/admin callback bypasses locale-aware redirect)
src/components/auth/auth-form.tsx                      (/admin callback bypasses locale-aware router.push)
e2e/support/provision-platform-admin.ts                (guarded E2E grant/revoke helper)
e2e/admin.spec.ts
scripts/benchmark-admin-metrics.mjs
```

No `drizzle/0010_*.sql` — the representative-scale benchmark found no measurable need (see the 11C report for full `EXPLAIN` figures: every material query executes in 1–8ms with zero disk reads at ~5,000 users/Workspaces/entitlements and ~18,000 Trades).

**11D actually delivered** (read-only User and Workspace oversight — search, keyset pagination, plan/source filters, sanitized detail pages; still zero mutations):

```
src/lib/admin/search.ts                              (parseAdminSearchQuery, escapeLikePrefix, + .test.ts)
src/lib/admin/cursor.ts                               ((createdAt,id) keyset cursor, + .test.ts)
src/lib/admin/format.ts                                (shared UTC date formatting)
src/server/dal/admin/users.ts                          (listAdminUsers, getAdminUserById, listProvidersForUsers, listActiveMembershipsForUsers)
src/server/dal/admin/workspaces.ts                     (listAdminWorkspaces, getAdminWorkspaceById, listOwnersForWorkspaces, account/strategy/trade counts, billing summary queries)
src/server/dal/admin/entitlements.ts                   (shared AdminEntitlementRow projection + toEntitlementRecord — factored out of metrics.ts, re-exported there unchanged)
src/server/services/admin/user-oversight.ts            (getAdminUserList, getAdminUserDetail, + .integration.test.ts)
src/server/services/admin/workspace-oversight.ts       (getAdminWorkspaceList, getAdminWorkspaceDetail, + .integration.test.ts)
src/server/services/admin/tenant-isolation-regression.integration.test.ts
src/server/auth/settings-dal.ts                        (toSafeProvider exported for reuse — no logic change)
src/app/admin/(dashboard)/users/{page,loading}.tsx
src/app/admin/(dashboard)/users/[userId]/{page,loading}.tsx
src/app/admin/(dashboard)/workspaces/{page,loading}.tsx
src/app/admin/(dashboard)/workspaces/[workspaceId]/{page,loading}.tsx
src/components/admin/admin-user-list-page.tsx          (+ AdminUserListSkeleton)
src/components/admin/admin-user-detail-page.tsx        (+ AdminUserDetailSkeleton)
src/components/admin/admin-workspace-list-page.tsx     (+ AdminWorkspaceListSkeleton)
src/components/admin/admin-workspace-detail-page.tsx   (+ AdminWorkspaceDetailSkeleton)
src/components/admin/admin-user-search-form.tsx
src/components/admin/admin-workspace-filter-form.tsx
src/components/admin/admin-pagination-nav.tsx
src/components/admin/admin-shell.tsx                    (nav: + Users, + Workspaces)
src/components/admin/admin-copy.ts                       (+ users, workspaces, subscriptionLabels, providerLabels)
e2e/admin-oversight.spec.ts
scripts/benchmark-admin-oversight.mjs
```

Still outstanding after 11D: subscription overrides, `admin_audit_log` UI/export, VAT configuration UI, async import/export jobs, impersonation, account/workspace deletion — all 11E+.

**11E actually delivered** (exactly three named Subscription Support mutations + a read-only Admin Audit UI; still no arbitrary paid-plan override, past-due recovery, paid cancellation, VAT wiring, impersonation, suspension, or deletion):

```
src/lib/entitlements/admin-transitions.ts               (pure eligibility/validation: evaluateTrialExtension, evaluateComplimentaryGrant, evaluateComplimentaryRevoke, + .test.ts)
src/lib/admin/audit-snapshot.ts                          (parseAdminAuditStateSnapshot allowlist parser, + field labels)
src/server/auth/admin-dal.ts                              (+ lockActivePlatformAdminGrant — in-transaction row-locked admin recheck)
src/server/services/subscription-lifecycle.ts             (lockWorkspaceAndEntitlement exported for reuse — no logic change)
src/server/services/admin/subscription-support.ts         (extendTrialByAdmin, grantComplimentaryPlan, revokeComplimentaryPlan, + .integration.test.ts)
src/server/actions/admin/subscription-support.ts           (extendTrialAction, grantComplimentaryPlanAction, revokeComplimentaryPlanAction)
src/server/dal/admin/audit.ts                              (listAdminAuditLog, listActorIdentitiesByGrantIds)
src/server/services/admin/audit.ts                         (getAdminAuditList, + .integration.test.ts)
src/app/admin/(dashboard)/audit/{page,loading}.tsx
src/components/admin/admin-audit-list-page.tsx             (+ AdminAuditListSkeleton)
src/components/admin/admin-audit-filter-form.tsx
src/components/admin/admin-subscription-support.tsx        (Extend Trial dialog, Grant/Revoke Complimentary type-to-confirm dialogs)
src/components/admin/admin-workspace-detail-page.tsx       (+ Subscription Support section)
src/components/admin/admin-shell.tsx                        (nav: + Audit; nav <ul> now flex-wrap — 4 entries overflowed 320px otherwise)
src/components/admin/admin-copy.ts                          (+ audit, workspaces.detail.subscriptionSupport)
e2e/support/provision-entitlement-source.ts                 (setWorkspaceEntitlementSourceForUser, getPersonalWorkspaceId)
e2e/admin-subscription-support.spec.ts
e2e/admin-oversight.spec.ts                                 (two assertions updated: heading/button-name collisions with the new Subscription Support section)
scripts/benchmark-admin-audit.mjs
```

No `drizzle/0010_*.sql` — see the 11E report for full `EXPLAIN` figures.

Still outstanding after 11E: VAT configuration UI/runtime wiring, closeout — 11F/11G.

## Definition of Done

- [ ] `/admin/*` unreachable by non-admins — tested at middleware _and_ action level
- [ ] No UI path grants admin to anyone
- [ ] Every admin mutation writes an audit entry with actor and reason
- [ ] Overrides cannot produce an invalid subscription state
- [ ] VAT enablement and rate are admin-only, audited, and cannot rewrite historical billing snapshots
- [ ] Admin surfaces expose no customer trade data
- [ ] Responsive (operators use tablets), accessible
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Middleware-only guards fail.** A missed matcher pattern silently exposes a route. Always re-check in the action.
- **Privacy.** Admin tooling is the easiest place to over-collect. Keep the trade-data boundary firm; widening it later is a deliberate decision, not a drift.
