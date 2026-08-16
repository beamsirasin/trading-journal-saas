# Data Dictionary

**Current schema status (Phase 13D):** migrations run exactly `0000`–`0012`. `0011_setup_conditions_domain.sql` adds Setup Conditions and immutable Entry snapshots; `0012_emotions_and_review.sql` adds the Emotion taxonomy/links plus nullable `trades.review_notes` and `trades.emotions_recorded_at`. Migrations `0000`–`0011` remain unchanged.

**Status:** Phases 03–11 are officially complete. Migrations remain exactly `0000`–`0009`: `0009_platform_admin_foundation.sql` (Phase 11B) added the platform-admin authority/audit/VAT-configuration foundation and one additive column (`workspace_entitlements.source`); **none of Phase 11C (the `/admin` Overview dashboard), 11D (read-only User/Workspace oversight), 11E (Subscription Support mutations + Admin Audit UI), or 11F (DB-authoritative VAT runtime wiring) added a migration** — each phase's own representative-scale benchmark found every material query (11E's included both the Admin Audit list/filters and the two in-transaction row locks the new mutations take; 11F's included the effective-VAT lookup, history read, and mutation mutex lock) executing in single-digit milliseconds or less on the existing schema, so no index was justified in any of them (see the Phase 11C/11D/11E/11F reports). `workspace_entitlements.source` (Phase 11B) now has real writers beyond `startTrialInTx`/`activatePaidSubscriptionInTransaction`: `grantComplimentaryPlan`/`revokeComplimentaryPlan` (Phase 11E, `src/server/services/admin/subscription-support.ts`) are the first code to ever write `'complimentary'`, always preserving the original trial's `trial_started_at`/`trial_ends_at` baseline so a later revoke can restore it exactly — no other column outside `workspace_entitlements` changed shape. `platform_vat_configuration` (Phase 11B schema) went live as production runtime authority in Phase 11F: `src/server/services/platform-vat-configuration.ts`'s `getEffectivePlatformVatConfiguration()` is now read by every quotation/checkout/billing-presentation call site, with no default fallback. Phase 11 closed out in 11G (full regression, no schema change): still no arbitrary paid-plan override, past-due recovery, or paid cancellation/reversal exist — those remain deliberately out of scope, not merely undelivered. Phase 04C's schema is fully consumed by customer billing, checkout, mock-provider integration, and the sanitized Workspace export; Phase 06 added the versioned Strategy/Setup/Rule domain and Phase 07B added the Trade/discipline domain consumed by the real Journal, Analytics, and export surfaces.

Tables are added by re-exporting them from `src/server/db/schema/index.ts`.

> **Reading numeric columns.** Financial `numeric` columns stay strings. Billing money uses PostgreSQL `BIGINT` with Drizzle `mode: 'bigint'`, so application values are JavaScript `bigint` and are never coerced to `number`. The sole Phase 2 exception is Better Auth's `rate_limits.last_request`: it is SQL `bigint` with Drizzle `mode: 'number'` because the installed library consumes epoch milliseconds as a number, still safely below `Number.MAX_SAFE_INTEGER`.

## Conventions

Applied to every business table without exception.

| Convention  | Rule                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| Primary key | UUIDv7 — sortable, non-enumerable                                                   |
| Tenancy     | `workspace_id` NOT NULL, foreign key, and **first column in every composite index** |
| Timestamps  | `timestamptz`, always UTC; `created_at` / `updated_at`                              |
| Soft delete | `deleted_at` where historical analytics must remain stable                          |
| Money       | `BIGINT` minor units + ISO-4217 currency code — never `float`, never `double`       |
| Prices      | `NUMERIC(20,10)`, read into TypeScript as strings                                   |
| R-multiples | `NUMERIC(12,4)`                                                                     |
| Naming      | `snake_case` in the database, `camelCase` in TypeScript                             |

---

## Phase 02 — Auth and tenancy (implemented)

Migration: [`drizzle/0000_init_auth_tenancy.sql`](../drizzle/0000_init_auth_tenancy.sql). Identifier boundary (`text` under Better Auth, `uuid` under the app) explained in [ADR 0008](decisions/0008-identifier-strategy.md); authorization model in [ADR 0011](decisions/0011-tenant-workspace-authorization-model.md).

### `users` (Better Auth — owns this table)

| Column                      | Type        | Notes                                                                     |
| --------------------------- | ----------- | ------------------------------------------------------------------------- |
| `id`                        | text        | UUIDv7 (ADR 0008)                                                         |
| `name`                      | text        |                                                                           |
| `email`                     | text        | Unique (`users_email_idx`)                                                |
| `email_verified`            | boolean     | Default false. Sign-in is blocked until true (`requireEmailVerification`) |
| `image`                     | text        | Nullable — OAuth avatar URL                                               |
| `created_at` / `updated_at` | timestamptz |                                                                           |

Note: this table does **not** carry `timezone`/`is_platform_admin`/`onboarding_completed_at` — those were part of an earlier, superseded plan. Timezone lives on `user_preferences` (below); onboarding-completion tracking lives on `workspaces.onboarding_completed_at`. Platform-admin authority is **deliberately never** added to this table — Phase 11B's locked contract puts it in a dedicated `platform_admins` grant-history table instead (see "Phase 11 — Administration" below), isolating platform authority from a table Better Auth itself owns the shape of.

### `sessions`, `accounts`, `verifications`, `rate_limits` (Better Auth — owns these tables)

| Table           | Key columns                                                                                                                                 | Notes                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `sessions`      | `id`, `user_id` (FK, cascade delete), `token` (unique), `expires_at`, `ip_address`, `user_agent`                                            | Database-backed session store — [ADR 0010](decisions/0010-database-backed-sessions.md). Indexed on `user_id`. |
| `accounts`      | `id`, `user_id` (FK, cascade delete), `account_id`, `provider_id`, `password` (hashed credential, nullable), OAuth token columns (nullable) | One row per sign-in method per user. Unique on `(provider_id, account_id)`.                                   |
| `verifications` | `id`, `identifier`, `value`, `expires_at`                                                                                                   | Email-verification and password-reset tokens. Indexed on `identifier`.                                        |
| `rate_limits`   | `id`, `key` (unique), `count` (integer), `last_request` (`bigint`, epoch-ms read as JS number)                                              | Database-backed rate limiting — never in-memory, never Redis this phase.                                      |

### `workspaces` (application-owned)

| Column                      | Type        | Notes                                                                                            |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `id`                        | uuid        | UUIDv7                                                                                           |
| `name`                      | text        | `'Personal workspace'` for every workspace created this phase                                    |
| `slug`                      | text        | Unique; `personal-{userId}` this phase — not yet used for routing                                |
| `kind`                      | text        | `'personal'` is the only value written this phase (not a Postgres enum — cheaper to widen later) |
| `personal_owner_user_id`    | text        | FK → `users.id`, nullable — set only for `kind = 'personal'`                                     |
| `created_at` / `updated_at` | timestamptz |                                                                                                  |

**Partial unique index** `workspaces_personal_owner_idx ON workspaces (personal_owner_user_id) WHERE kind = 'personal'` — the database-enforced "exactly one personal workspace per user" guarantee.

### `workspace_members` (application-owned)

| Column                      | Type        | Notes                                            |
| --------------------------- | ----------- | ------------------------------------------------ |
| `id`                        | uuid        |                                                  |
| `workspace_id`              | uuid        | FK → `workspaces.id`                             |
| `user_id`                   | text        | FK → `users.id`                                  |
| `role`                      | text        | `'owner'` \| `'member'` this phase (not an enum) |
| `status`                    | text        | Default `'active'`                               |
| `created_at` / `updated_at` | timestamptz |                                                  |

Unique on `(workspace_id, user_id)`. Indexed on `user_id` alone (resolving "which workspaces does this session belong to").

### `user_preferences` (application-owned)

| Column                      | Type        | Notes                                                                                        |
| --------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `user_id`                   | text        | Primary key, FK → `users.id` — one row per user                                              |
| `active_workspace_id`       | uuid        | FK → `workspaces.id`, nullable — repaired via `ensurePersonalWorkspace()` if missing/invalid |
| `locale`                    | text        | `CHECK IN ('en', 'th')` — matches `routing.locales`                                          |
| `theme`                     | text        | `CHECK IN ('light', 'dark', 'system')` — matches `next-themes` values                        |
| `timezone`                  | text        | IANA zone. Default `'UTC'` this phase — no timezone-detection UI exists yet                  |
| `created_at` / `updated_at` | timestamptz |                                                                                              |

### `audit_logs` (application-owned, append-only)

| Column                      | Type        | Notes                                                            |
| --------------------------- | ----------- | ---------------------------------------------------------------- |
| `id`                        | uuid        |                                                                  |
| `workspace_id`              | uuid        | Nullable                                                         |
| `actor_user_id`             | text        | Nullable                                                         |
| `action`                    | text        | Checked against a typed allowlist, `src/config/audit-actions.ts` |
| `entity_type` / `entity_id` | text        | Nullable                                                         |
| `metadata`                  | jsonb       | `{}` in Phase 2; the insert API accepts no arbitrary metadata    |
| `created_at`                | timestamptz |                                                                  |

Append-only by construction: `src/server/services/audit-log.ts` exposes only `insertAuditLog()` — no update/delete function exists anywhere in the codebase. Current logged actions: `workspace.personal_created`, `workspace_member.owner_created`, `user_preferences.active_workspace_initialized`, plus locale/theme-change events from `src/server/actions/preferences.ts`.

---

## Phase 3C / Phase 04C — Workspace entitlements (implemented)

Migrations: [`drizzle/0003_add_workspace_entitlements.sql`](../drizzle/0003_add_workspace_entitlements.sql) (table + original trial backfill), [`drizzle/0004_rename_plan_keys_trader_professional.sql`](../drizzle/0004_rename_plan_keys_trader_professional.sql) (locked plan keys), and [`drizzle/0005_extend_workspace_entitlements_for_billing.sql`](../drizzle/0005_extend_workspace_entitlements_for_billing.sql) (additive subscription fields and constraints).

### `workspace_entitlements` (application-owned)

The one authoritative source of a workspace's trial/subscription state. Phase 04C extends this table rather than creating a competing `subscriptions` table. New paid-billing fields remain nullable for historical pre-billing rows.

| Column                                                                | Type                  | Notes                                                                                                           |
| --------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `workspace_id`                                                        | uuid                  | Unique (`workspace_entitlements_workspace_idx`) — at most one row per workspace                                 |
| `status`                                                              | text, CHECK           | `trialing` \| `active` \| `past_due` \| `canceled` \| `expired`                                                 |
| `plan_key` / `pending_plan_key`                                       | text, CHECK           | Nullable; `starter` \| `trader` \| `professional`                                                               |
| `trial_started_at` / `trial_ends_at`                                  | timestamptz           | Original trial timestamps; never restarted or extended by the Phase 04C migration                               |
| `current_period_started_at` / `_ends_at`                              | timestamptz           | Nullable; start cannot be after end                                                                             |
| `cancel_at_period_end` / `canceled_at`                                | boolean / timestamptz | Flag defaults false; true requires a period end                                                                 |
| `billing_currency` / `billing_interval`                               | text, CHECK           | Nullable; `THB` or `USD`, and `monthly` only                                                                    |
| `pending_plan_effective_at`                                           | timestamptz           | Must be present exactly when `pending_plan_key` is present                                                      |
| `provider_kind` / `provider_customer_id` / `provider_subscription_id` | text                  | Nullable; no provider behavior is implemented by this schema phase                                              |
| `source`                                                              | text, CHECK           | Phase 11B. `trial` \| `paid` \| `complimentary` — entitlement provenance, never inferred from profit; see below |

**Phase 11B — `source` (provenance, not payment):** `startTrialInTx` (`src/server/services/entitlement.ts`) always inserts `'trial'`; `activatePaidSubscriptionInTransaction` (`src/server/services/subscription-lifecycle.ts`) always sets `'paid'` on a real, trusted paid activation — the two writers at the time of the migration, so its one-time backfill (`CASE WHEN plan_key IS NOT NULL THEN 'paid' ELSE 'trial' END`) was fully deterministic, not a guess. Cancellation/expiry/upgrade never change this column. **Phase 11E** added the first (and, by the locked mutation catalogue, only) writers of `'complimentary'`: `grantComplimentaryPlan` sets it only when the row's current `source` is `'trial'` or already `'complimentary'` — never `'paid'`, the one hard boundary — and `revokeComplimentaryPlan` sets the row back to `'trial'`, restoring the preserved original `trial_started_at`/`trial_ends_at` baseline rather than starting a new one. A `'complimentary'` row is written with `status:'active'` but `current_period_started_at`/`_ends_at`/`billing_currency`/`billing_interval` all left `null` — complimentary access is Admin-granted, not paid, and no commercial period is fabricated to satisfy `resolveEffectiveEntitlement`'s `active` shape (that resolver has a dedicated `source==='complimentary'` branch, `src/lib/entitlements/resolve.ts`, that grants the plan's account allowance without validating any commercial field, and fails closed for any row where they are unexpectedly non-null). `activatePaidSubscriptionInTransaction` additionally accepts an active-complimentary row as a valid entry point — the ONLY way `source` becomes `'paid'` starting from `'complimentary'` — populating every paid field from the trusted paid-activation input, never from the complimentary row; no Admin action can perform this transition. Column has `DEFAULT 'trial'` purely so pre-existing test fixtures across the Phase 04–10 suites that insert this table directly keep compiling; every real write path sets it explicitly.

**Locked plan decision:** the trial grants exactly **1** active trading account for **7 days** with every feature unlocked — an explicit constant (`TRIAL_ACCOUNT_LIMIT`), never derived from any paid plan's limit. Paid plans gate exclusively on active (non-archived) trading-account count and otherwise share identical features and analytics: Starter (1 account, THB 149/USD 5 per month), Trader (5 accounts, THB 299/USD 9), Professional (15 accounts, THB 499/USD 15). Every paid plan includes unlimited strategies, setups, trades, and trade history. Archived accounts do not count; create and restore enforce the limit server-side. VAT collection is disabled at launch because the business is not initially VAT registered.

---

## Phase 04C — Billing transaction snapshots (implemented schema)

Migration: [`drizzle/0006_create_billing_transaction_snapshots.sql`](../drizzle/0006_create_billing_transaction_snapshots.sql).

### `billing_transactions` (application-owned)

One workspace-owned row per billing attempt. No historical rows are backfilled. The composite unique index `(workspace_id, idempotency_key)` scopes idempotency to a workspace; non-null provider checkout and payment IDs are each unique.

| Group                  | Columns                                                                                                                                                        | Notes                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Identity               | `id`, `workspace_id`, `idempotency_key`                                                                                                                        | Workspace FK uses `ON DELETE RESTRICT`; a referenced workspace cannot be deleted                                        |
| Commercial snapshot    | `plan_key`, `billing_currency`, `billing_interval`                                                                                                             | Locked plans, `THB`/`USD`, monthly only                                                                                 |
| Money and tax snapshot | `subtotal_minor`, `vat_enabled`, `applied_vat_rate_basis_points`, `vat_amount_minor`, `total_minor`, `tax_mode`, `tax_jurisdiction`, `vat_registration_number` | Money is PostgreSQL `BIGINT` mapped to JS `bigint`; totals and disabled/exclusive VAT combinations are checked          |
| Provider processing    | `provider_kind`, `provider_checkout_id`, `provider_payment_id`, `status`, `failure_code`                                                                       | Provider references are nullable; status supports `created`, `pending`, `processing`, `succeeded`, `failed`, `canceled` |
| Lifecycle              | `created_at`, `updated_at`, `completed_at`, `failed_at`                                                                                                        | UTC `timestamptz`                                                                                                       |

The migration installs a `BEFORE UPDATE` trigger that rejects changes to identity, plan, currency, interval, price, and tax snapshot fields. It permits future trusted services to update status, failure details, provider references, and lifecycle timestamps. Price and VAT calculations remain in the Phase 04B domain; PostgreSQL validates stored consistency but does not calculate VAT.

Billing snapshots are historical financial records and are never silently cascade-deleted with a workspace. They remain intact, and workspace deletion is rejected, until a future explicit financial-record retention or anonymization process safely handles them.

---

## Phase 3A/3B — Trading accounts (implemented)

Migrations: [`drizzle/0001_fantastic_jigsaw.sql`](../drizzle/0001_fantastic_jigsaw.sql) (table, `onboarding_completed_at` on `workspaces`, `active_trading_account_id` on `user_preferences`) and [`drizzle/0002_tidy_union_jack.sql`](../drizzle/0002_tidy_union_jack.sql) (`mutation_key` idempotency column). Delivered in Phase 3A (first account, onboarding) and Phase 3B (full management: create/edit/archive/restore/switch). The scope originally planned for a later "Phase 05" landed here; Phase 05 (now complete) reviewed and polished it — see [PHASE-05-onboarding-accounts.md](phases/PHASE-05-onboarding-accounts.md).

### `trading_accounts` (application-owned)

| Column                       | Type           | Notes                                                                                                                                                                                                                                       |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                         | uuid           | UUIDv7                                                                                                                                                                                                                                      |
| `workspace_id`               | uuid           | FK → `workspaces.id`, `ON DELETE CASCADE`                                                                                                                                                                                                   |
| `name`                       | text           | Required; **no workspace-level uniqueness constraint** — duplicate names are permitted                                                                                                                                                      |
| `broker_name`                | text           | Nullable                                                                                                                                                                                                                                    |
| `platform_name`              | text           | Nullable                                                                                                                                                                                                                                    |
| `account_mode`               | text, CHECK    | `live` \| `demo` \| `prop` \| `backtest`                                                                                                                                                                                                    |
| `base_currency`              | text, CHECK    | Shape-only: uppercase alphanumeric, 2–10 characters (`^[A-Z0-9]{2,10}$`) — deliberately not the closed fiat `CurrencyCode` registry, so crypto tickers (BTC, ETH, USDT, USDC) are allowed alongside fiat (A12)                              |
| `starting_balance`           | numeric(20,10) | String in TypeScript, `>= 0` CHECK. **Not currency minor units** — `base_currency` has no guaranteed per-currency scale, so this follows CLAUDE.md §5's "instrument price" convention instead of the `bigint`/minor-unit `Money` convention |
| `timezone`                   | text           | Required IANA zone                                                                                                                                                                                                                          |
| `risk_per_trade_percent`     | numeric(12,4)  | Nullable; CHECK `> 0 AND <= 100`                                                                                                                                                                                                            |
| `maximum_daily_loss_percent` | numeric(12,4)  | Nullable; CHECK `> 0 AND <= 100`                                                                                                                                                                                                            |
| `is_archived`                | boolean        | Default `false`. The only removal mechanism — reversible, retains all data. No hard-delete application flow exists, and none is planned; archive is the approved design                                                                     |
| `mutation_key`               | uuid           | App-generated per creation attempt; the create-idempotency key (A15)                                                                                                                                                                        |
| `created_at` / `updated_at`  | timestamptz    |                                                                                                                                                                                                                                             |

No `current_balance` column exists (Phase 07+ ledger work). No `deleted_at` column exists — soft-delete for this table is expressed entirely by `is_archived`, not a second timestamp field.

**Indexes:** `trading_accounts_workspace_idx (workspace_id)`; `trading_accounts_workspace_archived_idx (workspace_id, is_archived)`; unique `trading_accounts_workspace_mutation_key_idx (workspace_id, mutation_key)` — the create-idempotency guarantee (A15).

**Related columns on other tables:** `workspaces.onboarding_completed_at` (timestamptz, nullable — workspace-scoped, not user-scoped; A10) and `user_preferences.active_trading_account_id` (uuid, FK → `trading_accounts.id`, `ON DELETE SET NULL` — re-validated against workspace ownership and archived state on every read rather than trusted from the stored reference; A11). Workspace deletion cascades to its trading accounts (`workspace_id` FK is `ON DELETE CASCADE`), matching this table's ordinary tenant-owned-record convention — unlike `billing_transactions`, which is deliberately `ON DELETE RESTRICT` because it is a financial record.

`break_even_tolerance_r` is **not** a column on this table. It belongs to the later calculation-engine/trade-classification design (CLAUDE.md §6, assumption A1) and has not been implemented anywhere yet.

---

## Phase 06 — Strategies and Setups (schema, version integrity, domain services, authenticated DAL/actions, and management UI — complete)

Migration: [`drizzle/0007_strategies_and_setups.sql`](../drizzle/0007_strategies_and_setups.sql). Phase 06B delivered the schema, forward migration, and database-enforced version immutability below; Phase 06C delivered the server-side domain services on top of it (`src/server/services/strategy-management.ts`, `strategy-versioning.ts`) — creation, copy-on-write, archive/restore lifecycle, structured Rule mutations, and a Phase 08 version-locking helper; Phase 06D delivered the authenticated read DAL (`src/server/dal/strategies.ts`), Zod-validated Server Actions (`src/server/actions/strategies.ts`), the closed public error mapping, and en/th localization on top of that; Phase 06E replaced the Phase 01 fixture preview with the real, responsive `/app/strategies` management UI (`src/components/strategies/`) on top of that boundary (see [PHASE-06-strategies.md](phases/PHASE-06-strategies.md)). This section replaces its original pre-implementation draft, which modeled a Setup as a jsonb checklist field rather than a distinct entity, put `timeframe`/`instrument_class` directly on `strategies`, and included a `deleted_at` column inconsistent with every other table's archive-only convention — Phase 06A's audit found all three stale against the approved model.

Six tables, all workspace-owned (`ON DELETE CASCADE`, the ordinary tenant-owned-record convention — not `billing_transactions`' deliberately stronger `RESTRICT`, confirmed unweakened by this migration). Phase 13B adds `setup_conditions` without changing the five Phase 06 tables. Deleting the owning workspace is allowed to cascade away even _locked_ strategy history — see [Immutability](#strategy_versions-versioned-content) below for the narrowly-scoped exception that makes this true without weakening direct-delete protection.

### `strategies` (identity row only)

| Column                    | Type        | Notes                                                                                                                                                                                                                                                               |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                                                                                                                                                                                                                              |
| `workspace_id`            | uuid        | FK → `workspaces.id`, `ON DELETE CASCADE`                                                                                                                                                                                                                           |
| `current_version_id`      | uuid        | Nullable. Composite FK ensures it references a `strategy_versions` row belonging to this same strategy — hand-authored SQL in the migration (a circular TypeScript type between the two mutually-referential tables cannot express it in the Drizzle schema itself) |
| `is_archived`             | boolean     | Default `false`. The only removal mechanism — reversible, retains all data, no hard-delete flow exists or is planned                                                                                                                                                |
| `mutation_key`            | uuid        | Create-idempotency, same pattern as `trading_accounts.mutation_key`                                                                                                                                                                                                 |
| `created_at`/`updated_at` | timestamptz |                                                                                                                                                                                                                                                                     |

No `name`, `description`, `timeframe`, `instrument_class`, `default_risk`, or `deleted_at` column exists on this table. Current display content comes from `current_version_id`.

**Indexes:** `strategies_workspace_idx (workspace_id)`; `strategies_workspace_archived_idx (workspace_id, is_archived)`; unique `strategies_workspace_mutation_key_idx (workspace_id, mutation_key)`; unique `strategies_id_workspace_idx (id, workspace_id)` (composite-FK plumbing only, letting children prove workspace consistency against their parent strategy).

### `strategy_versions` (versioned content)

| Column                    | Type        | Notes                                                                                                                                             |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                                                                                                            |
| `workspace_id`            | uuid        | FK → `workspaces.id`; composite FK also pins it to the same workspace as `strategy_id`'s strategy                                                 |
| `strategy_id`             | uuid        | FK → `strategies.id`, `ON DELETE CASCADE`                                                                                                         |
| `version_number`          | integer     | CHECK `> 0`; unique with `strategy_id`                                                                                                            |
| `name`                    | text        | CHECK `btrim(name) <> ''` — required, non-blank                                                                                                   |
| `description`             | text        | Nullable                                                                                                                                          |
| `notes`                   | text        | Nullable                                                                                                                                          |
| `change_note`             | text        | Nullable — a future service requires it when superseding a locked version; not DB-enforced, since an unlocked first version legitimately has none |
| `locked_at`               | timestamptz | Nullable. Null = unlocked (editable in place). Non-null = permanently locked                                                                      |
| `created_at`/`updated_at` | timestamptz |                                                                                                                                                   |

No `instrument_class`, `timeframe`, `setup_checklist` (jsonb), `entry_rules`, `exit_rules`, or `risk_rules` column exists — structured rules live in `strategy_rules` below.

**Immutability:** enforced by a PostgreSQL `BEFORE UPDATE` trigger (`strategy_versions_protect_locked`) that rejects the entire update once `OLD.locked_at IS NOT NULL` — content, and any attempt to clear or replace `locked_at` itself. A separate `BEFORE DELETE` trigger (`strategy_versions_protect_locked_delete`) rejects deleting a locked row **unless the owning workspace no longer exists** — the one narrow exception, shared by every delete-protection trigger in this domain via `strategy_domain_workspace_gone(workspace_id)`, which returns true only when the `workspaces` row referenced by this row's own `workspace_id` has itself already been deleted in the same transaction (empirically verified against real PostgreSQL: a cascading delete always sees its own prior writes, so this cannot be gamed by a client, a session setting, or a concurrent uncommitted transaction). This is what lets ordinary workspace deletion cascade away locked strategy history — the approved tenant-owned-record policy — while a direct delete of a locked version, or of its Strategy identity while the workspace still exists, remains rejected exactly as before. A version is editable only while unreferenced (`locked_at IS NULL`); Phase 08 will set `locked_at` atomically the moment a trade first references it, and a future edit to a locked version creates version _n+1_ by copy-on-write (Phase 06C). Without this, analytics would blend results from rules that have since changed, and system performance would become meaningless.

**Indexes:** `strategy_versions_workspace_strategy_idx (workspace_id, strategy_id)`; unique `strategy_versions_strategy_version_number_idx (strategy_id, version_number)`; unique `strategy_versions_id_strategy_idx (id, strategy_id)` and unique `strategy_versions_id_workspace_idx (id, workspace_id)` (composite-FK plumbing for `strategies.current_version_id` and for `strategy_setup_versions`/`strategy_rules`).

### `setups` (identity row only)

| Column                    | Type        | Notes                                                                                        |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                                                       |
| `workspace_id`            | uuid        | FK → `workspaces.id`; composite FK pins it to the same workspace as `strategy_id`'s strategy |
| `strategy_id`             | uuid        | FK → `strategies.id`, `ON DELETE CASCADE` — **required**, no orphan Setup                    |
| `is_archived`             | boolean     | Default `false`. Independent of `strategies.is_archived` — see archive policy below          |
| `mutation_key`            | uuid        | Create-idempotency                                                                           |
| `created_at`/`updated_at` | timestamptz |                                                                                              |

No `name`, `description`, or `deleted_at` column exists. Current Setup presentation comes from `strategy_setup_versions` for the strategy's current version.

**Indexes:** `setups_strategy_idx (strategy_id)`; `setups_workspace_archived_idx (workspace_id, is_archived)`; unique `setups_workspace_mutation_key_idx (workspace_id, mutation_key)`; unique `setups_id_strategy_idx (id, strategy_id)` (composite-FK plumbing for `strategy_setup_versions`).

### `strategy_setup_versions` (Setup snapshot per Strategy Version)

Snapshots a Setup's name/description as they existed inside one Strategy Version — the historical content a future Trade will actually reference, so a later rename never rewrites what a past trade meant.

| Column                    | Type        | Notes                                                                                                                                                    |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                                                                                                                   |
| `workspace_id`            | uuid        | FK → `workspaces.id`; composite FK pins it to the same workspace as `strategy_version_id`'s version                                                      |
| `strategy_id`             | uuid        | FK → `strategies.id`. Together with the two composite FKs below, transitively forces the Setup and the Strategy Version to belong to the _same_ Strategy |
| `strategy_version_id`     | uuid        | FK → `strategy_versions.id`, `ON DELETE CASCADE`; composite FK also requires `strategy_id` to match the version's own `strategy_id`                      |
| `setup_id`                | uuid        | FK → `setups.id`, `ON DELETE CASCADE`; composite FK also requires `strategy_id` to match the setup's own `strategy_id`                                   |
| `name`                    | text        | CHECK `btrim(name) <> ''`                                                                                                                                |
| `description`             | text        | Nullable                                                                                                                                                 |
| `sort_order`              | integer     | CHECK `>= 0`; default `0`                                                                                                                                |
| `created_at`/`updated_at` | timestamptz |                                                                                                                                                          |

No `expected_minimum_r`, `target_guidance`, `timeframe`, `symbol`, `wave_number`, or current-performance column exists — those are deferred (analytics/trade-context) or not planned.

**Immutability:** protected by a `BEFORE INSERT OR UPDATE OR DELETE` trigger (`strategy_setup_versions_protect_locked`) once the parent `strategy_versions.locked_at` is set — checked against both the old and new `strategy_version_id` on UPDATE, so a row cannot be reassigned out of a locked version's child set as a back door. The `DELETE` branch shares the same narrow workspace-gone exception `strategy_versions` uses (see above) — removable directly only as part of the owning workspace itself being deleted.

**Indexes:** unique `strategy_setup_versions_version_setup_idx (strategy_version_id, setup_id)`; `strategy_setup_versions_version_sort_idx (strategy_version_id, sort_order)`; unique `strategy_setup_versions_id_version_idx (id, strategy_version_id)` (composite-FK plumbing for `strategy_rules`); unique `strategy_setup_versions_id_setup_workspace_idx (id, setup_id, workspace_id)` (Phase 13B composite-FK plumbing for `setup_conditions`).

### `strategy_rules` (structured, versioned rule content)

The hybrid model Phase 06A recommended: normalized rows for anything that should carry a stable identity across edits, rather than one markdown blob or a bespoke checklist shape.

| Column                    | Type        | Notes                                                                                                                                                                                                                            |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7 — identifies one immutable row for one Version                                                                                                                                                                            |
| `workspace_id`            | uuid        | FK → `workspaces.id`; composite FK pins it to the same workspace as `strategy_version_id`'s version                                                                                                                              |
| `strategy_version_id`     | uuid        | FK → `strategy_versions.id`, `ON DELETE CASCADE` — always required, whether the rule is Strategy-general or Setup-scoped                                                                                                         |
| `setup_version_id`        | uuid        | Nullable FK → `strategy_setup_versions.id`. Null = applies to the Strategy Version generally; non-null = scoped to that Setup snapshot. Composite FK requires it to belong to the _same_ `strategy_version_id` this row declares |
| `rule_key`                | uuid        | Stable logical identity, survives copy-on-write (a copied version's rule keeps the same `rule_key` in a new row with a new `id`); unique with `strategy_version_id`                                                              |
| `category`                | text, CHECK | `entry` \| `invalidation` \| `risk` \| `management` \| `exit` — mirrored in `src/lib/strategies/constants.ts`'s `STRATEGY_RULE_CATEGORIES`                                                                                       |
| `title`                   | text        | CHECK `btrim(title) <> ''`                                                                                                                                                                                                       |
| `description`             | text        | Nullable                                                                                                                                                                                                                         |
| `is_required`             | boolean     | Default `true`                                                                                                                                                                                                                   |
| `is_pre_trade_check`      | boolean     | Default `false`                                                                                                                                                                                                                  |
| `sort_order`              | integer     | CHECK `>= 0`; default `0`                                                                                                                                                                                                        |
| `created_at`/`updated_at` | timestamptz |                                                                                                                                                                                                                                  |

No severity weight, penalty value, or analytics result lives here — that belongs to the future calculation engine / discipline-scoring design (CLAUDE.md §6), not this schema.

**Immutability:** same protection pattern as `strategy_setup_versions`, via `strategy_rules_protect_locked`, including the same `DELETE`-branch workspace-gone exception.

**Indexes:** unique `strategy_rules_version_rule_key_idx (strategy_version_id, rule_key)`; `strategy_rules_version_sort_idx (strategy_version_id, sort_order)`; `strategy_rules_setup_version_idx (setup_version_id)`.

`is_pre_trade_check = true` remains historically truthful and is still copied unchanged by COW. Phase 13B removes that choice from new Rule authoring and forces newly created Rules to `false`; pre-entry authoring now belongs to the separate Setup Conditions domain. No historical Rule is migrated, reinterpreted, or silently flipped.

### `setup_conditions` (Phase 13B version-owned Setup content)

Migration: [`drizzle/0011_setup_conditions_domain.sql`](../drizzle/0011_setup_conditions_domain.sql). A Condition belongs to one exact `strategy_setup_versions` row. It has no separate identity table: `id` identifies the version row, while server-generated `condition_key` is the stable logical identity copied into later Strategy Versions.

| Column                    | Type        | Notes                                                                                         |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7; regenerated during COW                                                                |
| `workspace_id`            | uuid        | FK → `workspaces.id`, `ON DELETE CASCADE`                                                     |
| `setup_id`                | uuid        | FK → `setups.id`, `ON DELETE CASCADE`                                                         |
| `setup_version_id`        | uuid        | FK → `strategy_setup_versions.id`; composite FK proves the same Setup and Workspace           |
| `condition_key`           | uuid        | Server-generated stable identity; unique with `setup_version_id`; preserved across COW/rename |
| `label`                   | text        | Required, CHECK non-blank                                                                     |
| `sort_order`              | integer     | CHECK `>= 0`; default `0`; numeric authoring is the accessible non-drag reorder path          |
| `created_at`/`updated_at` | timestamptz |                                                                                               |

**Immutability:** `setup_conditions_protect_locked` resolves the owning Setup Version's parent `strategy_versions.locked_at`. INSERT/UPDATE/DELETE is rejected once locked; DELETE has only the established workspace-gone cascade exception. Authorized mutations use the existing Strategy lock order and authoritative `copyCurrentVersionInTx`; copied rows receive new `id`/`setup_version_id` values and preserve `condition_key`, label, and order. Removing from an unlocked current Version deletes that Version's row; removing after lock first copies, then omits the Condition from the new Version.

**Indexes:** unique `(setup_version_id, condition_key)`; unique `(id, setup_version_id, condition_key, workspace_id)` for exact historical snapshot references; `(setup_version_id, sort_order)`; `(workspace_id)`.

### Name uniqueness

No database uniqueness constraint on Strategy or Setup **names** — only the `btrim(...) <> ''` non-blank CHECK. UUID identity remains authoritative, matching `trading_accounts.name`'s deliberate lack of a workspace-level uniqueness constraint (A12-adjacent reasoning: duplicate display names are permitted; the id is what every reference actually uses).

### Entitlements

No Strategy-count or Setup-count limit column, check, or index exists anywhere in this schema, and none is planned — every plan (trial and paid) has unlimited Strategies and Setups with identical functionality. `src/config/plan-catalog.ts`'s `SHARED_BILLING_FEATURE_KEYS` already lists `unlimitedStrategies`/`unlimitedSetups` as shared, non-differentiating features.

---

## Phase 07 — Trades and discipline (07B schema — implemented)

### `trades`

Migration: [`drizzle/0008_trade_domain_and_discipline.sql`](../drizzle/0008_trade_domain_and_discipline.sql), extended by [`drizzle/0010_trade_plan_price_money_confidence.sql`](../drizzle/0010_trade_plan_price_money_confidence.sql) and [`drizzle/0013_actual_execution_v2.sql`](../drizzle/0013_actual_execution_v2.sql). One Trade remains one complete trading idea/position; migration 0013 permits multiple partial **Exit** legs for that one position, never multiple Trades or multiple entry fills. Every normal Trade pins Trading Account, Strategy, the exact Strategy Version, Setup, and the exact Setup Version — **all five required**, not nullable; a general-purpose Strategy uses an explicit "General Setup"-style Setup rather than a nullable reference. The system/actual/planned separation is structural — three parallel column sets, none derived from the others.

| Group                     | Columns                                                                                                                                                                                                                                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity/tenancy          | `id`, `workspace_id`, `mutation_key`                                                                                                                                                                                                                                                             | Create-idempotency, same pattern as `strategies.mutation_key`                                                                                                                                                                                                                                                                                         |
| Pinned framework          | `trading_account_id`, `strategy_id`, `strategy_version_id`, `setup_id`, `setup_version_id`                                                                                                                                                                                                       | All five `NOT NULL`; five composite foreign keys chain-verify tenant/parent consistency (below)                                                                                                                                                                                                                                                       |
| Context                   | `symbol`, `direction` (`long`\|`short`), `timeframe`, `session`, `confirmation_notes` (Entry Reason), `confidence` (exactly one of `0`/`25`/`50`/`75`/`100`, or `NULL`), `tradingview_url`, legacy/general `notes`, nullable `review_notes` (Post-Trade Review), nullable `emotions_recorded_at` | `emotions_recorded_at IS NULL` means historical Emotion capture was not recorded; non-null with zero `trade_emotions` rows means the question was recorded with no selection.                                                                                                                                                                         |
| **Plan — Price**          | `planned_entry`, `planned_stop`, `planned_target` — all nullable since migration 0010                                                                                                                                                                                                            | `trades_planned_price_shape_check`: either all three absent, or `planned_entry`/`planned_stop` present as a complete, direction-valid pair (Target still optional within that pair) — never a lone Entry, lone Stop, or a Target with neither                                                                                                         |
| **Plan — Money**          | `planned_risk_minor`, `planned_reward_minor` (migration 0010) — `BIGINT` minor units, in the Trading Account's own `base_currency`                                                                                                                                                               | `trades_planned_money_check`: Risk strictly positive when present, Reward `>= 0` when present, Reward never present without Risk. Independent of Price — a Trade may have Price only, Money only, or both (never mutually exclusive)                                                                                                                  |
| **Plan — floor**          | —                                                                                                                                                                                                                                                                                                | `trades_plan_minimum_check` (migration 0010): every row needs a complete Price pair OR a Money Risk — never neither                                                                                                                                                                                                                                   |
| Plan — other              | `planned_position_size` (informational only)                                                                                                                                                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                       |
| **Chart attachment**      | `chart_attachment_url`, `chart_attachment_storage_key`, `chart_attachment_uploaded_at` (migration 0010) — all nullable, populated together or not at all                                                                                                                                         | `trades_chart_attachment_check`. Distinct from `tradingview_url` (a Trade may carry a chart LINK, an uploaded IMAGE, both, or neither). Never a blob/base64 column — see `src/lib/storage/chart-attachment-storage.ts`                                                                                                                                |
| **Actual execution**      | `actual_result_mode` (`price`\|`money`), `actual_entry`, `actual_initial_stop`, `actual_exit`, `actual_position_size`, `entered_at`, `exited_at`                                                                                                                                                 | Mode is explicit on Open and immutable after the first Exit. Price requires direction-valid Entry/initial Stop and no monetary risk. Money requires positive monetary risk and may carry an optional complete Price context. `actual_exit`/`exited_at` are final compatibility caches, not Exit history authority.                                    |
| **Authoritative money**   | `actual_initial_risk_minor`, `gross_pnl_minor`, `net_pnl_minor`, `commission_minor`, `fees_minor`, `swap_minor`                                                                                                                                                                                  | `BIGINT` minor units. In Money mode final Actual R uses summed Exit-leg `realized_pnl_minor / actual_initial_risk_minor`; `net_pnl_minor` is that final sum cache. Price mode keeps both monetary result fields null. Gross/cost fields remain informational and are never subtracted from already-net leg P&L.                                       |
| **System counterfactual** | `system_status` (`pending`\|`resolved`\|`no_trade`), `system_exit_price`, `system_exited_at`, `system_exit_reason` (8 values), `system_cost_r`, `system_resolved_at`                                                                                                                             | Independent lifecycle from `status`; self-reported, see the limitation in the product spec. Always Price-based (`planned_entry`/`planned_stop`) — a Trade with a Money-only Plan cannot resolve System until it also has a Price plan                                                                                                                 |
| Derived                   | `planned_r`, `actual_r`, `system_r`, `trader_outcome`, `system_outcome` (all `win`\|`loss`\|`break_even`), `calc_version`                                                                                                                                                                        | Persisted at compute time, never client-supplied. `planned_r` since migration 0010: computed by `composePlannedR` (`src/lib/calc/trade.ts`) from whichever of Price/Money is present — Price-precedence when both agree; a disagreement beyond `PLANNED_R_AGREEMENT_TOLERANCE_R` is rejected outright (`planned_r_mismatch`), never silently resolved |
| Lifecycle                 | `status` (`planned`\|`open`\|`closed`\|`canceled`), `followed_plan`, `deleted_at`, `created_at`, `updated_at`                                                                                                                                                                                    | American spelling `canceled`; `deleted_at` — see below                                                                                                                                                                                                                                                                                                |

`review_notes` follows the existing general Trade-note convention: nullable text with a 4,000-character application validation limit. `NULL` means “Not recorded,” never “No lesson learned.” `confirmation_notes` remains the separate Entry Reason field and historical `notes` remains legacy/general context.

`actual_initial_stop` is the stop **as first placed**, not as later moved. Moving a stop is a discipline event recorded as a mistake; if this field tracked the moved stop, the R denominator would shift and the mistake would erase its own evidence.

**System status is a third, independent state machine** from `status` and from the outcome classifications — CLAUDE.md §1's outcome matrix requires this. `pending` (no counterfactual recorded yet — all terminal System fields null) is not the same state as `no_trade` (the approved Strategy/Setup would not have permitted the Trade at all — `system_exit_reason` fixed to `setup_invalidated`, no exit price). `resolved` requires exit price/timestamp/reason (forbidding `setup_invalidated` as the reason) **and now also requires `system_r`/`system_outcome` to be present** (Phase 07B correction — resolving the System result and computing its R/outcome are one atomic requirement, not two separable steps). There is no `still_open` reason — an unresolved counterfactual is `pending` with null terminal fields. `system_cost_r` (see below) is pinned to exactly `0` under both `pending` and `no_trade`. `trades_system_status_consistency_check` makes every other combination unrepresentable. The eight `system_exit_reason` values: `target_hit`, `stop_hit`, `break_even_rule`, `trailing_exit`, `time_exit`, `rule_exit`, `manual_system_valid_exit` (all `resolved`-only), `setup_invalidated` (`no_trade`-only).

**`system_cost_r` semantics (locked): `systemR = systemGrossR − systemCostR`.** A user-supplied estimate of costs attributable to the counterfactual System execution, expressed directly in R, non-negative, default `0`, supplied only when _resolving_ the System result — never automatically copied from Actual `commission_minor`/`fees_minor`/`swap_minor`, and never calculated from a per-account cost constant in MVP.

**Trade execution status consistency**: `trades_status_consistency_check` is mode-shaped. `planned` has no Actual mode/context/result; `open` has a valid Price or Money context while `actual_exit`, `net_pnl_minor`, `exited_at`, `actual_r`, and `trader_outcome` remain null; `closed` has final R/outcome/time and the appropriate Price or Money cache shape. Deferred constraint triggers additionally require Exit totals `< 10000` for `open`, exactly `10000` for `closed`, and zero for non-executing states. `canceled` retains its historical row-shape compatibility. No `partially_closed` status exists.

### `trade_exits` (Phase 13E)

Authoritative Exit-leg history for one Trade/position. `id`, `workspace_id`, `trade_id`, positive `sequence`, integer `closed_bps` (`1..10000`), nullable `exit_price`, nullable `realized_pnl_minor`, optional nonblank `exit_reason`, `exited_at`, and timestamps are persisted. `(trade_id, sequence)` is unique; the composite Trade/Workspace FK and guard trigger prevent cross-tenant links or identity mutation. `mutation_key` is an internal workspace-scoped replay key and is deliberately excluded from customer export.

Price-mode legs require `exit_price` and forbid monetary P&L. Their realized R contribution is `(closed_bps / 10000) × direction-aware leg R`. Money-mode legs require already-net `realized_pnl_minor`; Actual R is `SUM(realized_pnl_minor) / actual_initial_risk_minor`, with no second basis-point weighting or fee subtraction. No per-leg R is stored.

Every Exit mutation locks the parent Workspace/Trade in canonical order, validates the complete Exit set, and recomputes aggregates from scratch. Database triggers repeat mode/scope/immutable-identity/cumulative-bps checks and deferred status-total consistency for direct writes. An `open` partial position exposes read-derived closed %, remaining %, and realized R; terminal Trade caches stay null and finalized Actual analytics continue to require `status='closed'`. At exact 10,000 bps the Trade closes. `trades.exited_at` is `MAX(trade_exits.exited_at)`; `actual_exit` is the price on that chronological final leg, with sequence/id as deterministic tie-breakers.

Migration 0013 tags legacy open/closed Trades as Money because the old lifecycle required monetary initial risk and finalized from net P&L. It creates no Exit for legacy open Trades and exactly one 10,000-bps Exit for each legacy closed Trade, copying price/P&L/time verbatim without recalculating historical R or outcome.

**`deleted_at` soft-deletion**, not `is_archived` — the one deliberate exception to every other table's archive-only convention in this codebase (CLAUDE.md assumption A7).

**Trades remain editable after `status = 'closed'`** — unlike a locked Strategy Version, a Trade is the measurement record itself. Historical integrity is protected by `calc_version` (persisted from creation, defaulting to `src/config/trade-calc.ts`'s `CALC_VERSION`) plus an explicit backfill migration — never by row-level immutability.

**Composite foreign keys**: `(trading_account_id, workspace_id)` → `trading_accounts(id, workspace_id)` — a **new** index (`trading_accounts_id_workspace_idx`) this migration adds to the pre-existing `trading_accounts` table via `CREATE INDEX` only, no `ALTER TABLE`; `(strategy_id, workspace_id)` → `strategies(id, workspace_id)`; `(strategy_version_id, strategy_id)` → `strategy_versions(id, strategy_id)`; `(setup_id, strategy_id)` → `setups(id, strategy_id)`; `(setup_version_id, strategy_version_id)` → `strategy_setup_versions(id, strategy_version_id)`; `(setup_version_id, setup_id)` → `strategy_setup_versions(id, setup_id)` — also new plumbing (`strategy_setup_versions_id_setup_idx`), closing a gap the Version-level FK alone cannot: without it, a Trade could pair a valid `setup_id` with a `setup_version_id` that is a real snapshot belonging to a _different_ Setup within the same Strategy Version.

**Why derived values are persisted:** analytics over thousands of trades must not recompute decimals per row, and a later engine fix must not silently rewrite historical numbers. `calc_version` makes recomputation an explicit, auditable backfill.

**Phase 08 write/read paths and Phase 09 analytics reads are live.** `createTrade` resolves and pins the current Strategy Version and exact Setup Version under the canonical workspace/member/entitlement/framework lock order, locks the Strategy Version on first reference, inserts the Trade, snapshots applicable Rules, and writes audit metadata atomically. Lifecycle and correction services persist `planned_r`/`actual_r`/`system_r` and outcomes only through `src/lib/calc/trade.ts` composition helpers; Actions strictly reject every derived/trusted field. `listWorkspaceTrades`/`getWorkspaceTradeDetail` use pinned labels, while `src/server/dal/analytics.ts` projects separate eligible Trader, System, paired, Rule, and Mistake populations by identity. Aggregate formulas remain outside SQL in Phase 07D. There is still no restore/deleted Trade view.

### `mistake_types`

| Column           | Type          | Notes                                                                                                 |
| ---------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `workspace_id`   | uuid          | Nullable for seeded system types; `NOT NULL` for workspace-defined custom types (a future phase's UI) |
| `key`            | text          | Stable identifier; globally unique among system rows, unique per workspace among custom rows          |
| `label`          | text          |                                                                                                       |
| `severity`       | text          | `minor` \| `moderate` \| `severe`, CHECK-enforced                                                     |
| `default_weight` | numeric(12,4) | Current default weight (`src/config/mistakes.ts`); new custom types default to it                     |
| `is_system`      | boolean       | Seeded taxonomy vs workspace-defined; `workspace_id IS NULL ⇔ is_system` enforced by CHECK            |
| `is_archived`    | boolean       | Archive-only lifecycle, matching every other table — no `deleted_at`, no hard-delete                  |

`default_weight`/`trade_mistakes.weight_at_time` are `NUMERIC(12,4)` — the CLAUDE.md §5 R-multiple precision, not an arbitrary shorter scale, chosen so a value like `1.0000` stores exactly rather than being rounded.

Seeded (fixed deterministic ids, `ON CONFLICT ... DO NOTHING` for idempotent replay): moved stop · early exit · oversized position · no setup · revenge trade · chased entry · ignored invalidation · moved target · no stop. **Every one of the nine is seeded with one deliberately neutral default: `severity = 'moderate'`, `default_weight = '1.0000'`** (Phase 07B correction) — the source documents name the nine types but define no evidence-backed relative severity or weight, so Phase 07 MVP does not invent unjustified differentiation. `src/config/mistakes.ts`'s `MISTAKE_SEVERITY_WEIGHTS` (minor `0.15` / moderate `0.35` / severe `0.60`) remains a separate, general severity → weight framework, reserved for a later phase's evidence-backed differentiated weighting — not applied to these nine rows.

Editing a severity or default weight cannot retroactively rewrite historical snapshots — `trade_mistakes.severity_at_time`/`weight_at_time` preserve the values in effect when the Trade was saved. No Discipline Score currently consumes them.

### `trade_mistakes`

Join table, primary key `(trade_id, mistake_type_id)`, with `workspace_id`, an optional per-instance `note`, and snapshotted `severity_at_time`/`weight_at_time`. `mistake_type_id` uses `ON DELETE RESTRICT` (not the ordinary tenant-owned `CASCADE`) — losing a `mistake_types` row out from under historical rows would corrupt discipline history, the same reasoning `billing_transactions` applies to its own workspace reference.

Cross-workspace isolation for a **custom** (workspace-scoped) mistake type cannot be a plain composite foreign key, because `mistake_types.workspace_id` is `NULL` for shared system rows — an exact match would incorrectly reject every reference to a system type. A `BEFORE INSERT OR UPDATE` trigger (`trade_mistakes_workspace_scope_check`) enforces it instead: any reference to a `workspace_id IS NULL` row is allowed unconditionally; any other row requires an exact workspace match.

### `emotion_types` (Phase 13D)

Canonical Emotion taxonomy patterned directly on `mistake_types`, without severity or weight. Columns are `id`, nullable `workspace_id`, stable `key`, canonical English fallback `label`, `is_system`, `is_archived`, `sort_order`, and timestamps. The tenancy CHECK requires system rows to have no Workspace and custom rows to have one; partial unique indexes enforce globally unique system keys and per-Workspace custom keys.

Migration 0012 seeds exactly: `calm`, `focused`, `fearful`, `fomo`, `greedy`, `hesitant`, `revenge`, `excited`, `tired`, and `frustrated`. V1 exposes only active system rows and has no custom-Emotion authoring UI. EN/TH display text comes from message catalogs keyed by `key`; the database label is not localized authority.

### `trade_emotions` (Phase 13D)

Join table with composite primary key `(trade_id, emotion_type_id)`, denormalized `workspace_id`, and `created_at`. The composite Trade/Workspace foreign key prevents cross-Workspace Trade links. `emotion_type_id` is `ON DELETE RESTRICT`; a trigger equivalent to `trade_mistakes_workspace_scope_check` permits shared system types and requires any future custom type to match the link Workspace.

Emotion links contain no inferred score, severity, weight, note, or analytics aggregate. Entry creation validates stable keys against active canonical database rows and inserts the links atomically with the Trade, Rule/Condition snapshots, and audit event. Later full-set replacement is an ordinary entitlement-guarded, audited Trade correction. Empty sets are valid and become distinguishable from historical absence through `trades.emotions_recorded_at`.

### `trade_rule_checks`

Replaces the stale `trade_checklist_results(trade_id, checklist_item_id, was_satisfied)` draft — Phase 06 never built a separate "checklist item" entity; a Rule check attaches to `strategy_rules` directly.

| Column                                                                 | Notes                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `strategy_rule_id`                                                     | The exact Rule row in the Strategy Version this Trade is pinned to                                                                                                                   |
| `strategy_version_id`, `rule_key`                                      | Jointly FK-verified with `strategy_rule_id` against `strategy_rules(id, strategy_version_id, rule_key)` — a **new** composite index (`strategy_rules_id_version_rule_key_idx`)       |
| `check_status`                                                         | `followed` \| `violated` \| `not_applicable` \| `not_checked` — **not** a boolean `was_satisfied`; a Rule may be inapplicable or simply unreviewed, neither expressible as a boolean |
| `title`, `category`, `is_required`, `is_pre_trade_check`, `sort_order` | Snapshotted from `strategy_rules` at check-save time, the pattern `strategy_setup_versions` established for Setup content                                                            |

Unique `(trade_id, rule_key)` prevents a duplicate check for the same logical Rule on the same Trade. A composite foreign key `(trade_id, strategy_version_id)` → `trades(id, strategy_version_id)` (a **new** index, `trades_id_strategy_version_idx`) guarantees a Rule check can only ever reference the exact Strategy Version its own Trade is pinned to.

### `trade_setup_condition_checks` (Phase 13B immutable Entry snapshot)

This table is intentionally distinct from `trade_rule_checks`. It snapshots whether each configured Setup Condition was `met` or `not_met` at Entry; it has no persisted `not_checked`, scoring, weight, or adherence aggregate.

| Column                    | Type        | Notes                                                                                             |
| ------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                                                            |
| `workspace_id`            | uuid        | FK → `workspaces.id`, `ON DELETE CASCADE`                                                         |
| `trade_id`                | uuid        | FK → `trades.id`; composite FKs prove Workspace and the Trade's pinned Setup Version              |
| `setup_condition_id`      | uuid        | Exact source `setup_conditions.id`                                                                |
| `setup_version_id`        | uuid        | Must equal the Trade's pinned `setup_version_id`                                                  |
| `condition_key`           | uuid        | Stable logical key; exact composite FK with source row                                            |
| `label`                   | text        | Server-authoritative historical snapshot, CHECK non-blank; never rendered from live Setup content |
| `sort_order`              | integer     | Server-authoritative historical snapshot, CHECK `>= 0`                                            |
| `check_status`            | text, CHECK | Exactly `met` \| `not_met`                                                                        |
| `created_at`/`updated_at` | timestamptz |                                                                                                   |

Unique `(trade_id, condition_key)` prevents duplicate answers. `trade_setup_condition_checks_protect_snapshot` rejects UPDATE/DELETE after insertion, with only the same workspace-deletion cascade exception used by locked Strategy history. The Phase 13B helper validates an explicit, complete answer set against the Trade's pinned Setup Version and copies ID/key/label/order from authoritative server rows. It is deliberately not called by the Phase 08 Trade-create flow yet: until Phase 13C presents the checklist, old-flow Trades have zero rows, meaning “Conditions not recorded,” never fabricated `not_met` answers or 0% adherence. Zero configured Conditions derives to N/A (`null`), not 0%.

---

## Phase 11B — Platform administration foundation (implemented)

Migration: [`drizzle/0009_platform_admin_foundation.sql`](../drizzle/0009_platform_admin_foundation.sql). Persistence and authorization only — no `/admin` route, no admin subscription mutation, no VAT runtime wiring exist yet (Phase 11C onward). See [ADR-equivalent reasoning in the Phase 11A audit] and `docs/phases/PHASE-11-admin.md`.

### `platform_admins` (application-owned)

One row per platform-admin GRANT lifecycle, not a mutable flag — a user may accumulate several historical rows (grant → revoke → grant again), all retained. **Deliberately not `users.is_platform_admin`**: isolates platform authority from a table Better Auth itself owns the shape of, and gives revocation history for free.

| Column                                        | Type        | Notes                                                                                                                                                      |
| --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_id`                                     | text        | FK → `users`, **`ON DELETE RESTRICT`** — a user with any grant history, even fully revoked, cannot be deleted                                              |
| `granted_at` / `revoked_at`                   | timestamptz | `revoked_at` NULL means the grant is currently active                                                                                                      |
| `granted_by_admin_id` / `revoked_by_admin_id` | uuid        | Self-reference to this table's own `id` (which acting admin's grant authorized it) — nullable for the operational bootstrap/revoke script's `system` actor |

At most one ACTIVE grant per user, enforced by a **partial unique index** `platform_admins_active_user_idx` (`user_id` WHERE `revoked_at IS NULL`) — not a plain `UNIQUE(user_id)`, which would forbid the required grant/revoke/re-grant history. Revocation is `UPDATE ... SET revoked_at`; rows are never deleted.

### `admin_audit_log` (application-owned)

The dedicated PLATFORM ADMIN audit trail — deliberately separate from workspace-tenant `audit_logs` (a platform admin acts on someone ELSE's data, a different trust register). Append-only, enforced by two triggers (`admin_audit_log_protect_content_trigger`, `admin_audit_log_protect_delete_trigger`): no content column may ever be UPDATEd, and no row may ever be DELETEd — with one narrow exception, `subject_user_id`/`subject_workspace_id` transitioning to NULL (their FKs are `ON DELETE SET NULL`, matching `audit_logs`' own subject-nulling precedent).

| Column                                     | Type        | Notes                                                                                                                                                                                                                                                |
| ------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actor_kind`                               | text, CHECK | `platform_admin` \| `system` — CHECK-paired with `actor_admin_id`'s nullability                                                                                                                                                                      |
| `actor_admin_id`                           | uuid        | FK → `platform_admins`, RESTRICT. NOT NULL iff `actor_kind = 'platform_admin'`; NULL iff `'system'`                                                                                                                                                  |
| `action`                                   | text, CHECK | Closed vocabulary (`src/config/admin-audit-actions.ts`'s `ADMIN_AUDIT_ACTIONS`) — DB CHECK **and** TS allowlist, unlike `audit_logs.action` (TS-only), because this table's rows may be written by the raw-SQL bootstrap script outside the TS layer |
| `subject_user_id` / `subject_workspace_id` | text / uuid | Both nullable and independent — a platform-level event (e.g. a VAT change) has neither                                                                                                                                                               |
| `reason_code`                              | text, CHECK | Required. Closed vocabulary shared with `platform_vat_configuration.reason_code`                                                                                                                                                                     |
| `reason_note`                              | text        | Optional, ≤500 characters (CHECK)                                                                                                                                                                                                                    |
| `before_state` / `after_state`             | jsonb       | Allowlisted structural snapshot only (`AdminAuditStateSnapshot` in `src/server/services/admin-audit-log.ts`) — never a raw row dump, never PII/tokens/Trade content                                                                                  |

Non-negotiable: admins act on other people's data, and every admin action writes a row here.

### `platform_vat_configuration` (application-owned)

Narrow, typed, **append-only** VAT configuration — deliberately not a generic `platform_settings` key/value table. Each change INSERTs a new row rather than updating the previous one; "effective config" is the latest row with `effective_at <= now()`. Enforced immutable by two triggers, the same append-only pattern as `admin_audit_log` (unconditional here — no FK ever nulls a column on this table).

| Column                        | Type           | Notes                                                                       |
| ----------------------------- | -------------- | --------------------------------------------------------------------------- |
| `enabled`                     | boolean        |                                                                             |
| `rate_basis_points`           | integer, CHECK | 0–10000, same bound as `billing_transactions.applied_vat_rate_basis_points` |
| `effective_at`                | timestamptz    | Indexed (`platform_vat_configuration_effective_idx`)                        |
| `created_by_admin_id`         | uuid           | FK → `platform_admins`, RESTRICT. NULL for the migration-seeded baseline    |
| `reason_code` / `reason_note` | text           | Same shape as `admin_audit_log`'s                                           |

Migration 0009 seeds exactly one **baseline row**: `enabled = false`, `rate_basis_points = 700`, `reason_code = 'bootstrap'`, `created_by_admin_id = NULL` — matching `src/config/billing.server.ts`'s constant of the time (`DEFAULT_VAT_CONFIGURATION`, since renamed `VAT_CONFIGURATION_LAUNCH_FIXTURE`) exactly.

**Phase 11F wired the runtime**: `src/server/services/platform-vat-configuration.ts`'s `getEffectivePlatformVatConfiguration()`/`...InTx()` is now the ONE production resolver every quotation/checkout/billing-presentation call site uses — that legacy constant is no longer read by any production path, and survives only as a test-fixture literal. A missing effective row (impossible after migration 0009 under normal operation) throws `VatConfigurationUnavailableError` rather than silently resolving as VAT-disabled. `changeVatConfiguration` (`src/server/services/admin/vat-configuration-support.ts`, the only writer besides the migration seed) always INSERTs — never UPDATEs — with `effective_at` set to the mutation's own trusted transaction time (immediate changes only), and serializes concurrent changes by locking this table's oldest row (the immutable baseline) as a mutex before re-reading the current effective config.

---

## Index plan

| Table                          | Index                                                                                                                                                                      | Status                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `users`                        | `(email)` unique — `users_email_idx`                                                                                                                                       | Implemented (Phase 02)  |
| `sessions`                     | `(token)` unique, `(user_id)`                                                                                                                                              | Implemented (Phase 02)  |
| `platform_admins`              | `(user_id)` unique WHERE `revoked_at IS NULL` — `platform_admins_active_user_idx`; `(user_id)` — `platform_admins_user_idx`                                                | Implemented (Phase 11B) |
| `admin_audit_log`              | `(created_at)`, `(subject_user_id)`, `(subject_workspace_id)`                                                                                                              | Implemented (Phase 11B) |
| `platform_vat_configuration`   | `(effective_at)` — `platform_vat_configuration_effective_idx`                                                                                                              | Implemented (Phase 11B) |
| `accounts`                     | `(user_id)`, `(provider_id, account_id)` unique                                                                                                                            | Implemented (Phase 02)  |
| `verifications`                | `(identifier)`                                                                                                                                                             | Implemented (Phase 02)  |
| `rate_limits`                  | `(key)` unique                                                                                                                                                             | Implemented (Phase 02)  |
| `workspaces`                   | `(personal_owner_user_id)` unique, partial WHERE kind = 'personal'                                                                                                         | Implemented (Phase 02)  |
| `workspace_members`            | `(workspace_id, user_id)` unique, `(user_id)` — resolving a session to its workspaces                                                                                      | Implemented (Phase 02)  |
| `audit_logs`                   | `(workspace_id, created_at)` — `audit_logs_workspace_created_idx`                                                                                                          | Implemented (Phase 02)  |
| `trades`                       | `(workspace_id, trading_account_id, exited_at)` — `trades_workspace_account_exited_idx`                                                                                    | Implemented (Phase 07B) |
| `trades`                       | `(workspace_id, strategy_version_id)` — `trades_workspace_strategy_version_idx`                                                                                            | Implemented (Phase 07B) |
| `trades`                       | `(workspace_id, status)` — `trades_workspace_status_idx`                                                                                                                   | Implemented (Phase 07B) |
| `trades`                       | `(workspace_id, trading_account_id)`, `(workspace_id, deleted_at)`, `(id, workspace_id)` unique, `(id, strategy_version_id)` unique, `(workspace_id, mutation_key)` unique | Implemented (Phase 07B) |
| `trade_mistakes`               | `(mistake_type_id)` — Phase 09 count-only frequency reads; `(workspace_id)`                                                                                                | Implemented (Phase 07B) |
| `trade_rule_checks`            | `(trade_id, rule_key)` unique, `(workspace_id)`, `(rule_key)` — cross-Version logical-rule analysis                                                                        | Implemented (Phase 07B) |
| `setup_conditions`             | `(setup_version_id, condition_key)` unique, exact-source composite unique, `(setup_version_id, sort_order)`, `(workspace_id)`                                              | Implemented (Phase 13B) |
| `trade_setup_condition_checks` | `(trade_id, condition_key)` unique, `(workspace_id)`, `(condition_key)`                                                                                                    | Implemented (Phase 13B) |
| `mistake_types`                | `(key)` unique WHERE `is_system`; `(workspace_id, key)` unique WHERE NOT `is_system`; `(workspace_id, is_archived)`                                                        | Implemented (Phase 07B) |

Verify with `EXPLAIN ANALYZE` rather than assuming these are used.
