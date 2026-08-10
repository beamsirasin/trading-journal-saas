# Phase 11 — SaaS Administration

**Depends on:** 04 · **Blocks:** 12

**Status:** 🚧 In progress. **11A** (repository audit, security-boundary design, contract decisions) and **11B** (platform-admin persistence and authorization foundation) are delivered. **11C** (admin route shell, operator dashboard) is next; 11D–11G (oversight views, subscription overrides + admin audit UI, VAT configuration UI + runtime wiring, closeout) remain undelivered. Phase 11 is not complete.

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

Still outstanding: `src/server/actions/admin.ts`, `src/app/admin/**` — both 11C+. `src/server/auth/admin-guard.ts` is superseded by `admin-dal.ts`'s naming (matching this document's own §3's "conceptually, `src/server/auth/admin-dal.ts`").

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
