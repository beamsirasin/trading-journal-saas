# ADR 0011 — Tenant/workspace authorization model

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

CLAUDE.md §4 requires every user-owned business record to carry a `workspace_id`, requires every server read/write to verify session, membership, role, and record ownership server-side, and forbids trusting a client-supplied workspace/tenant ID. The Phase 2 brief narrows this phase's scope to exactly one workspace per user (`kind = 'personal'`), explicitly deferring team workspaces, invitations, and role-management UI — but the schema and the authorization functions must not paint that future into a corner.

## Decision

**Schema** (`src/server/db/schema/workspaces.ts`, `user-preferences.ts`):

- `workspaces`: `id uuid`, `name`, `slug` (unique), `kind` (`text`, `'personal'` is the only value written this phase — a `CHECK`/values constraint, not a Postgres `enum`, so adding `'team'` later is a data-compatible change, not a `CREATE TYPE`/migration-of-every-row event), `personal_owner_user_id` (nullable — only set for `kind = 'personal'`).
- A **partial unique index**, `workspaces_personal_owner_idx ON workspaces (personal_owner_user_id) WHERE kind = 'personal'` — this is the actual database-enforced "exactly one personal workspace per user" guarantee. Not an application-level check-then-insert (which races), a constraint the database itself refuses to violate.
- `workspace_members`: `workspace_id`, `user_id`, `role` (`'owner' | 'member'` this phase, `text` not `enum` for the same forward-compatibility reason), `status`. `UNIQUE(workspace_id, user_id)`.
- `user_preferences.active_workspace_id` — which workspace a user is currently "in." Read by `getActiveWorkspaceContext()`, never trusted from a client-supplied value for authorization purposes.

**Authorization functions** (`src/server/auth/dal.ts`, server-only):

- `getOptionalSession()` / `requireSession()` — the session check, always first.
- `getActiveWorkspaceContext()` — resolves the caller's active workspace **from their own session-linked `user_preferences` row**, repairing it via the same idempotent `ensurePersonalWorkspace()` path a fresh sign-up uses if it is missing or points at a workspace the user is no longer a member of. Never reads a workspace ID from a request.
- `requireWorkspaceMembership(workspaceId)` — the function every later phase's server action or query must call before trusting a **client-supplied** workspace ID (a URL param, a form field, anything not derived from the session). Queries `workspace_members` for `(workspaceId, sessionUserId, status = 'active')`; throws `ForbiddenError` on no match. This is deliberately independent of "is this the caller's _active_ workspace" — a user may legitimately act on a workspace that is not their currently-active one once multi-membership exists, so membership and "active" are two different questions answered by two different functions.
- `requireWorkspaceRole(workspaceId, minRole)` — layers a role-rank check (`member: 0, owner: 1`) on top of membership, for the first action that needs to distinguish them (none exists yet in Phase 2's UI, but the function exists now so Phase 3+ does not have to retrofit it under a schema that never anticipated it).

No route or server action in Phase 2 currently accepts a workspace ID from the client at all — there is no trading-account, strategy, or trade UI yet to scope. `requireWorkspaceMembership`/`requireWorkspaceRole` exist and are integration-tested (`src/server/auth/dal.integration.test.ts`) precisely so the _first_ Phase 3 route that does accept one has an already-hardened function to call, rather than reinventing the check under deadline pressure.

## Consequences

**Positive**

- "One personal workspace per user" is impossible to violate even under concurrent requests (two simultaneous first-logins, a retried provisioning call) — the partial unique index is the guarantee, not a race-prone `SELECT` then `INSERT`.
- The membership/role functions already support a user belonging to more than one workspace with different roles, so introducing team workspaces later is additive to this model, not a rewrite of it.
- A URL, request body, or hidden form field can carry any workspace ID an attacker likes — `requireWorkspaceMembership` makes that harmless by construction, verified directly by `src/server/auth/dal.integration.test.ts`'s cross-user-workspace-access tests.

**Negative / accepted**

- `role`/`status`/`kind` as `text` with an allowed-values check rather than a Postgres `enum` trades a small amount of database-level type safety for migration flexibility — accepted per CLAUDE.md's general preference for avoiding premature abstraction and per this repo's existing pattern elsewhere (locale/theme in `user_preferences` use the same convention).
- Phase 2 ships the authorization _functions_ for multi-membership and roles without any UI that exercises them beyond "owner of exactly one workspace" — a deliberate over-build relative to this phase's literal requirements, justified because the schema (not just the function signature) would otherwise need a breaking migration to add later, and CLAUDE.md explicitly asks for the schema to "support teams from day one."

## Alternatives considered

| Alternative                                                                                                                                         | Why not                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A single `workspace_id` column on `users` instead of a `workspace_members` join table                                                               | Cannot express future multi-membership at all — would require a schema migration (adding the join table) plus a data migration (backfilling it from the column) the moment team workspaces ship, instead of Phase 3 simply starting to insert additional rows into a table that already exists.                               |
| Postgres `enum` types for `kind`/`role`/`status`                                                                                                    | `ALTER TYPE ... ADD VALUE` cannot run inside the same transaction as other DDL in older Postgres and has sharp edges even in newer versions; a `text` column with an application/CHECK-level allowed-values list is strictly cheaper to widen.                                                                                |
| Deriving "does the user own this workspace" from `workspaces.personal_owner_user_id` directly, skipping `workspace_members` for personal workspaces | Would mean two different authorization code paths (one for personal, one for team) that every future server action would have to remember to call both of — `workspace_members` is populated for personal workspaces too (an `'owner'` row), so exactly one check (`requireWorkspaceMembership`) covers both cases uniformly. |
