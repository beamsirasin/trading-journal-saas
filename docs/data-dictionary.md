# Data Dictionary

**Status:** Planned schema. **No tables exist yet.** Phase 00b wired the Drizzle boundary — config, a lazily-connecting client, and an intentionally empty schema module — but created no tables and no migration. This document defines intent so field meanings are agreed before implementation, and is updated as each phase lands its migration.

Tables are added by re-exporting them from `src/server/db/schema/index.ts`.

> **Reading numeric columns.** The driver returns `numeric` and `bigint` as **strings**, which is what the money and price strategy requires. Coercing them to JS numbers would reintroduce the floating-point error the design exists to avoid — invisibly, and only for values large or precise enough to matter. Phase 03 must add a test asserting a `numeric` column round-trips as a string; until a database exists, the guarantee rests on documentation alone.

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

## Phase 03 — Identity and tenancy

### `users`

| Column                    | Type        | Notes                                                      |
| ------------------------- | ----------- | ---------------------------------------------------------- |
| `id`                      | uuid        | UUIDv7                                                     |
| `email`                   | citext      | Unique                                                     |
| `name`                    | text        | Display name                                               |
| `image`                   | text        | Avatar URL, nullable                                       |
| `timezone`                | text        | IANA, e.g. `Asia/Bangkok`. Drives all date bucketing       |
| `is_platform_admin`       | boolean     | Default false. Granted only by direct DB update (Phase 11) |
| `onboarding_completed_at` | timestamptz | Nullable                                                   |

### `workspaces`

| Column          | Type        | Notes                                 |
| --------------- | ----------- | ------------------------------------- |
| `id`            | uuid        |                                       |
| `name`          | text        |                                       |
| `slug`          | text        | Unique; used in URLs                  |
| `owner_user_id` | uuid        | Billing subject                       |
| `deleted_at`    | timestamptz | 30-day soft delete before hard delete |

### `workspace_members`

| Column         | Type | Notes                          |
| -------------- | ---- | ------------------------------ |
| `workspace_id` | uuid |                                |
| `user_id`      | uuid |                                |
| `role`         | enum | `owner` \| `admin` \| `member` |

Unique on `(workspace_id, user_id)`.

---

## Phase 04 — Billing

### `subscriptions`

| Column                 | Type        | Notes                                                           |
| ---------------------- | ----------- | --------------------------------------------------------------- |
| `workspace_id`         | uuid        | Unique — one subscription per workspace                         |
| `plan`                 | enum        | `starter` \| `trader` \| `professional`                         |
| `status`               | enum        | `trialing` \| `active` \| `past_due` \| `canceled` \| `expired` |
| `trial_ends_at`        | timestamptz | Evaluated on read, so expiry needs no scheduler                 |
| `current_period_start` | timestamptz |                                                                 |
| `current_period_end`   | timestamptz |                                                                 |
| `cancel_at_period_end` | boolean     |                                                                 |

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

| Table               | Index                                               |
| ------------------- | --------------------------------------------------- |
| `trades`            | `(workspace_id, trading_account_id, exited_at)`     |
| `trades`            | `(workspace_id, strategy_version_id)`               |
| `trades`            | `(workspace_id, status)`                            |
| `workspace_members` | `(user_id)` — resolving a session to its workspaces |
| `trade_mistakes`    | `(mistake_type_id)` — mistake cost ranking          |

Verify with `EXPLAIN ANALYZE` rather than assuming these are used.
