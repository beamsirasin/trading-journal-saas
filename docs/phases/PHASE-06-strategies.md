# Phase 06 — Strategies & Setups

**Depends on:** 05 · **Blocks:** 07, 09

**Status:** In progress. This document was written before implementation and originally described a two-table schema (`strategies`/`strategy_versions` only) with no distinct Setup entity, unstructured markdown rule columns, and a `deleted_at` column inconsistent with every other lifecycle this product ships. Phase 06A audited that draft against the approved product model and found it stale on exactly those points; Phase 06B replaced it with the five-table model below, delivering schema, migration, and database-enforced version integrity only — no mutation services, server actions, or UI yet (06C–06E, see [Remaining Phase 06 work](#remaining-phase-06-work)).

## Goal

Strategies and Setups with **immutable versioning**, so that "did the system have an edge?" is answerable per ruleset rather than smeared across every rule change the trader ever made.

## Why versioning is load-bearing

A trader tweaks their rules every few weeks. Without versioning, analytics blends 40 trades under rules A with 60 under rules B and reports one meaningless win rate. Version pinning is what makes system performance a real measurement.

## The approved product model

**Strategy** — a workspace-owned trading system or repeatable decision framework (e.g. "Elliott Wave + RSI", "Breakout and Retest"). Not owned by one trading account; a future Trade independently references a trading account, a strategy, a strategy version, a setup, and a setup version.

**Setup** — a repeatable entry pattern _inside_ a Strategy (e.g. "Wave 2 Reversal", "Wave 3 Continuation"). Cannot exist without a Strategy. Different wave entries do not automatically become different Strategies — they are Setups within one.

**Entitlements** — every plan has unlimited Strategies and unlimited Setups, identical functionality across plans. No Strategy-count or Setup-count limit exists anywhere, by design (CLAUDE.md/plan-catalog.ts's `unlimitedStrategies`/`unlimitedSetups` shared feature keys already reflect this at the presentation layer).

## Delivered in Phase 06B — schema and version integrity

### Schema (`drizzle/0007_strategies_and_setups.sql`)

Five tables, all workspace-owned:

```
strategies                id workspace_id current_version_id
                           is_archived mutation_key created_at updated_at

strategy_versions         id workspace_id strategy_id version_number
                           name description notes change_note
                           locked_at created_at updated_at
                           UNIQUE(strategy_id, version_number)

setups                     id workspace_id strategy_id
                           is_archived mutation_key created_at updated_at

strategy_setup_versions    id workspace_id strategy_id strategy_version_id setup_id
                           name description sort_order created_at updated_at
                           UNIQUE(strategy_version_id, setup_id)

strategy_rules             id workspace_id strategy_version_id setup_version_id
                           rule_key category title description
                           is_required is_pre_trade_check sort_order
                           created_at updated_at
                           UNIQUE(strategy_version_id, rule_key)
```

Full column reference, constraints, and indexes: `docs/data-dictionary.md`.

**Identity rows carry no versioned content.** `strategies` and `setups` are pure identity — no `name`, `description`, `timeframe`, `instrument_class`, or `default_risk` column on either. The name/description a user sees always comes from the current version's snapshot (`strategy_versions` for a Strategy, `strategy_setup_versions` for a Setup within one version). This is what makes immutable versioning possible: the identity a future trade references never changes shape, only which version is "current" changes. Symbol, market, direction, timeframe, session, and every other per-trade fact stay out of this schema entirely — they belong to the future Trade/Journal record (Phase 08).

**No `deleted_at` anywhere.** Archive (`is_archived`) is the only removal mechanism, exactly like `trading_accounts` — no hard-delete application flow exists or is planned.

### Hybrid structured rules (Phase 06A's recommendation, adopted)

`strategy_rules` replaces the original draft's markdown blobs and jsonb checklist with normalized rows, each carrying a stable `rule_key` (survives copy-on-write; a future trade snapshots "the rule with this key, in the version it was pinned to") separate from `id` (identifies one immutable row for one version). `category` is a closed set — `entry` | `invalidation` | `risk` | `management` | `exit` — enforced by both a database CHECK and `src/lib/strategies/constants.ts`'s `STRATEGY_RULE_CATEGORIES`. `setup_version_id` is null for a Strategy-general rule, non-null for a rule scoped to one Setup snapshot within the same version — database-enforced to belong to that same version. No severity weight, penalty value, or analytics result lives here; that is Phase 07/08's job.

### Version immutability (assumption A6) — database-enforced

`strategy_versions.locked_at` transitions null → non-null exactly once. Enforced by a PostgreSQL trigger (`drizzle/0007_strategies_and_setups.sql`), not TypeScript: once `locked_at` is set, every subsequent UPDATE to that row is rejected outright — content, and any attempt to clear or replace `locked_at` itself. Separate triggers reject INSERT/UPDATE/DELETE on child `strategy_setup_versions`/`strategy_rules` rows once their parent version is locked (checked against both the old and new `strategy_version_id` on UPDATE, so a row cannot be reassigned out of a locked version's child set as a back door). Archiving the Strategy or Setup identity row remains a separate operation and never alters historical version content — verified directly (`src/server/db/schema/strategy-domain.integration.test.ts`).

Phase 08 will set `locked_at` atomically the moment the first trade references a version. Phase 06B builds and proves the protection; it never locks a version itself (nothing in this phase creates a locked row outside tests).

**Deletion — narrow workspace-cascade exception.** A locked version (and its locked children) cannot be deleted directly, and deleting its Strategy identity row while the workspace still exists is rejected too, because that delete would cascade into the locked version. The one exception: deleting the _owning workspace itself_ is allowed to cascade a locked version, its `strategy_setup_versions`, and its `strategy_rules` away with it — the same "ordinary tenant-owned record" cascade policy every other business table follows (`ON DELETE CASCADE` on `workspace_id`), not a special case invented for strategies.

The exception is enforced by one shared SQL function, `strategy_domain_workspace_gone(workspace_id)`, called from every delete-protection trigger's `DELETE` branch: it returns true only when the owning `workspaces` row no longer exists. This was verified empirically against real PostgreSQL, not assumed — within a single transaction, by the time a cascading `DELETE` reaches a child row (however many FK levels away, and regardless of which of several redundant `CASCADE` paths reaches it first), the parent workspace row that triggered the cascade is already invisible to a plain `SELECT` run from inside the child's own trigger. A direct delete of a locked version, or of its Strategy identity, with the workspace still present, always sees the workspace as still existing and is rejected exactly as before. This cannot be bypassed by a client, a session setting, or a concurrent uncommitted transaction (ordinary `READ COMMITTED` cross-transaction visibility means another session's in-flight, not-yet-committed workspace deletion is never visible here) — the only way to remove locked strategy history is to genuinely delete the workspace that owns it.

`billing_transactions`' `ON DELETE RESTRICT` is unaffected and unweakened: a workspace with both locked strategy history and a billing transaction still cannot be deleted at all, full stop, whether or not the strategy history would otherwise cascade cleanly — verified directly (`strategy-domain.integration.test.ts`).

### Archive lifecycle

- Strategies and Setups: archive/restore only, exactly like trading accounts. No hard delete, no `deleted_at`.
- Archiving a Strategy makes its Setups unavailable for **new** use but does **not** write `setups.is_archived` — effective availability is the conjunction `strategies.is_archived = false AND setups.is_archived = false`, computed by a future service/query, not stored redundantly.
- Restoring a Strategy reveals previously-active Setups; an individually archived Setup stays archived (no automatic cascade in either direction).
- Archived identity rows never alter historical version content — a locked version's snapshot is exactly what it was, regardless of the Strategy or Setup's current archive state.

### Tenant integrity and referential design

Database-enforced composite foreign keys (not application checks) prevent: a Strategy's `current_version_id` pointing at another Strategy's version; a `strategy_versions`/`setups` row scoped to a different workspace than its parent Strategy; a `strategy_setup_versions` row combining a Setup and a Strategy Version from different Strategies; a `strategy_rules` row scoped to a Setup Version from a different Strategy Version. See `docs/data-dictionary.md` for the exact constraint list. `workspace_id` FKs use `ON DELETE CASCADE` (the ordinary tenant-owned-record convention, same as `trading_accounts` — not `billing_transactions`' deliberately stronger `RESTRICT`), verified unweakened by this migration in `strategy-domain-migration.integration.test.ts`.

### File layout (actual, not the original draft's)

```
src/server/db/schema/{strategies,setups,strategy-setup-versions,strategy-rules}.ts
src/lib/strategies/constants.ts
drizzle/0007_strategies_and_setups.sql
src/server/db/schema/strategy-domain.test.ts                     (unit/schema)
src/server/db/schema/strategy-domain.integration.test.ts         (real Postgres)
src/server/db/schema/strategy-domain-migration.integration.test.ts (real Postgres)
```

`strategies`/`strategy_versions` share one file (like `workspaces.ts`'s `workspaces`/`workspace_members`) because they are mutually referential — a Strategy points at its current version, a version points back at its Strategy. Tests are colocated `*.test.ts`/`*.integration.test.ts` next to their source, the repository-wide convention — not the original draft's separate `tests/strategies/` directory, which does not otherwise exist anywhere in this codebase.

## Remaining Phase 06 work

- **06C — Mutation services and server actions.** Create/edit/archive/restore for Strategies and Setups, the copy-on-write service, and the service that atomically locks a version. Every mutation reuses `requireWorkspaceMembership` and `authorizeWorkspaceMutation(entitlement, 'ordinary_write')` — confirmed in Phase 06A to already cover Strategy/Setup writes with zero changes to `src/lib/entitlements/resolve.ts`: `over_limit` blocks ordinary writes, `read_only` blocks them, `writable` allows them, and reads stay ungated. New `AUDIT_ACTIONS` entries for the lifecycle.
- **06D — Management UI.** Replaces the current fixture-driven placeholder at `/app/strategies` with real list/detail/create/edit/archive/restore, the lock indicator and copy-on-write confirmation dialog, the rule editor, and full en/th localization.
- **06E — Full regression and closeout.** Mirrors Phase 05D: complete unit/integration/E2E regression, stale-reference scan, documentation closeout marking Phase 06 complete and Phase 07 next.

## UI (`/app/strategies`) — target shape for 06D, not yet built

- List with per-strategy Setup count and version count (trade count arrives with Phase 08; showing one now would be fabricated)
- Detail: rules, version history timeline, diff between versions
- Editor with a structured rule builder (add/reorder/toggle required, assign category) and Setup management within the current version
- Explicit lock indicator and copy-on-write confirmation dialog
- Archive/restore only — no delete action anywhere
- Unlimited strategies and setups on the trial and every paid plan; no plan-specific entitlement gate

## Out of scope

Backtesting, rule automation, sharing/marketplace, importing strategies, per-rule analytics (Phase 08 at most reports checklist/rule adherence), trade records, trade-rule checks, System/Trader Performance calculation, severity/penalty weights, default timeframe, instrument class, expected minimum R, target guidance.

## Definition of Done

- [x] Schema models Strategy and Setup as distinct entities, workspace-owned, archive-only
- [x] Unreferenced version content editable in place; version content, once locked, cannot be updated or deleted — enforced by the database, not application code
- [x] Editing a locked version's content is rejected outright (Phase 06C's copy-on-write service will create version _n+1_ instead; the schema/trigger layer only needs to guarantee the old version cannot silently change)
- [x] Child Setup Version and Rule rows immutable once their parent version locks; rejected on insert, update, and delete
- [x] Rule keys stable across copy-on-write (verified: the same `rule_key` is accepted in a different version, rejected as a duplicate within the same version)
- [x] Strategy and Setup creation carries no plan/account-limit column or check anywhere in the schema
- [x] Tenant integrity (cross-workspace, cross-strategy, cross-version combinations) database-enforced and tested
- [x] Typecheck, lint, unit tests, full guarded-Postgres integration suite, production build pass
- [ ] Mutation services, server actions, copy-on-write service, version-locking service (06C)
- [ ] Real management UI, four states, responsive, accessible (06D)
- [ ] Version diff readable on mobile (06D)
- [ ] Full regression and Phase 06 closeout (06E)

## Assumptions

- **A6** — versions immutable once referenced. Phase 06B implements and proves the database-level protection; Phase 08 is what actually sets `locked_at` on a real trade reference.

## Risks

- **Lock-check race** — mitigated at the schema level already: the lock trigger reads `OLD.locked_at` inside the same row-level UPDATE, so two concurrent updates to the same version row serialize on Postgres's normal row lock; a service-layer transaction (06C) should still take an explicit row lock before a copy-on-write read-then-insert sequence, the same pattern `trading-account-management.ts` uses for workspace-row locking.
- **Version sprawl** — frequent editors will generate many versions. Acceptable for MVP; consider draft-then-publish if it becomes noisy.
- **Workspace deletion with locked history — resolved in Phase 06B.** An earlier draft of this migration blocked workspace deletion entirely whenever a locked strategy version existed underneath it (the delete-lock trigger refused the cascade the same way it refuses a direct delete). That contradicted the approved tenant-owned-record policy — strategy-domain rows belong to the workspace, and ordinary workspace deletion should be able to cascade them away, exactly like every other business table. Fixed with a narrowly-scoped exception (`strategy_domain_workspace_gone()`, see [Version immutability](#version-immutability-assumption-a6--database-enforced) above): deletion of locked history is allowed only when it is a direct consequence of the owning workspace itself being deleted, never a direct delete or a Strategy-identity delete while the workspace remains. `billing_transactions`' `ON DELETE RESTRICT` still independently blocks workspace deletion whenever a billing record exists, regardless of strategy content — unweakened.
