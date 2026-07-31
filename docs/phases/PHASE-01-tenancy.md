# Phase 01 — Data Model & Tenancy Core

**Depends on:** 00 · **Blocks:** everything with a database record

## Goal

Build the security boundary before there is anything to secure. Ship workspaces, membership, roles, and a scoped query primitive that makes cross-tenant access structurally difficult — then prove it with tests.

This phase intentionally precedes auth. The guard is easier to verify against a fake session than to retrofit onto queries already written without it.

## Scope

### Schema

```
users               id(uuidv7) email(unique, citext) name image
                    timezone(IANA, default 'UTC') created_at updated_at

workspaces          id(uuidv7) name slug(unique) owner_user_id
                    created_at updated_at deleted_at

workspace_members   id workspace_id user_id role created_at
                    UNIQUE(workspace_id, user_id)
```

`role ∈ { owner, admin, member }`. Owner is the billing subject and cannot be removed while the workspace exists.

Conventions applied to every business table from here on:

- `workspace_id` NOT NULL, FK, **indexed first** in every composite index — every query filters on it
- UUIDv7 primary keys
- `created_at` / `updated_at` as `timestamptz` UTC
- Soft delete via `deleted_at` where historical analytics must stay stable

### Tenant context primitive

```ts
type WorkspaceContext = {
  userId: string;
  workspaceId: string; // resolved server-side, never from client input
  role: Role;
};
```

- `resolveWorkspaceContext(session, requestedSlug?)` — verifies membership, returns context or throws
- `requireWorkspace(minRole)` — guard middleware for server actions
- `assertRole(ctx, minRole)` — role hierarchy check
- Scoped query helpers in `src/server/db/queries/` that **take a `WorkspaceContext` as their first argument** and inject `workspace_id` into every `where` clause

The design intent: writing an unscoped query should require deliberately bypassing the helper, not merely forgetting to add a filter.

### Authorization tests (the real deliverable)

Integration tests against a real Postgres, seeded with two workspaces and three users:

- member of A cannot read, update, or delete any record of B — **by direct ID**
- passing a foreign `workspaceId` in input is ignored or rejected; session scope always wins
- role escalation is rejected (`member` cannot perform `admin` actions)
- non-member is rejected even with a valid session
- soft-deleted workspace denies access
- every scoped helper filters by `workspace_id` (enumerate helpers; fail on any that does not)

## Out of scope

Login UI, OAuth, team invitations, entitlements, any product table.

## Deliverables

```
src/server/db/schema/{users,workspaces,workspace-members}.ts
src/server/db/queries/scoped.ts
src/server/auth/context.ts      src/server/auth/guards.ts
src/test/factories.ts           src/test/db.ts
drizzle/0001_tenancy.sql
tests/tenancy/isolation.test.ts
```

## Definition of Done

- [ ] Migration generated, applied, committed
- [ ] Cross-tenant isolation tests pass against real Postgres
- [ ] Guards reject unauthenticated, non-member, and insufficient-role callers
- [ ] Client-supplied workspace ID provably cannot widen access
- [ ] Typecheck, lint, tests, build pass

## Assumptions

- **A5** — signup auto-creates a personal workspace; invitations deferred post-MVP. Schema supports teams now so no migration is needed later.

## Risks

- **Scope leak through a raw query.** Any `db.select()` outside `queries/` bypasses the guard. Add a lint rule restricting direct db access to that directory.
- **Role hierarchy drift.** Define the ordering once, in one comparison function. Never compare role strings inline.
