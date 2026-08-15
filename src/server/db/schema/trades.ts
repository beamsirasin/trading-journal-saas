import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { CALC_VERSION } from '@/config/trade-calc';
import { generateId } from '@/lib/identifiers';

import { setups } from './setups';
import { strategies, strategyVersions } from './strategies';
import { strategySetupVersions } from './strategy-setup-versions';
import { tradingAccounts } from './trading-accounts';
import { workspaces } from './workspaces';

/**
 * One Trade = one complete trading idea/position — not one execution, not a
 * multi-leg composite. Phase 07B does not support partial entries, partial
 * exits, scale-in/scale-out, or a `trade_executions` child table; the shape
 * below deliberately keeps that door open for a later phase (summary columns
 * like `actual_entry`/`actual_position_size` would become derived
 * weighted-average snapshots over execution rows without changing any
 * existing column's meaning), but no such table exists now.
 *
 * Every normal Trade pins its full decision framework at creation — Trading
 * Account, Strategy, the exact Strategy Version, Setup, and the exact Setup
 * Version — all four non-nullable (locked product decision). A
 * general-purpose Strategy uses an explicit "General Setup"-style Setup
 * rather than a nullable Setup reference; this is what lets every Trade
 * preserve one exact, unambiguous historical snapshot rather than two shapes
 * (with-Setup and without) that Phase 08/09 queries would otherwise need to
 * handle separately forever.
 *
 * `strategy_version_id`/`setup_version_id` are immutable from a future
 * service's perspective once a Trade references them — Phase 08's
 * `lockStrategyVersionForReferenceInTx` (already built in
 * `src/server/services/strategy-versioning.ts`) is what performs that lock,
 * in the same transaction as a Trade's first insert. Phase 07B installs no
 * trigger that locks a Strategy Version automatically; the schema only makes
 * the reference itself impossible to point at a mismatched Strategy/Setup
 * pairing (see the composite foreign keys below).
 *
 * Trades use `deleted_at` soft-deletion, not `is_archived` — the one
 * deliberate exception to this codebase's usual archive-only convention
 * (CLAUDE.md assumption A7). A Trade is a personal record a trader may
 * remove entirely from their own numbers, not a reversible business-lifecycle
 * entity like a Strategy or Trading Account; "why derived values are
 * persisted" reasoning (calc_version + explicit backfill) is what protects
 * historical analytics stability instead, matching the same job
 * `is_archived` does for every other table.
 *
 * Trades remain editable after `status = 'closed'` — unlike a locked
 * Strategy Version, a Trade is the measurement record itself, and a trader
 * must be able to correct a data-entry mistake (`PHASE-08-journal.md`'s own
 * Definition of Done requires "editing a closed trade must recompute derived
 * values and never leave stale R"). Historical integrity here is protected
 * by `calc_version` plus an explicit backfill migration being the only
 * sanctioned way engine output changes retroactively, and by an audit-log
 * entry on every edit (Phase 08's job) — never by row-level immutability.
 */
export const trades = pgTable(
  'trades',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Create-idempotency, identical pattern to `strategies.mutation_key`. */
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),

    // -------------------------------------------------------------------
    // Pinned framework — every field below is required and immutable from a
    // future service's perspective once the Trade exists.
    // -------------------------------------------------------------------
    tradingAccountId: uuid('trading_account_id')
      .notNull()
      .references(() => tradingAccounts.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid('strategy_version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    setupId: uuid('setup_id')
      .notNull()
      .references(() => setups.id, { onDelete: 'cascade' }),
    setupVersionId: uuid('setup_version_id')
      .notNull()
      .references(() => strategySetupVersions.id, { onDelete: 'cascade' }),

    // -------------------------------------------------------------------
    // Trade context
    // -------------------------------------------------------------------
    symbol: text('symbol').notNull(),
    direction: text('direction').notNull(),
    timeframe: text('timeframe'),
    session: text('session'),
    confirmationNotes: text('confirmation_notes'),
    /**
     * Exactly one of 0/25/50/75/100, or NULL — never a financial value,
     * plain `smallint` is safe (CLAUDE.md §5). Migration 0010 has not been
     * committed/merged yet, so its schema and backfill were updated IN
     * PLACE for this Founder-UAT Confidence redesign rather than
     * superseded by a new migration — see `trades_confidence_check` and
     * that migration's own updated backfill comment. Supersedes BOTH
     * earlier uncommitted drafts: a continuous 0–100 range, and before that
     * a 1–5 rating.
     */
    confidence: smallint('confidence'),
    tradingviewUrl: text('tradingview_url'),
    notes: text('notes'),
    /** Post-trade reflection, distinct from pre-trade Entry Reason and legacy notes. */
    reviewNotes: text('review_notes'),
    /** NULL on historical rows; non-NULL means emotion capture occurred, including a zero selection. */
    emotionsRecordedAt: timestamp('emotions_recorded_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Chart attachment — Image upload (migration 0010). Distinct from
    // `tradingview_url` above (a Trade may carry a chart LINK, an uploaded
    // IMAGE, both, or neither). Never a blob/base64 column (CLAUDE.md's "no
    // unnecessary Vercel-only features" spirit extends to never storing
    // binary content in Postgres). A Chart screenshot is tenant-private user
    // content (Founder review, private-storage correction) — the object is
    // uploaded to private object storage and NO public URL is ever
    // persisted here; `chart_attachment_storage_key` is the minimum stable
    // private object identity needed to retrieve it, and only the
    // authenticated application delivery route
    // (`src/app/api/trades/[tradeId]/chart-attachment/route.ts`) ever reads
    // it back, after independently re-deriving session + Workspace
    // authorization. Both columns are populated together or not at all
    // (`trades_chart_attachment_check`). The storage key is always
    // server-generated/random (see `src/lib/storage/`), never derived from
    // the user-supplied filename.
    // -------------------------------------------------------------------
    chartAttachmentStorageKey: text('chart_attachment_storage_key'),
    chartAttachmentUploadedAt: timestamp('chart_attachment_uploaded_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Plan — the system's proposal. A Trade always starts with a plan, even
    // in `status = 'planned'`, but since migration 0010 (Founder-UAT Trade
    // Plan UX correction slice) that plan may be expressed as Price
    // (`planned_entry`/`planned_stop`/`planned_target`), Money
    // (`planned_risk_minor`/`planned_reward_minor`, below), or both at once
    // — `planned_entry`/`planned_stop` are nullable so a Money-only plan
    // never has to fabricate placeholder prices. `trades_planned_price_shape_check`
    // still requires entry+stop to be a complete, direction-valid pair
    // whenever EITHER is present; `trades_plan_minimum_check` still requires
    // at least one representation (Price or Money) on every row — see both
    // checks below.
    // -------------------------------------------------------------------
    plannedEntry: numeric('planned_entry', { precision: 20, scale: 10 }),
    plannedStop: numeric('planned_stop', { precision: 20, scale: 10 }),
    plannedTarget: numeric('planned_target', { precision: 20, scale: 10 }),
    /** Informational only — Planned R (CLAUDE.md §6) is a pure per-unit ratio and never uses position size. */
    plannedPositionSize: numeric('planned_position_size', { precision: 20, scale: 10 }),

    // -------------------------------------------------------------------
    // Plan — Money mode (migration 0010). Truthful monetary risk/reward,
    // account-currency `bigint` minor units — the Trading Account's own
    // `base_currency`, never a second currency field on `trades` itself.
    // Deliberately NOT `actual_initial_risk_minor`/`net_pnl_minor`: those are
    // ACTUAL-execution authoritative inputs (CLAUDE.md §6); reusing them for
    // a PLAN would conflate "what the trader intended" with "what actually
    // happened." `planned_reward_minor` may be exactly zero (a
    // break-even-or-better plan is meaningful); `planned_risk_minor` must be
    // strictly positive whenever present, and a Reward may never be present
    // without a Risk — see `trades_planned_money_check`.
    // -------------------------------------------------------------------
    plannedRiskMinor: bigint('planned_risk_minor', { mode: 'bigint' }),
    plannedRewardMinor: bigint('planned_reward_minor', { mode: 'bigint' }),

    // -------------------------------------------------------------------
    // Actual execution. `actual_initial_stop` is the stop AS FIRST PLACED,
    // never as later moved — moving a stop is a discipline event recorded as
    // a mistake, not a re-baselined denominator (CLAUDE.md §6,
    // `docs/data-dictionary.md`).
    // -------------------------------------------------------------------
    actualEntry: numeric('actual_entry', { precision: 20, scale: 10 }),
    actualInitialStop: numeric('actual_initial_stop', { precision: 20, scale: 10 }),
    actualExit: numeric('actual_exit', { precision: 20, scale: 10 }),
    /** Informational only, like `planned_position_size` — never an authoritative monetary input (see below). */
    actualPositionSize: numeric('actual_position_size', { precision: 20, scale: 10 }),

    // -------------------------------------------------------------------
    // Authoritative monetary inputs. Deliberately NOT derived from
    // price x quantity x contract multiplier — that formula is not
    // universally valid across Forex, gold, crypto and indices, especially
    // when account currency differs from quote currency (locked product
    // decision). `actual_initial_risk_minor` and `net_pnl_minor` are the two
    // authoritative bigint account-currency-minor-unit inputs Actual R is
    // computed from; prices/quantity above are informational primitives
    // only.
    // -------------------------------------------------------------------
    actualInitialRiskMinor: bigint('actual_initial_risk_minor', { mode: 'bigint' }),
    /** Optional derived snapshot for transparency; never itself an input to Actual R. */
    grossPnlMinor: bigint('gross_pnl_minor', { mode: 'bigint' }),
    commissionMinor: bigint('commission_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    feesMinor: bigint('fees_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    swapMinor: bigint('swap_minor', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
    netPnlMinor: bigint('net_pnl_minor', { mode: 'bigint' }),
    enteredAt: timestamp('entered_at', { withTimezone: true }),
    exitedAt: timestamp('exited_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // System counterfactual — independent lifecycle from Trade execution
    // status (CLAUDE.md §1). `pending` = not yet recorded; `no_trade` = the
    // approved Strategy/Setup would not have permitted the Trade at all, a
    // real terminal state, never conflated with `pending`.
    // -------------------------------------------------------------------
    systemStatus: text('system_status').notNull().default('pending'),
    systemExitPrice: numeric('system_exit_price', { precision: 20, scale: 10 }),
    systemExitedAt: timestamp('system_exited_at', { withTimezone: true }),
    systemExitReason: text('system_exit_reason'),
    /**
     * A user-supplied estimate of costs attributable to the counterfactual
     * System execution, expressed directly in R (locked: `systemR =
     * systemGrossR - systemCostR`) — never automatically copied from Actual
     * `commission_minor`/`fees_minor`/`swap_minor`, and never calculated
     * from a per-account cost constant in MVP. Supplied only when resolving
     * the System result; pinned to exactly `0` while `pending` or
     * `no_trade` (see `trades_system_status_consistency_check`).
     */
    systemCostR: numeric('system_cost_r', { precision: 12, scale: 4 }).notNull().default('0'),
    systemResolvedAt: timestamp('system_resolved_at', { withTimezone: true }),

    // -------------------------------------------------------------------
    // Derived snapshots — persisted at compute time, never client-supplied
    // trusted input. "Why derived values are persisted": analytics over
    // thousands of trades must not recompute decimals per row, and a later
    // engine fix must not silently rewrite historical numbers.
    // -------------------------------------------------------------------
    plannedR: numeric('planned_r', { precision: 12, scale: 4 }),
    actualR: numeric('actual_r', { precision: 12, scale: 4 }),
    systemR: numeric('system_r', { precision: 12, scale: 4 }),
    traderOutcome: text('trader_outcome'),
    systemOutcome: text('system_outcome'),
    calcVersion: integer('calc_version').notNull().default(CALC_VERSION),

    // -------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------
    status: text('status').notNull().default('planned'),
    followedPlan: boolean('followed_plan'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trades_workspace_idx').on(table.workspaceId),
    index('trades_workspace_account_idx').on(table.workspaceId, table.tradingAccountId),
    index('trades_workspace_account_exited_idx').on(
      table.workspaceId,
      table.tradingAccountId,
      table.exitedAt,
    ),
    index('trades_workspace_status_idx').on(table.workspaceId, table.status),
    index('trades_workspace_strategy_version_idx').on(table.workspaceId, table.strategyVersionId),
    index('trades_workspace_deleted_idx').on(table.workspaceId, table.deletedAt),
    uniqueIndex('trades_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    // Composite-FK plumbing for `trade_rule_checks`/`trade_mistakes`, which
    // must prove they belong to the same workspace as the Trade they attach
    // to, and (id, strategy_version_id) for `trade_rule_checks`, which must
    // prove a Rule check references the exact Strategy Version its own
    // Trade is pinned to — never a different, mismatched Version.
    uniqueIndex('trades_id_workspace_idx').on(table.id, table.workspaceId),
    uniqueIndex('trades_id_strategy_version_idx').on(table.id, table.strategyVersionId),
    // Composite-FK plumbing for `trade_setup_condition_checks`.
    uniqueIndex('trades_id_setup_version_idx').on(table.id, table.setupVersionId),

    // Tenant/parent integrity — every reference chains back to the same
    // workspace and the same Strategy, mirroring Phase 06's own composite-FK
    // pattern exactly (`strategy_versions_strategy_workspace_fk`,
    // `strategy_setup_versions_setup_strategy_fk`, etc).
    foreignKey({
      name: 'trades_trading_account_workspace_fk',
      columns: [table.tradingAccountId, table.workspaceId],
      foreignColumns: [tradingAccounts.id, tradingAccounts.workspaceId],
    }),
    foreignKey({
      name: 'trades_strategy_workspace_fk',
      columns: [table.strategyId, table.workspaceId],
      foreignColumns: [strategies.id, strategies.workspaceId],
    }),
    foreignKey({
      name: 'trades_strategy_version_strategy_fk',
      columns: [table.strategyVersionId, table.strategyId],
      foreignColumns: [strategyVersions.id, strategyVersions.strategyId],
    }),
    foreignKey({
      name: 'trades_setup_strategy_fk',
      columns: [table.setupId, table.strategyId],
      foreignColumns: [setups.id, setups.strategyId],
    }),
    foreignKey({
      name: 'trades_setup_version_strategy_version_fk',
      columns: [table.setupVersionId, table.strategyVersionId],
      foreignColumns: [strategySetupVersions.id, strategySetupVersions.strategyVersionId],
    }),
    // Closes a gap the Version-level FK above cannot: without this, a Trade
    // could pair a valid `setup_id` with a `setup_version_id` that is a real
    // snapshot belonging to a *different* Setup within the very same
    // Strategy Version ("Setup Version belonging to another Setup"). This
    // FK proves the referenced snapshot is genuinely a snapshot *of* this
    // Trade's own `setup_id`.
    foreignKey({
      name: 'trades_setup_version_setup_fk',
      columns: [table.setupVersionId, table.setupId],
      foreignColumns: [strategySetupVersions.id, strategySetupVersions.setupId],
    }),

    check('trades_direction_check', sql`${table.direction} IN ('long', 'short')`),
    check('trades_status_check', sql`${table.status} IN ('planned', 'open', 'closed', 'canceled')`),
    check(
      'trades_system_status_check',
      sql`${table.systemStatus} IN ('pending', 'resolved', 'no_trade')`,
    ),
    check(
      'trades_system_exit_reason_check',
      sql`${table.systemExitReason} IS NULL OR ${table.systemExitReason} IN (
        'target_hit', 'stop_hit', 'break_even_rule', 'trailing_exit',
        'time_exit', 'rule_exit', 'manual_system_valid_exit', 'setup_invalidated'
      )`,
    ),
    check(
      'trades_trader_outcome_check',
      sql`${table.traderOutcome} IS NULL OR ${table.traderOutcome} IN ('win', 'loss', 'break_even')`,
    ),
    check(
      'trades_system_outcome_check',
      sql`${table.systemOutcome} IS NULL OR ${table.systemOutcome} IN ('win', 'loss', 'break_even')`,
    ),
    check(
      'trades_confidence_check',
      sql`${table.confidence} IS NULL OR ${table.confidence} IN (0, 25, 50, 75, 100)`,
    ),
    check('trades_calc_version_check', sql`${table.calcVersion} > 0`),
    check('trades_system_cost_r_check', sql`${table.systemCostR} >= 0`),
    check(
      'trades_actual_initial_risk_minor_check',
      sql`${table.actualInitialRiskMinor} IS NULL OR ${table.actualInitialRiskMinor} > 0`,
    ),
    check('trades_commission_minor_check', sql`${table.commissionMinor} >= 0`),
    check('trades_fees_minor_check', sql`${table.feesMinor} >= 0`),
    check('trades_swap_minor_check', sql`${table.swapMinor} >= 0`),
    check(
      'trades_exited_after_entered_check',
      sql`${table.exitedAt} IS NULL OR ${table.enteredAt} IS NULL OR ${table.exitedAt} >= ${table.enteredAt}`,
    ),

    // Direction-aware planned-price integrity — prevents zero/negative
    // planned risk and a Stop or Target on the wrong side of Entry at the
    // database layer, not merely at the Zod/service boundary (CLAUDE.md §6:
    // "riskPerUnit must be strictly positive... reject at validation, never
    // silently proceed"). Migration 0010 (Founder-UAT Trade Plan UX
    // correction slice) widened this from "Entry/Stop always present" to
    // "Entry/Stop present as a complete, valid pair, OR both entirely
    // absent" — a lone Entry, a lone Stop, or a Target with neither is never
    // valid shape, matching `composePlannedR`'s own defensive fragment
    // rejection in `src/lib/calc/trade.ts`.
    check(
      'trades_planned_price_shape_check',
      sql`(
        ${table.plannedEntry} IS NULL AND ${table.plannedStop} IS NULL AND ${table.plannedTarget} IS NULL
      ) OR (
        ${table.plannedEntry} IS NOT NULL AND ${table.plannedStop} IS NOT NULL
        AND (
          (
            ${table.direction} = 'long'
            AND ${table.plannedStop} < ${table.plannedEntry}
            AND (${table.plannedTarget} IS NULL OR ${table.plannedTarget} > ${table.plannedEntry})
          ) OR (
            ${table.direction} = 'short'
            AND ${table.plannedStop} > ${table.plannedEntry}
            AND (${table.plannedTarget} IS NULL OR ${table.plannedTarget} < ${table.plannedEntry})
          )
        )
      )`,
    ),

    // Money-mode plan integrity (migration 0010) — mirrors the Price side's
    // own posture: Risk must be strictly positive whenever present, Reward
    // may be exactly zero but never negative, and a Reward can never appear
    // without a Risk to normalize it against (the Money-mode equivalent of
    // "a Target with neither Entry nor Stop").
    check(
      'trades_planned_money_check',
      sql`(${table.plannedRiskMinor} IS NULL OR ${table.plannedRiskMinor} > 0)
        AND (${table.plannedRewardMinor} IS NULL OR ${table.plannedRewardMinor} >= 0)
        AND (${table.plannedRewardMinor} IS NULL OR ${table.plannedRiskMinor} IS NOT NULL)`,
    ),

    // The Founder-UAT "minimum plan validity" floor (migration 0010): every
    // Trade must carry at least one complete, meaningful Plan representation
    // — a full Price pair (Entry+Stop) or a Money Risk. Never enforced only
    // client-side; this is the database-authoritative backstop behind the
    // same rule `trade-management.ts`'s `createTrade`/`updateTradePlan`/
    // `correctTradeIdentity` already enforce before ever reaching this
    // constraint.
    check(
      'trades_plan_minimum_check',
      sql`(${table.plannedEntry} IS NOT NULL AND ${table.plannedStop} IS NOT NULL)
        OR ${table.plannedRiskMinor} IS NOT NULL`,
    ),

    // Chart-attachment terminal fields (migration 0010) — populated together
    // or not at all, the same all-or-nothing posture
    // `trades_system_status_consistency_check` already establishes for a
    // different field group.
    check(
      'trades_chart_attachment_check',
      sql`(
        ${table.chartAttachmentStorageKey} IS NULL
        AND ${table.chartAttachmentUploadedAt} IS NULL
      ) OR (
        ${table.chartAttachmentStorageKey} IS NOT NULL
        AND ${table.chartAttachmentUploadedAt} IS NOT NULL
      )`,
    ),

    // System-status consistency — the three states are mutually exclusive
    // and each requires/forbids an exact set of terminal fields, including
    // `system_cost_r` itself. `systemR = systemGrossR - systemCostR` is a
    // locked formula (Phase 07B correction): `system_cost_r` is a
    // user-supplied cost estimate attributable to the counterfactual System
    // execution, expressed directly in R, supplied only when RESOLVING the
    // System result — it is meaningless while `pending` (nothing has been
    // resolved yet) or under `no_trade` (there is no counterfactual
    // execution to attribute a cost to), so both of those states pin it to
    // exactly zero rather than merely allowing it. `resolved` additionally
    // requires `system_r`/`system_outcome` to be present — unlike an
    // earlier draft of this constraint, resolving the System result and
    // computing its R/outcome are not allowed to be two separable steps;
    // the column-level `trades_system_cost_r_check` (`>= 0`, unconditional)
    // still applies to every row regardless of status.
    check(
      'trades_system_status_consistency_check',
      sql`(
        ${table.systemStatus} = 'pending'
        AND ${table.systemCostR} = 0
        AND ${table.systemExitPrice} IS NULL
        AND ${table.systemExitedAt} IS NULL
        AND ${table.systemExitReason} IS NULL
        AND ${table.systemResolvedAt} IS NULL
        AND ${table.systemR} IS NULL
        AND ${table.systemOutcome} IS NULL
      ) OR (
        ${table.systemStatus} = 'resolved'
        AND ${table.systemCostR} >= 0
        AND ${table.systemExitPrice} IS NOT NULL
        AND ${table.systemExitedAt} IS NOT NULL
        AND ${table.systemExitReason} IS NOT NULL
        AND ${table.systemExitReason} <> 'setup_invalidated'
        AND ${table.systemResolvedAt} IS NOT NULL
        AND ${table.systemR} IS NOT NULL
        AND ${table.systemOutcome} IS NOT NULL
      ) OR (
        ${table.systemStatus} = 'no_trade'
        AND ${table.systemCostR} = 0
        AND ${table.systemExitPrice} IS NULL
        AND ${table.systemExitedAt} IS NULL
        AND ${table.systemExitReason} = 'setup_invalidated'
        AND ${table.systemResolvedAt} IS NOT NULL
        AND ${table.systemR} IS NULL
        AND ${table.systemOutcome} IS NULL
      )`,
    ),

    // Trade-execution-status consistency — each status requires/forbids an
    // exact set of actual-execution fields. `canceled` is deliberately
    // unconstrained in shape (a Trade may be canceled from `planned` with
    // nothing filled in, or from `open` with partial data already present);
    // exclusion from Trader metrics is a query-level filter
    // (`status <> 'canceled'`), not a schema shape.
    check(
      'trades_status_consistency_check',
      sql`(
        ${table.status} = 'planned'
        AND ${table.actualEntry} IS NULL
        AND ${table.actualInitialStop} IS NULL
        AND ${table.actualInitialRiskMinor} IS NULL
        AND ${table.enteredAt} IS NULL
        AND ${table.actualExit} IS NULL
        AND ${table.netPnlMinor} IS NULL
        AND ${table.exitedAt} IS NULL
        AND ${table.actualR} IS NULL
        AND ${table.traderOutcome} IS NULL
      ) OR (
        ${table.status} = 'open'
        AND ${table.actualEntry} IS NOT NULL
        AND ${table.actualInitialStop} IS NOT NULL
        AND ${table.actualInitialRiskMinor} IS NOT NULL
        AND ${table.enteredAt} IS NOT NULL
        AND ${table.actualExit} IS NULL
        AND ${table.netPnlMinor} IS NULL
        AND ${table.exitedAt} IS NULL
        AND ${table.actualR} IS NULL
        AND ${table.traderOutcome} IS NULL
      ) OR (
        ${table.status} = 'closed'
        AND ${table.actualEntry} IS NOT NULL
        AND ${table.actualInitialStop} IS NOT NULL
        AND ${table.actualInitialRiskMinor} IS NOT NULL
        AND ${table.enteredAt} IS NOT NULL
        AND ${table.actualExit} IS NOT NULL
        AND ${table.netPnlMinor} IS NOT NULL
        AND ${table.exitedAt} IS NOT NULL
        AND ${table.actualR} IS NOT NULL
        AND ${table.traderOutcome} IS NOT NULL
      ) OR (
        ${table.status} = 'canceled'
      )`,
    ),
  ],
);
