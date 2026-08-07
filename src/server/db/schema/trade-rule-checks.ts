import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { strategyVersions } from './strategies';
import { strategyRules } from './strategy-rules';
import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * Replaces the stale `trade_checklist_results(trade_id, checklist_item_id,
 * was_satisfied)` sketch the original Phase 07 documents carried — Phase 06
 * never built a separate "checklist item" entity; a Rule check attaches to
 * `strategy_rules` directly, using both identifiers Phase 06 already
 * established for exactly this purpose:
 *
 * - `strategy_rule_id` — the exact Rule row in the Strategy Version this
 *   Trade is pinned to, for a precise, unambiguous reference.
 * - `rule_key` — the stable identity that survives copy-on-write, for
 *   logical "was this same rule followed" analysis across Versions.
 *
 * `check_status` is a four-value enum, not a boolean `was_satisfied` — a
 * Rule may be genuinely inapplicable to a given Trade (`not_applicable`) or
 * simply never reviewed (`not_checked`), and a boolean cannot distinguish
 * either from `violated`.
 *
 * `title`/`category`/`is_required`/`is_pre_trade_check`/`sort_order` are
 * snapshotted from `strategy_rules` at check-save time, the same "a later
 * rename never rewrites what a past trade meant" pattern
 * `strategy_setup_versions` already established for Setup content — a
 * future discipline-analytics query never needs to join back into the
 * Strategy domain, and remains correct even after the live Rule is later
 * edited via copy-on-write or removed entirely.
 *
 * The composite foreign key against `strategy_rules(id, strategy_version_id,
 * rule_key)` (via `strategy_rules_id_version_rule_key_idx`, added in this
 * same migration) guarantees `strategy_rule_id`/`strategy_version_id`/
 * `rule_key` are mutually consistent with one real row — a client cannot
 * pair a valid `strategy_rule_id` with a mismatched `rule_key`. The second
 * composite foreign key against `trades(id, strategy_version_id)` guarantees
 * a Rule check can only ever reference the exact Strategy Version its own
 * Trade is pinned to, never a different one.
 */
export const tradeRuleChecks = pgTable(
  'trade_rule_checks',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    strategyRuleId: uuid('strategy_rule_id')
      .notNull()
      .references(() => strategyRules.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid('strategy_version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    ruleKey: uuid('rule_key').notNull(),
    checkStatus: text('check_status').notNull().default('not_checked'),
    /** Snapshotted from `strategy_rules` at save time — never read live. */
    title: text('title').notNull(),
    category: text('category').notNull(),
    isRequired: boolean('is_required').notNull(),
    isPreTradeCheck: boolean('is_pre_trade_check').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Prevents a duplicate check for the same logical rule on the same
    // Trade — the natural key this table represents.
    uniqueIndex('trade_rule_checks_trade_rule_key_idx').on(table.tradeId, table.ruleKey),
    index('trade_rule_checks_workspace_idx').on(table.workspaceId),
    index('trade_rule_checks_rule_key_idx').on(table.ruleKey),
    foreignKey({
      name: 'trade_rule_checks_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trade_rule_checks_trade_strategy_version_fk',
      columns: [table.tradeId, table.strategyVersionId],
      foreignColumns: [trades.id, trades.strategyVersionId],
    }),
    foreignKey({
      name: 'trade_rule_checks_rule_version_rule_key_fk',
      columns: [table.strategyRuleId, table.strategyVersionId, table.ruleKey],
      foreignColumns: [strategyRules.id, strategyRules.strategyVersionId, strategyRules.ruleKey],
    }),
    check(
      'trade_rule_checks_check_status_check',
      sql`${table.checkStatus} IN ('followed', 'violated', 'not_applicable', 'not_checked')`,
    ),
    check(
      'trade_rule_checks_category_check',
      sql`${table.category} IN ('entry', 'invalidation', 'risk', 'management', 'exit')`,
    ),
    check('trade_rule_checks_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('trade_rule_checks_title_not_blank_check', sql`btrim(${table.title}) <> ''`),
  ],
);
