# Data Dictionary

**Status:** Phase 03, Phase 04 — Billing & Checkout, and Phase 05 — Onboarding & Trading Accounts are officially complete. Phase 04C's schema (below) is fully consumed by the implemented customer billing behavior, checkout, and mock provider integration — see [PHASE-04-billing.md](phases/PHASE-04-billing.md) and [roadmap.md](roadmap.md#what-phase-04-delivered). No schema changes were needed for the 04H-A production payment-provider guard — it is application-layer only. Phase 05 (see [PHASE-05-onboarding-accounts.md](phases/PHASE-05-onboarding-accounts.md)) made no schema change either — it reviewed and polished the existing `trading_accounts` presentation, not the table itself.

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

Note: this table does **not** carry `timezone`/`is_platform_admin`/`onboarding_completed_at` — those were part of an earlier, superseded plan. Timezone lives on `user_preferences` (below); platform-admin and onboarding-completion tracking are deferred to the phases that need them (Phase 11, and a future onboarding-UI phase, respectively).

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

| Column                                                                | Type                  | Notes                                                                             |
| --------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------- |
| `workspace_id`                                                        | uuid                  | Unique (`workspace_entitlements_workspace_idx`) — at most one row per workspace   |
| `status`                                                              | text, CHECK           | `trialing` \| `active` \| `past_due` \| `canceled` \| `expired`                   |
| `plan_key` / `pending_plan_key`                                       | text, CHECK           | Nullable; `starter` \| `trader` \| `professional`                                 |
| `trial_started_at` / `trial_ends_at`                                  | timestamptz           | Original trial timestamps; never restarted or extended by the Phase 04C migration |
| `current_period_started_at` / `_ends_at`                              | timestamptz           | Nullable; start cannot be after end                                               |
| `cancel_at_period_end` / `canceled_at`                                | boolean / timestamptz | Flag defaults false; true requires a period end                                   |
| `billing_currency` / `billing_interval`                               | text, CHECK           | Nullable; `THB` or `USD`, and `monthly` only                                      |
| `pending_plan_effective_at`                                           | timestamptz           | Must be present exactly when `pending_plan_key` is present                        |
| `provider_kind` / `provider_customer_id` / `provider_subscription_id` | text                  | Nullable; no provider behavior is implemented by this schema phase                |

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

## Phase 06B — Strategies and Setups (schema and version integrity implemented)

Migration: [`drizzle/0007_strategies_and_setups.sql`](../drizzle/0007_strategies_and_setups.sql). Schema, forward migration, and database-enforced version immutability only — no mutation service, server action, or UI exists yet (Phase 06C–06E; see [PHASE-06-strategies.md](phases/PHASE-06-strategies.md)). Replaces this section's original pre-implementation draft, which modeled a Setup as a jsonb checklist field rather than a distinct entity, put `timeframe`/`instrument_class` directly on `strategies`, and included a `deleted_at` column inconsistent with every other table's archive-only convention — Phase 06A's audit found all three stale against the approved model.

Five tables, all workspace-owned (`ON DELETE CASCADE`, the ordinary tenant-owned-record convention — not `billing_transactions`' deliberately stronger `RESTRICT`, confirmed unweakened by this migration). Deleting the owning workspace is allowed to cascade away even _locked_ strategy history — see [Immutability](#strategy_versions-versioned-content) below for the narrowly-scoped exception that makes this true without weakening direct-delete protection.

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

**Indexes:** unique `strategy_setup_versions_version_setup_idx (strategy_version_id, setup_id)`; `strategy_setup_versions_version_sort_idx (strategy_version_id, sort_order)`; unique `strategy_setup_versions_id_version_idx (id, strategy_version_id)` (composite-FK plumbing for `strategy_rules`).

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

### Name uniqueness

No database uniqueness constraint on Strategy or Setup **names** — only the `btrim(...) <> ''` non-blank CHECK. UUID identity remains authoritative, matching `trading_accounts.name`'s deliberate lack of a workspace-level uniqueness constraint (A12-adjacent reasoning: duplicate display names are permitted; the id is what every reference actually uses).

### Entitlements

No Strategy-count or Setup-count limit column, check, or index exists anywhere in this schema, and none is planned — every plan (trial and paid) has unlimited Strategies and Setups with identical functionality. `src/config/plan-catalog.ts`'s `SHARED_BILLING_FEATURE_KEYS` already lists `unlimitedStrategies`/`unlimitedSetups` as shared, non-differentiating features.

---

## Phase 07 — Trades

### `trades`

The system/actual separation is structural — two parallel column sets, neither derived from the other.

| Group                     | Columns                                                                                                                                                     | Notes                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Links                     | `trading_account_id`, `strategy_id`, `strategy_version_id`, `setup_id`, `setup_version_id`                                                                  | Version and setup version both pinned at creation (Phase 06B added the Setup entity after this sketch was originally written) |
| Identity                  | `symbol`, `direction` (`long`\|`short`), `status` (`planned`\|`open`\|`closed`\|`cancelled`)                                                                |                                                                                                                               |
| **Plan**                  | `planned_entry`, `planned_stop`, `planned_target`, `planned_position_size`                                                                                  | What the system proposed                                                                                                      |
| **Actual**                | `actual_entry`, `actual_initial_stop`, `actual_exit`, `position_size`, `contract_multiplier`, `entered_at`, `exited_at`                                     | What the trader did                                                                                                           |
| **System counterfactual** | `system_exit_price`, `system_outcome` (`win`\|`loss`\|`break_even`\|`no_trade`), `system_exit_reason` (`target_hit`\|`stop_hit`\|`rule_exit`\|`still_open`) | Self-reported; see the limitation in the product spec                                                                         |
| Costs                     | `commission`, `fees`, `swap`                                                                                                                                | `BIGINT` minor units                                                                                                          |
| Derived                   | `initial_risk_amount`, `gross_pnl`, `net_pnl`, `planned_r`, `system_r`, `actual_r`, `trader_outcome`, `calc_version`                                        | Persisted at close                                                                                                            |
| Behaviour                 | `followed_plan`, `confidence` (1–5), `tradingview_url`, `notes`                                                                                             |                                                                                                                               |

`actual_initial_stop` is the stop **as first placed**, not as later moved. Moving a stop is a discipline event recorded as a mistake; if this field tracked the moved stop, the R denominator would shift and the mistake would erase its own evidence.

**Why derived values are persisted:** analytics over thousands of trades must not recompute decimals per row, and a later engine fix must not silently rewrite historical numbers. `calc_version` makes recomputation an explicit, auditable backfill.

### `mistake_types`

| Column         | Type    | Notes                                |
| -------------- | ------- | ------------------------------------ |
| `workspace_id` | uuid    | Nullable for seeded system types     |
| `key`          | text    | Stable identifier                    |
| `label`        | text    |                                      |
| `severity`     | enum    | `minor` \| `moderate` \| `severe`    |
| `is_system`    | boolean | Seeded taxonomy vs workspace-defined |

Seeded: moved stop · early exit · oversized · no setup · revenge trade · chased entry · ignored invalidation · moved target · no stop.

Editing a severity does **not** retroactively rewrite historical discipline scores — the penalty is snapshotted when the trade is saved.

### `trade_mistakes`

Join table, primary key `(trade_id, mistake_type_id)`, with an optional per-instance `note`.

### `trade_checklist_results`

`(trade_id, checklist_item_id, was_satisfied)`. Required-but-unsatisfied items feed the discipline score.

---

## Phase 11 — Administration

### `admin_audit_log`

`actor_user_id`, `action`, `target_type`, `target_id`, `before` (jsonb), `after` (jsonb), `reason`, `created_at`.

Every platform-admin mutation writes a row. Non-negotiable: admins act on other people's data.

---

## Index plan

| Table               | Index                                                                                 | Status                 |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| `users`             | `(email)` unique — `users_email_idx`                                                  | Implemented (Phase 02) |
| `sessions`          | `(token)` unique, `(user_id)`                                                         | Implemented (Phase 02) |
| `accounts`          | `(user_id)`, `(provider_id, account_id)` unique                                       | Implemented (Phase 02) |
| `verifications`     | `(identifier)`                                                                        | Implemented (Phase 02) |
| `rate_limits`       | `(key)` unique                                                                        | Implemented (Phase 02) |
| `workspaces`        | `(personal_owner_user_id)` unique, partial WHERE kind = 'personal'                    | Implemented (Phase 02) |
| `workspace_members` | `(workspace_id, user_id)` unique, `(user_id)` — resolving a session to its workspaces | Implemented (Phase 02) |
| `audit_logs`        | `(workspace_id, created_at)` — `audit_logs_workspace_created_idx`                     | Implemented (Phase 02) |
| `trades`            | `(workspace_id, trading_account_id, exited_at)`                                       | Planned (Phase 07)     |
| `trades`            | `(workspace_id, strategy_version_id)`                                                 | Planned (Phase 07)     |
| `trades`            | `(workspace_id, status)`                                                              | Planned (Phase 07)     |
| `trade_mistakes`    | `(mistake_type_id)` — mistake cost ranking                                            | Planned (Phase 07)     |

Verify with `EXPLAIN ANALYZE` rather than assuming these are used.
