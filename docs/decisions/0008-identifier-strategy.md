# ADR 0008 — Identifier strategy

- **Status:** Accepted
- **Date:** 2026-08-02
- **Phase:** 02 — Auth and tenancy

## Context

Phase 2 introduces the first real database rows: Better Auth's own tables (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`) and this repo's application tables (`workspaces`, `workspace_members`, `user_preferences`, `audit_logs`). CLAUDE.md §4 requires record IDs to be sortable-but-unguessable UUIDv7, and requires them to be defence-in-depth only — never the authorization mechanism.

Two owners need to agree on one identifier shape: Better Auth's Drizzle adapter, which treats every ID as an opaque string, and Drizzle's own native column types, where a `uuid` column gets real type-checking and index efficiency `text` does not.

## Decision

One generator, `generateId()` (`src/lib/identifiers.ts`), wrapping the `uuidv7` package. Every ID in the system — Better-Auth-owned or application-owned — is produced by this single function. What differs is the **column type** each owner stores it in:

- **Better-Auth-owned tables** (`users`, `sessions`, `accounts`, `verifications`, `rate_limits`): `text` primary keys, wired via `advanced.database.generateId: () => generateId()` in `src/lib/auth/server.ts`. `text`, not native `uuid` — the installed adapter version (`better-auth@1.6.25` / `@better-auth/drizzle-adapter`) resolves IDs as opaque strings at the adapter boundary, and forcing a native `uuid` column risks a driver/type mismatch that isn't documented for this adapter version. Confirmed empirically by reading the installed adapter's own `getSchema`/field-resolution source rather than assumed from general docs.
- **Application-owned tables** (`workspaces`, `workspace_members`, `user_preferences`, `audit_logs`): native Postgres `uuid` columns, populated via Drizzle's `.$defaultFn(generateId)`.
- **Foreign keys crossing the boundary** (e.g. `workspaces.personal_owner_user_id` → `users.id`) are `text`, matching the table they reference — never a JS-number conversion, never a cast.

This is a "text under Better Auth, uuid under the app, joined by matching string values" boundary — documented once here and in `docs/data-dictionary.md`, not reinvented per table.

Uniqueness is enforced by database constraints (primary keys, unique indexes), never by application-level "is this ID already taken" checks — `src/lib/identifiers.test.ts` only asserts format and monotonic ordering, not uniqueness, which is not this module's job to guarantee.

## Consequences

**Positive**

- One mental model and one function for every ID in the codebase — no per-table bikeshedding.
- UUIDv7's embedded millisecond timestamp means IDs sort chronologically, which is useful for `ORDER BY id` and B-tree index locality without a separate `created_at` sort in the common case.
- IDs are unguessable (~74 random bits), so an ID leaking (a log line, a URL) does not hand an attacker a working enumeration primitive — though this is explicitly _not_ relied on for authorization (CLAUDE.md §4); every read/write still re-verifies workspace membership server-side.
- `uuidv7` is a small, zero-transitive-dependency package — a low-risk addition to the dependency tree.

**Negative / accepted**

- Two column types for "the same kind of value" (`text` vs `uuid`) is a real boundary a future contributor must learn — mitigated by keeping it to exactly one crossing point (`users.id` referenced as `text` everywhere) and documenting it in both this ADR and the data dictionary.
- If a future Better Auth adapter version changes how it resolves ID types, this decision should be revisited against that version's actual behavior, not against this ADR's assumption.

## Alternatives considered

| Alternative                                                          | Why not                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native `uuid` for Better-Auth-owned tables too                       | Would require verifying the installed adapter version handles native UUID columns transparently, which is not documented for `better-auth@1.6.25`'s Drizzle adapter. Risking a silent type mismatch in the auth path is not worth the type-purity gain. |
| Sequential integers (`bigserial`)                                    | Enumerable — an incrementing ID directly reveals row counts and lets an attacker guess adjacent IDs, which is exactly what CLAUDE.md §4 asks to avoid even as defence in depth.                                                                         |
| `uuidv4`                                                             | Random UUIDs have poor index locality (no chronological ordering), which matters once `workspaces`/`audit_logs` grow large enough for B-tree page splits to show up in query plans.                                                                     |
| A different ID per table type (`nanoid` for one, `uuid` for another) | Multiplies the ID formats a reader has to reason about for no real benefit — this repo has exactly one identifier concept, not several.                                                                                                                 |
