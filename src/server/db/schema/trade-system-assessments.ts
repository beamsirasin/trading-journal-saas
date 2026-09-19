import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * THE CANONICAL SYSTEM ASSESSMENT (migration 0025, Review & System Assessment
 * contract §8–§19). One row per Trade, written only by an explicit Confirm.
 *
 * NO ROW = NO CONFIRMED ASSESSMENT ("Not Assessed"). An unfinished System
 * Assessment Draft is browser-local and is never stored here (contract §8).
 *
 * SEPARATE FROM THE LEGACY `trades.system_*` COLUMNS. Those keep their
 * pre-contract meaning — on a contract row they are "Assessed under the earlier
 * model" (contract §22) — and are never read as this, nor this as them. A Trade
 * may carry both at once; nothing was backfilled.
 *
 * ADD TRADE v1 ROWS ONLY. The three-column foreign key against
 * `trades(id, workspace_id, recording_contract)`, with `recording_contract`
 * pinned to `add_trade_v1` here, makes a canonical assessment of a legacy row,
 * or of another workspace's Trade, unrepresentable.
 *
 * NEVER STORED: Win / Loss / BE (Trader Outcome only), any ±0.05R
 * classification, a Price-derived result, a `price_exit` mechanism, System R
 * derived from Money (read-time: System Money ÷ Risk at Entry), a money
 * equivalent of a direct R, and `needs_review` — which is derived by comparing
 * `dependency_snapshot` with current Capture.
 *
 * `dependency_snapshot` is the versioned (`kind` / `version: 2`) record of the
 * Capture facts this assessment used, plus the Capture origins in force at
 * confirmation as historical evidence; see `docs/data-dictionary.md`,
 * _System Assessment dependency snapshot v2_. It is unrelated to the legacy
 * v1 `trades.system_dependency_snapshot`.
 */
export const tradeSystemAssessments = pgTable(
  'trade_system_assessments',
  {
    tradeId: uuid('trade_id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Always `add_trade_v1` — the third column of the Trade foreign key. */
    recordingContract: text('recording_contract').notNull().default('add_trade_v1'),

    /** `assessed` | `no_trade` | `cannot_determine`. */
    finding: text('finding').notNull(),
    /** Q2 — what should have closed it. Only on `assessed`; never Price-derived. */
    exitMechanism: text('exit_mechanism'),
    /** Q3 — the trader-chosen basis: `money` or `r`. The value exists in that basis only. */
    resultBasis: text('result_basis'),
    /** System Money, account-currency minor units, when the basis is `money`. */
    systemResultMinor: bigint('system_result_minor', { mode: 'bigint' }),
    /** The trader-entered System R, when the basis is `r`. */
    systemResultR: numeric('system_result_r', { precision: 12, scale: 4 }),
    /** `net` (net / comparable) or `gross_only`. Required on `assessed`; never inferred. */
    resultComparability: text('result_comparability'),
    /**
     * Which explicit helper filled the confirmed value, if the value is still
     * the helper's fill: `initial_sl` (−1R, or −Risk at Entry) or `target`
     * (Target Profit, or Target Profit ÷ Risk at Entry). Staleness provenance
     * only — a helper never confirms and never chooses Net / Gross.
     */
    resultHelper: text('result_helper'),
    /** Q5 — "Were these rules actually in place before entry?" A trader claim; NULL = Unanswered. */
    rulesInPlaceClaim: text('rules_in_place_claim'),

    dependencySnapshot: jsonb('dependency_snapshot').notNull(),

    /** 1 on first Confirm; +1 on each Update that replaces the finding or result. */
    revision: integer('revision').notNull().default(1),
    /** First Confirm. Never moves. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    /** Last Update (revision > 1). NULL until the first Update. */
    revisedAt: timestamp('revised_at', { withTimezone: true }),
    /** When `dependency_snapshot` was last taken — Confirm, Update or Reconfirm. */
    dependenciesConfirmedAt: timestamp('dependencies_confirmed_at', {
      withTimezone: true,
    }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('trade_system_assessments_workspace_idx').on(table.workspaceId),
    foreignKey({
      name: 'trade_system_assessments_contract_trade_fk',
      columns: [table.tradeId, table.workspaceId, table.recordingContract],
      foreignColumns: [trades.id, trades.workspaceId, trades.recordingContract],
    }).onDelete('cascade'),
    check(
      'trade_system_assessments_recording_contract_check',
      sql`${table.recordingContract} = 'add_trade_v1'`,
    ),
    check(
      'trade_system_assessments_finding_check',
      sql`${table.finding} IN ('assessed', 'no_trade', 'cannot_determine')`,
    ),
    check(
      'trade_system_assessments_exit_mechanism_check',
      sql`${table.exitMechanism} IS NULL OR ${table.exitMechanism} IN (
        'fixed_target', 'initial_sl', 'break_even_rule', 'trailing_exit',
        'time_session_exit', 'other_predefined_rule', 'allowed_discretion'
      )`,
    ),
    check(
      'trade_system_assessments_rules_in_place_claim_check',
      sql`${table.rulesInPlaceClaim} IS NULL OR ${table.rulesInPlaceClaim} IN ('yes', 'no', 'unknown')`,
    ),
    // No Trade and Cannot Determine are complete answers with no result; an
    // assessed finding holds exactly one value, in its chosen basis, and says
    // whether it is net / comparable.
    check(
      'trade_system_assessments_result_shape_check',
      sql`(
        ${table.finding} IN ('no_trade', 'cannot_determine')
        AND ${table.exitMechanism} IS NULL
        AND ${table.resultBasis} IS NULL
        AND ${table.systemResultMinor} IS NULL
        AND ${table.systemResultR} IS NULL
        AND ${table.resultComparability} IS NULL
        AND ${table.resultHelper} IS NULL
      ) OR (
        ${table.finding} = 'assessed'
        AND ${table.resultComparability} IS NOT NULL
        AND ${table.resultComparability} IN ('net', 'gross_only')
        AND (
          (
            ${table.resultBasis} IS NOT DISTINCT FROM 'money'
            AND ${table.systemResultMinor} IS NOT NULL
            AND ${table.systemResultR} IS NULL
          ) OR (
            ${table.resultBasis} IS NOT DISTINCT FROM 'r'
            AND ${table.systemResultR} IS NOT NULL
            AND ${table.systemResultMinor} IS NULL
          )
        )
      )`,
    ),
    // A helper belongs to its mechanism and still holds its own fill: −1R or a
    // negative amount for Initial SL; a positive Target Profit (or its R) for
    // Target. The exact −Risk at Entry and Target Profit amounts are Capture
    // values, checked by the service that fills them.
    check(
      'trade_system_assessments_result_helper_check',
      sql`${table.resultHelper} IS NULL OR (
        ${table.resultHelper} = 'initial_sl'
        AND ${table.exitMechanism} IS NOT DISTINCT FROM 'initial_sl'
        AND (
          (${table.resultBasis} IS NOT DISTINCT FROM 'r' AND ${table.systemResultR} IS NOT DISTINCT FROM -1)
          OR (${table.resultBasis} IS NOT DISTINCT FROM 'money' AND ${table.systemResultMinor} IS NOT NULL AND ${table.systemResultMinor} < 0)
        )
      ) OR (
        ${table.resultHelper} = 'target'
        AND ${table.exitMechanism} IS NOT DISTINCT FROM 'fixed_target'
        AND (
          (${table.resultBasis} IS NOT DISTINCT FROM 'r' AND ${table.systemResultR} IS NOT NULL AND ${table.systemResultR} > 0)
          OR (${table.resultBasis} IS NOT DISTINCT FROM 'money' AND ${table.systemResultMinor} IS NOT NULL AND ${table.systemResultMinor} > 0)
        )
      )`,
    ),
    check(
      'trade_system_assessments_dependency_snapshot_check',
      sql`jsonb_typeof(${table.dependencySnapshot}) = 'object'
        AND ${table.dependencySnapshot} @> '{"kind": "system_assessment_dependencies", "version": 2}'::jsonb`,
    ),
    check(
      'trade_system_assessments_revision_check',
      sql`(
        ${table.revision} = 1 AND ${table.revisedAt} IS NULL
      ) OR (
        ${table.revision} > 1
        AND ${table.revisedAt} IS NOT NULL
        AND ${table.revisedAt} >= ${table.confirmedAt}
      )`,
    ),
    check(
      'trade_system_assessments_dependencies_confirmed_at_check',
      sql`${table.dependenciesConfirmedAt} >= ${table.confirmedAt}`,
    ),
  ],
);
