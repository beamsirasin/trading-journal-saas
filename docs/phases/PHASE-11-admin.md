# Phase 11 — SaaS Administration

**Depends on:** 04 · **Blocks:** 12

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
- Overrides reuse the Phase 03 state machine — no direct row edits that could produce an invalid state

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

## Definition of Done

- [ ] `/admin/*` unreachable by non-admins — tested at middleware _and_ action level
- [ ] No UI path grants admin to anyone
- [ ] Every admin mutation writes an audit entry with actor and reason
- [ ] Overrides cannot produce an invalid subscription state
- [ ] Admin surfaces expose no customer trade data
- [ ] Responsive (operators use tablets), accessible
- [ ] Typecheck, lint, tests, build pass

## Risks

- **Middleware-only guards fail.** A missed matcher pattern silently exposes a route. Always re-check in the action.
- **Privacy.** Admin tooling is the easiest place to over-collect. Keep the trade-data boundary firm; widening it later is a deliberate decision, not a drift.
