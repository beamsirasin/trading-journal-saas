# Data Dictionary

**Status:** Phase 03 is officially complete. Phase 02 auth/tenancy plus Phase 3A–3C onboarding, trading-account, and entitlement tables are real and migrated. Phase 04 billing-provider and payment-snapshot storage remains planned and must extend, not duplicate, the existing entitlement source.

Tables are added by re-exporting them from `src/server/db/schema/index.ts`.

> **Reading numeric columns.** Financial `numeric` and `bigint` columns stay strings; coercing them to JS numbers would reintroduce floating-point loss. The sole Phase 2 exception is Better Auth's `rate_limits.last_request`: it is SQL `bigint` with Drizzle `mode: 'number'` because the installed library consumes epoch milliseconds as a number, still safely below `Number.MAX_SAFE_INTEGER`. A dedicated financial `numeric` contract test lands with the first product column in Phase 07.

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

## Phase 3C — Trial entitlements and account limits (implemented, ahead of Phase 04)

Migrations: [`drizzle/0003_add_workspace_entitlements.sql`](../drizzle/0003_add_workspace_entitlements.sql) (table + trial backfill for already-onboarded workspaces), [`drizzle/0004_rename_plan_keys_trader_professional.sql`](../drizzle/0004_rename_plan_keys_trader_professional.sql) (renamed a since-retired `pro`/`elite` draft to the locked `trader`/`professional` keys). Plan registry: [`src/config/plans.ts`](../src/config/plans.ts). Pure resolution logic: [`src/lib/entitlements/resolve.ts`](../src/lib/entitlements/resolve.ts).

### `workspace_entitlements` (application-owned)

The one authoritative source of a workspace's trial/subscription state — narrower than the `subscriptions` table Phase 04 originally planned below (no payment-provider identifiers yet; those arrive when a real provider is wired in).

| Column                   | Type        | Notes                                                                           |
| ------------------------ | ----------- | ------------------------------------------------------------------------------- |
| `workspace_id`           | uuid        | Unique (`workspace_entitlements_workspace_idx`) — at most one row per workspace |
| `status`                 | text, CHECK | `trialing` \| `active` \| `expired` \| `canceled`                               |
| `plan_key`               | text, CHECK | `NULL` (no plan selected yet) \| `starter` \| `trader` \| `professional`        |
| `trial_started_at`       | timestamptz | `NULL` until onboarding completes                                               |
| `trial_ends_at`          | timestamptz | Evaluated on read (`now >= trial_ends_at`) — expiry needs no scheduler          |
| `current_period_ends_at` | timestamptz | `NULL` until a real billing period exists (Phase 04+)                           |

**Locked plan decision:** the trial grants exactly **1** active trading account for **7 days** with every feature unlocked — an explicit constant (`TRIAL_ACCOUNT_LIMIT`), never derived from any paid plan's limit. Paid plans gate exclusively on active (non-archived) trading-account count and otherwise share identical features and analytics: Starter (1 account, THB 149/USD 5 per month), Trader (5 accounts, THB 299/USD 9), Professional (15 accounts, THB 499/USD 15). Every paid plan includes unlimited strategies, setups, trades, and trade history. Archived accounts do not count; create and restore enforce the limit server-side. VAT collection is disabled at launch because the business is not initially VAT registered.

---

## Phase 04 — Billing

### `subscriptions`

Phase 04 billing and mock-provider integration are not yet implemented. `workspace_entitlements` (above) already owns `status`/`plan`/trial-date tracking for Phase 3C's server-side enforcement; provider-shaped fields (customer ID, subscription ID, billing period) may widen that table rather than create a conflicting subscription source, but the exact storage shape is not yet decided. A real payment provider still requires a separate approved decision.

| Column                 | Type        | Notes                                                           |
| ---------------------- | ----------- | --------------------------------------------------------------- |
| `workspace_id`         | uuid        | Unique — one subscription per workspace                         |
| `plan`                 | enum        | `starter` \| `trader` \| `professional`                         |
| `status`               | enum        | `trialing` \| `active` \| `past_due` \| `canceled` \| `expired` |
| `trial_ends_at`        | timestamptz | Evaluated on read, so expiry needs no scheduler                 |
| `current_period_start` | timestamptz |                                                                 |
| `current_period_end`   | timestamptz |                                                                 |
| `cancel_at_period_end` | boolean     |                                                                 |

The exact Phase 04 schema is not locked by this preflight. Whatever storage shape is selected must preserve immutable per-payment snapshots of plan key, currency, subtotal/price in integer minor units, VAT enabled state, VAT rate, VAT amount, final total, and reconciliation identifiers/timestamps. Historical rows must never be recomputed from current prices or VAT configuration.

VAT is exclusive when enabled and is added at checkout, not included in displayed plan prices. VAT configuration is admin-owned in Phase 11, disabled by default, and initially prepared as 7%; Phase 04 customer billing reads trusted server configuration and never accepts a client-supplied VAT rate or tax amount. When disabled, no VAT line or public VAT notice is rendered.

---

## Phase 05 — Trading accounts

### `trading_accounts`

| Column                   | Type          | Notes                                                                                                               |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `name`                   | text          |                                                                                                                     |
| `broker`                 | text          | Nullable                                                                                                            |
| `account_type`           | enum          | `live` \| `demo` \| `backtest` \| `prop_challenge`                                                                  |
| `currency`               | char(3)       | ISO-4217. **Immutable once a trade exists** — changing it would silently reinterpret every stored minor-unit amount |
| `starting_balance`       | bigint        | Minor units                                                                                                         |
| `risk_model`             | enum          | `fixed_fractional` \| `fixed_amount`                                                                                |
| `risk_value`             | numeric(12,4) | Percent or minor units, per `risk_model`                                                                            |
| `break_even_tolerance_r` | numeric(6,4)  | Default `0.05`. The configurable tolerance required by the calculation spec                                         |
| `timezone`               | text          | Nullable; inherits the user's when null                                                                             |
| `is_archived`            | boolean       | Archived accounts retain analytics                                                                                  |

---

## Phase 06 — Strategies

### `strategies`

| Column               | Type | Notes                  |
| -------------------- | ---- | ---------------------- |
| `name`               | text |                        |
| `description`        | text |                        |
| `instrument_class`   | text | Nullable               |
| `timeframe`          | text | Nullable               |
| `current_version_id` | uuid | Fast default selection |

### `strategy_versions`

| Column            | Type    | Notes                                                             |
| ----------------- | ------- | ----------------------------------------------------------------- |
| `strategy_id`     | uuid    |                                                                   |
| `version_number`  | integer | Unique with `strategy_id`                                         |
| `entry_rules`     | text    | Markdown                                                          |
| `exit_rules`      | text    | Markdown                                                          |
| `risk_rules`      | text    | Markdown                                                          |
| `setup_checklist` | jsonb   | `[{ id, label, required }]`; item IDs are stable and never reused |
| `is_locked`       | boolean | Set true on the first referencing trade                           |
| `change_note`     | text    | Required when superseding a locked version                        |

**Immutability:** a version is editable only while unreferenced. Once a trade points at it, it locks permanently and edits create version _n+1_. Without this, analytics would blend results from rules that have since changed, and system performance would become meaningless.

---

## Phase 07 — Trades

### `trades`

The system/actual separation is structural — two parallel column sets, neither derived from the other.

| Group                     | Columns                                                                                                                                                     | Notes                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Links                     | `trading_account_id`, `strategy_id`, `strategy_version_id`                                                                                                  | Version pinned at creation                            |
| Identity                  | `symbol`, `direction` (`long`\|`short`), `status` (`planned`\|`open`\|`closed`\|`cancelled`)                                                                |                                                       |
| **Plan**                  | `planned_entry`, `planned_stop`, `planned_target`, `planned_position_size`                                                                                  | What the system proposed                              |
| **Actual**                | `actual_entry`, `actual_initial_stop`, `actual_exit`, `position_size`, `contract_multiplier`, `entered_at`, `exited_at`                                     | What the trader did                                   |
| **System counterfactual** | `system_exit_price`, `system_outcome` (`win`\|`loss`\|`break_even`\|`no_trade`), `system_exit_reason` (`target_hit`\|`stop_hit`\|`rule_exit`\|`still_open`) | Self-reported; see the limitation in the product spec |
| Costs                     | `commission`, `fees`, `swap`                                                                                                                                | `BIGINT` minor units                                  |
| Derived                   | `initial_risk_amount`, `gross_pnl`, `net_pnl`, `planned_r`, `system_r`, `actual_r`, `trader_outcome`, `calc_version`                                        | Persisted at close                                    |
| Behaviour                 | `followed_plan`, `confidence` (1–5), `tradingview_url`, `notes`                                                                                             |                                                       |

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
