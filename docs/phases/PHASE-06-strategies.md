# Phase 06 — Strategies & Setups

**Depends on:** 05 · **Blocks:** 07, 09

**Status:** In progress. This document was written before implementation and originally described a two-table schema (`strategies`/`strategy_versions` only) with no distinct Setup entity, unstructured markdown rule columns, and a `deleted_at` column inconsistent with every other lifecycle this product ships. Phase 06A audited that draft against the approved product model and found it stale on exactly those points; Phase 06B replaced it with the five-table model below, delivering schema, migration, and database-enforced version integrity. Phase 06C then delivered the server-side domain services on top of that schema — creation, copy-on-write, lifecycle, rules, and a Phase 08 lock helper — with no Server Action, page, or UI yet (06D–06E, see [Remaining Phase 06 work](#remaining-phase-06-work)).

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

## Delivered in Phase 06C — domain services, copy-on-write, lifecycle

No Server Action, page, DAL, or UI exists yet — every function below takes `workspaceId`/`actorUserId` already resolved from the session by a future caller (never client input) and independently re-verifies active membership itself, `trading-account-management.ts`'s own defense-in-depth posture.

### Services

- `src/server/services/strategy-management.ts` — `createStrategy`, `updateStrategyContent`, `archiveStrategy`/`restoreStrategy`, `createSetup`, `updateSetupContent`, `archiveSetup`/`restoreSetup`, `createStrategyRule`, `updateStrategyRule`, `removeStrategyRule`, and the shared lock-order helpers every one of them composes.
- `src/server/services/strategy-versioning.ts` — `copyCurrentVersionInTx` (the one centralized copy-on-write primitive) and `lockStrategyVersionForReferenceInTx` (Phase 08's future lock helper).
- `src/lib/strategies/errors.ts` — `STRATEGY_DOMAIN_ERROR_CODES`, a closed, non-sensitive error surface.
- `src/lib/strategies/validation.ts` — pure name/change-note trimming and blank-rejection, checked before any transaction opens.

### Canonical transaction lock order

Documented in full next to `strategy-management.ts`'s shared helpers. Every mutation acquires, in order: (1) the owning `workspaces` row `FOR UPDATE`; (2) active membership verification; (3) canonical entitlement resolution/authorization (`lockAndResolveEntitlement` + `authorizeWorkspaceMutation(entitlement, 'ordinary_write')` — confirmed in Phase 06A to need zero changes to `resolve.ts`); (4) the `strategies` identity row `FOR UPDATE`, where applicable; (5) the Strategy's _current_ `strategy_versions` row `FOR UPDATE`, where applicable; (6) the `setups` identity row `FOR UPDATE`, where applicable; (7) mutation-specific reads/writes. Every mutation locks the same `workspaces` row first, before touching any other table — identical to `trading-account-management.ts`'s own first lock — so nothing in this domain can deadlock against the trading-account or entitlement services. Verified directly: a transaction that unblocks on the Strategy-row lock (step 4) always re-reads `current_version_id` fresh from the row it just locked, never a value cached from before it queued — proven by the concurrency tests below producing a deterministic, non-duplicated result.

### Copy-on-write

`copyCurrentVersionInTx` always performs one thing: a complete, faithful duplication of a Version's content — never partial, never selective. Every higher-level mutation that needs copy-on-write calls it first, then applies its own specific insert/update/delete against the freshly-copied rows, found via the same unique `(strategy_version_id, setup_id)` / `(strategy_version_id, rule_key)` indexes Phase 06B's migration already provides — not via any map the copy function returns. This keeps the copy primitive itself free of per-caller special cases.

A copy: increments `version_number`; copies `name`/`description`/`notes`; stores the required, trimmed `change_note`; starts `locked_at` at null; copies every `strategy_setup_versions` row the source Version owns (including snapshots belonging to a currently-archived Setup — archive state never affects historical content) with new row IDs but the same `setup_id`; copies every `strategy_rules` row (Strategy-level and Setup-level) with a new row ID but the same `rule_key`, remapping `setup_version_id` through an old-to-new map built while copying the Setup Version rows; and only then atomically repoints `strategies.current_version_id` at the new row. `changeNote` is required by every caller **only when the current Version is actually locked** — an unlocked edit-in-place never touches it.

### Strategy lifecycle

`createStrategy` is one atomic transaction: Strategy identity + Version 1 + `current_version_id` set, so no committed row is ever observable with a null `current_version_id` (a persisted null is treated as malformed and rejected safely by every reader, via `strategy_current_version_missing`, never a crash). Workspace-scoped idempotency mirrors `createTradingAccount`'s `mutation_key` pattern, including its step ordering: the workspace row is locked and active membership is always revalidated first — a removed member can never retrieve or mutate data merely by replaying an old `mutationKey` — and only THEN is the idempotency lookup performed. An exact replay of an existing `mutationKey` returns the original Strategy plus the _canonical current_ Version's `versionId`/`versionNumber` (added to `CreateStrategyResult` in Phase 06D — a replay of a Strategy edited since its creation correctly reports the version that replaced Version 1, never a stale reference to a Version the Strategy no longer points at), with no new write and no duplicate `strategy.created` event, and stays safely replayable even after the workspace has since become `read_only`/`over_limit`, since it consumes no entitlement. Entitlement/authorization is resolved only when the lookup misses — a genuinely new `mutationKey` still requires `writable` access; the replay exception never extends to a new key, an update, an archive/restore, or a Rule mutation. `updateStrategyContent` edits `name`/`description`/`notes` in place while unlocked, or copy-on-writes (with a required `changeNote`) while locked; it rejects an archived Strategy outright in both states, before touching the Version at all. `archiveStrategy`/`restoreStrategy` are idempotent, never touch `setups.is_archived`, never create a Version, and never change Version/Rule content.

### Setup lifecycle

`createSetup` rejects an archived Strategy, is workspace-scoped-idempotent on its own `mutation_key` with the identical membership-before-replay ordering `createStrategy` uses, and either snapshots directly into the current Version (unlocked) or copy-on-writes first (locked, `changeNote` required) once a genuinely new key is confirmed writable. `updateSetupContent` rejects an archived Strategy or Setup, and rejects a Setup with no snapshot in the current Version as malformed (`setup_snapshot_missing`) rather than inventing historical meaning. `archiveSetup`/`restoreSetup` are idempotent and refuse to run at all while the parent Strategy is archived — it must be restored first.

### Rule lifecycle

`createStrategyRule`/`updateStrategyRule`/`removeStrategyRule` operate on a Rule identified by its stable `rule_key` within the current Version — Strategy-level when no Setup is supplied, Setup-level (and rejecting an archived Setup) when one is. Category is restricted to the five approved values (`entry`/`invalidation`/`risk`/`management`/`exit`), matching `STRATEGY_RULE_CATEGORIES` and the database CHECK exactly; `is_pre_trade_check` is an independent boolean, never conflated with category. All three copy-on-write when the current Version is locked; removal deletes the copied row from the _new_ Version only, so the Rule remains present, unchanged, in every older Version where it historically existed — hard-deleting Rule history from a locked Version is never possible through these services.

### Future Trade-reference lock helper

`lockStrategyVersionForReferenceInTx` is Phase 08's actual enforcement point for assumption A6. It verifies workspace/Strategy/Version ownership, verifies the Version is the Strategy's _current_ one (a Trade may only newly lock the version it is about to reference — never an older, already-superseded one), locks it, and sets `locked_at` exactly once if it is still null. A repeated call is idempotent, returning the existing `locked_at` rather than erroring; it never unlocks or replaces a set value, matching the database trigger's own one-way rule, which remains the final authority regardless of what this function does. Phase 06C never calls it itself — nothing in this phase creates a locked Version outside tests — but proves it end-to-end for Phase 08 to reuse without rediscovering the lock order.

### Authorization and domain errors

Every mutation is an ordinary business write (`authorizeWorkspaceMutation(entitlement, 'ordinary_write')` — no new operation variant, confirmed in Phase 06A). `writable` allows; `over_limit` and `read_only` deny with `over_limit_workspace`/`read_only_workspace` (`MutationDenialReason` values, reused directly — never duplicated); reads are never gated. A caller who is not an active workspace member gets `workspace_access_denied`, checked before entitlement, membership before authorization. `src/lib/strategies/errors.ts`'s `STRATEGY_DOMAIN_ERROR_CODES` is the complete, stable, non-sensitive error surface for a future Phase 06D action to map to user-facing copy — never a name, description, note, change note, rule title, or workspace ID.

### Audit events

`AUDIT_ACTIONS` gained `strategy.created`/`updated`/`archived`/`restored`, `strategy.version.created`/`locked`, `setup.created`/`updated`/`archived`/`restored`, and `strategy.rule.created`/`updated`/`removed`. `AuditLogMetadata` gained only structural fields — Strategy/Setup/Version/Rule IDs, version number, rule category, Strategy-vs-Setup scope, changed field _names_ — never a name, description, note, change note, rule title, or rule description. Verified directly: the serialized metadata of a `strategy.created`/`strategy.rule.created` event never contains the Strategy name or Rule title/description supplied to create it.

## Delivered in Phase 06D — authenticated DAL, Server Actions, validation and safe error mapping

No page, form, or client component exists yet — this sub-phase is purely the authenticated server boundary a future UI sub-phase wires up to. Every export below derives `workspaceId`/`userId` exclusively from the session (`getActiveWorkspaceContext()`); none accepts one from client input, and the Phase 06C service layer underneath independently re-verifies membership/entitlement regardless of what this layer does.

### Reads (`src/server/dal/strategies.ts`)

`listWorkspaceStrategies()` and `getWorkspaceStrategyDetail(strategyId)` — session-scoped, never entitlement-gated (readable in `writable`, `over_limit`, and `read_only` workspaces alike). A cross-workspace or missing Strategy ID is indistinguishable: both return `strategy_not_found`. Fixed-count batched queries regardless of row count (no N+1): the list uses one query each for Strategies, current Versions, grouped Setup counts, and grouped Rule counts; the detail view loads only a lightweight Version-history summary (`id`/`version_number`/`locked_at`/`change_note`/`created_at`) rather than every historical Version's Rules/Setups. Both fail closed with `strategy_current_version_missing` (or `setup_snapshot_missing`) rather than crash or silently drop a malformed row. Never returns `mutation_key`, `workspace_id`, audit metadata, or a fabricated trade/performance figure.

### Validation (`src/lib/strategies/schemas.ts`)

One `.strict()` Zod object schema per Server Action. An unrecognized key — `workspaceId`, `actorUserId`, `isArchived`, `currentVersionId`, `versionNumber`, `lockedAt`, a raw Rule row `id` — fails validation outright rather than being silently stripped, making the "client can never choose these" boundary structural rather than merely a convention. Shape-only: non-empty/length/character checks, valid UUID, valid enum, non-negative integer — the actual blank-after-trim rejection stays owned solely by `src/lib/strategies/validation.ts` inside the service, so there is exactly one definition of "blank," never two that could drift apart.

### Server Actions (`src/server/actions/strategies.ts`)

Eleven actions — `createStrategyAction`, `updateStrategyAction`, `archiveStrategyAction`, `restoreStrategyAction`, `createSetupAction`, `updateSetupAction`, `archiveSetupAction`, `restoreSetupAction`, `createStrategyRuleAction`, `updateStrategyRuleAction`, `removeStrategyRuleAction` — each: `safeParse` the input, resolve trusted session context (authentication plus active-membership derivation via `requireStrategyManagement` — never an entitlement/access-mode precheck, so it can never block an exact-key replay the service would otherwise allow), call the matching Phase 06C service function, map its result to {@link StrategyActionResult}, and revalidate `/app/strategies` in both locales on success only (including an idempotent replay — the same code path a fresh success takes). Deliberately not exposed: `copyCurrentVersionInTx`, `lockStrategyVersionForReferenceInTx`, or any direct write to `current_version_id`/`locked_at` — those stay internal to the service layer and Phase 08's future Trade-creation transaction.

### The action-result contract

One closed, JSON-serializable discriminated union used by every action:

```ts
type StrategyActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: StrategyPublicErrorCode; fieldErrors?: Record<string, string[]> } };
```

Superseded a first draft that only had `{ ok, code, fieldErrors? }` on the failure branch with no typed success payload at all — a UI could tell a mutation succeeded but never learn the canonical identity or Version it produced. Each `data` shape is the smallest structurally useful response its service call can reliably provide:

- **Create** (`CreateStrategyData`/`CreateSetupData`/`CreateStrategyRuleData`): the created (or replayed) identity, plus the _canonical current_ Version's `versionId`/`versionNumber` at response time — never framed as "the immutable original creation Version," since a later copy-on-write can supersede it — plus `alreadyCreated` (`false`: this call created it; `true`: an exact `mutationKey` replay returned an existing row, no new write). `CreateStrategyResult`'s service type gained a `versionNumber` field in this correction specifically so the replay branch can report the Strategy's actual current version rather than assuming Version 1.
- **Update** (`UpdateStrategyData`/`UpdateSetupData`/`UpdateStrategyRuleData`): the identity plus the current `versionId`/`versionNumber` and `copied` (whether this edit triggered copy-on-write) — all already returned safely by the Phase 06C service, so no extra query was needed.
- **Archive/restore** (`StrategyLifecycleData`/`SetupLifecycleData`): the affected identity ID plus `isArchived`, the final archived state. The Phase 06C service itself only ever returns `{ ok: true }` on success; `isArchived` is populated from a static invariant of which action ran (archive always leaves `true`, restore always leaves `false`) rather than a second, unsafe re-query solely to enrich the result.
- **Rule mutations** (`CreateStrategyRuleData`/`UpdateStrategyRuleData`/`RemoveStrategyRuleData`): `strategyId` plus `ruleKey` — never the internal Rule row id the service's own result type exposes as `ruleId`, since `ruleKey` is the one approved Rule identifier (CLAUDE.md §4) and is already client-supplied, trusted input at the action layer. `removeStrategyRuleAction` additionally reports `alreadyRemoved`.

Never returned by any action: `workspaceId`, `actorUserId`, `mutationKey`, `lockedAt`, or any other audit/internal-only field — proven by dedicated serialization tests asserting the JSON string never contains those substrings.

### Error mapping (`src/lib/strategies/errors.ts`)

`STRATEGY_PUBLIC_ERROR_CODES` — a closed 16-code public surface: `STRATEGY_DOMAIN_ERROR_CODES` minus the Zod-catchable `blank_name`/`blank_title` (folded into `validation_error`), plus four action-layer-only codes (`validation_error`, `unauthenticated`, `conflict`, `unexpected_error`) no service ever returns itself. `mapServiceErrorToPublicCode` performs the fold; every field error is scoped to a client-editable field only (an unrecognized key like `workspaceId` surfaces as a root-level Zod `formErrors` issue, which the action never reads, so it can never be mistaken for an editable field error), and the rejected raw value is never echoed back.

### Localization

`messages/{en,th}.json`'s `strategies.errors` namespace carries all 16 public codes in both locales, reusing the existing `accounts.errors` phrasing for the two shared concepts (`read_only_workspace`/`over_limit_workspace`) for consistency. Parity enforced by the existing `src/i18n/messages.test.ts`.

### Idempotency and replay

Create actions require a client-generated `mutationKey` (UUID), matching `createTradingAccount`'s pattern — never generated server-side. An exact-key replay returns the original identity plus the canonical current Version (`alreadyCreated: true`) with no new write and no duplicate audit event, and stays replayable even after the workspace has since become `read_only`/`over_limit`; a genuinely new key under either state is denied; a cross-workspace replay of the same key is treated as a fresh create attempt in that other workspace, not a replay. Proven at the action layer (not just the service layer) by `src/server/actions/strategies.integration.test.ts`, for both Strategy and Setup creation.

### Authorization boundary — service remains the owner

`requireStrategyManagement` at the action layer is authentication plus active-membership derivation only; it never resolves entitlement/access mode. The Phase 06C service (`strategy-management.ts`) is what actually decides membership → exact-key replay → entitlement-for-a-genuinely-new-key, and independently re-verifies membership itself against the database regardless of what the action layer already checked — a removed member's replay is denied by the _service_, proven by mocking only the action layer's session/membership precheck to succeed while the underlying database membership row is deleted. The service also remains the sole emitter of audit events; the action layer never constructs or duplicates one.

## Remaining Phase 06 work

- **Management UI.** Replaces the current fixture-driven placeholder at `/app/strategies` with real list/detail/create/edit/archive/restore, the lock indicator and copy-on-write confirmation dialog, and the rule editor, wired to Phase 06D's Server Actions and DAL reads.
- **Full regression and closeout.** Mirrors Phase 05D: complete unit/integration/E2E regression, stale-reference scan, documentation closeout marking Phase 06 complete and Phase 07 next.

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
- [x] Strategy/Setup/Rule mutation services, copy-on-write service, Phase 08 version-locking helper (06C)
- [x] Every mutation authorized through the canonical `authorizeWorkspaceMutation(entitlement, 'ordinary_write')` path, membership independently re-verified (06C)
- [x] Copy-on-write centralized, proven to preserve `rule_key`/Setup identity and remap `setup_version_id` correctly, including for an archived Setup's historical content (06C)
- [x] Concurrent mutations against a locked current Version produce a deterministic, non-duplicated result; no orphaned Setup Version/Rule rows (06C)
- [x] Audit metadata for every new action verified to carry no Strategy/Setup/Rule content (06C)
- [x] Authenticated DAL reads, Zod-validated Server Actions, closed public error mapping, en/th localization, idempotent replay proven at the action layer (06D)
- [ ] Real management UI, four states, responsive, accessible
- [ ] Version diff readable on mobile
- [ ] Full regression and Phase 06 closeout

## Assumptions

- **A6** — versions immutable once referenced. Phase 06B implements and proves the database-level protection; Phase 08 is what actually sets `locked_at` on a real trade reference.

## Risks

- **Lock-check race — resolved in Phase 06C.** Every service-layer mutation takes an explicit `FOR UPDATE` lock on the Strategy row (and, where applicable, the current Version row) before deciding whether to edit in place or copy-on-write, the same pattern `trading-account-management.ts` uses for workspace-row locking. Proven directly: two concurrent `updateStrategyContent` calls against one locked Version always produce exactly one copy and one in-place edit of the result (never two competing copies, never a duplicate `version_number`) — the second caller unblocks, re-reads the Strategy row's `current_version_id` fresh, and finds the first caller's new Version already unlocked.
- **Version sprawl** — frequent editors will generate many versions. Acceptable for MVP; consider draft-then-publish if it becomes noisy.
- **Workspace deletion with locked history — resolved in Phase 06B.** An earlier draft of this migration blocked workspace deletion entirely whenever a locked strategy version existed underneath it (the delete-lock trigger refused the cascade the same way it refuses a direct delete). That contradicted the approved tenant-owned-record policy — strategy-domain rows belong to the workspace, and ordinary workspace deletion should be able to cascade them away, exactly like every other business table. Fixed with a narrowly-scoped exception (`strategy_domain_workspace_gone()`, see [Version immutability](#version-immutability-assumption-a6--database-enforced) above): deletion of locked history is allowed only when it is a direct consequence of the owning workspace itself being deleted, never a direct delete or a Strategy-identity delete while the workspace remains. `billing_transactions`' `ON DELETE RESTRICT` still independently blocks workspace deletion whenever a billing record exists, regardless of strategy content — unweakened.
