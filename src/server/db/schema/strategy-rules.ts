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
import { strategySetupVersions } from './strategy-setup-versions';
import { workspaces } from './workspaces';

/**
 * Structured, versioned rule content — the hybrid model recommended in the
 * Phase 06A audit: a stable `rule_key` per logical rule so a future trade
 * can snapshot whether it was followed (CLAUDE.md §6's discipline scoring
 * needs a stable identifier per rule, not a text match), while `title`/
 * `description` carry the actual free-form content. No severity weight or
 * penalty value lives here — that is Phase 07/08's job.
 *
 * `setup_version_id` is null for a Strategy-general rule, non-null for a
 * rule scoped to one Setup snapshot within the same Version — enforced by
 * the `_setup_version_strategy_version_fk` composite FK, which pins a
 * present `setup_version_id` to the *same* `strategy_version_id` this row
 * declares, so a Rule can never reference a Setup snapshot from a different
 * Version.
 *
 * `rule_key` (not `id`) is the identity that survives copy-on-write: a new
 * Version's copied rule keeps the same `rule_key` in a new row with a new
 * `id`, so a future "was this rule followed" check can ask "the rule with
 * this key, in the version this trade was pinned to" and get a stable
 * answer across edits. `id` identifies one immutable row for one Version.
 */
export const strategyRules = pgTable(
  'strategy_rules',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid('strategy_version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    setupVersionId: uuid('setup_version_id').references(() => strategySetupVersions.id, {
      onDelete: 'cascade',
    }),
    /** Stable across copy-on-write versions — see the module comment. Newly generated per logical rule, never per row. */
    ruleKey: uuid('rule_key').notNull().$defaultFn(generateId),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(true),
    isPreTradeCheck: boolean('is_pre_trade_check').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('strategy_rules_version_rule_key_idx').on(table.strategyVersionId, table.ruleKey),
    index('strategy_rules_version_sort_idx').on(table.strategyVersionId, table.sortOrder),
    index('strategy_rules_setup_version_idx').on(table.setupVersionId),
    // Composite-FK plumbing added in Phase 07B — lets `trade_rule_checks`
    // prove all three of (exact Rule row, its Version, its rule_key) are
    // mutually consistent with a single FK, rather than trusting the caller
    // to keep `strategy_rule_id` and `rule_key` in agreement. `id` alone is
    // already unique; this wider index is still trivially valid.
    uniqueIndex('strategy_rules_id_version_rule_key_idx').on(
      table.id,
      table.strategyVersionId,
      table.ruleKey,
    ),
    foreignKey({
      name: 'strategy_rules_version_workspace_fk',
      columns: [table.strategyVersionId, table.workspaceId],
      foreignColumns: [strategyVersions.id, strategyVersions.workspaceId],
    }),
    foreignKey({
      name: 'strategy_rules_setup_version_strategy_version_fk',
      columns: [table.setupVersionId, table.strategyVersionId],
      foreignColumns: [strategySetupVersions.id, strategySetupVersions.strategyVersionId],
    }),
    check(
      'strategy_rules_category_check',
      sql`${table.category} IN ('entry', 'invalidation', 'risk', 'management', 'exit')`,
    ),
    check('strategy_rules_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('strategy_rules_title_not_blank_check', sql`btrim(${table.title}) <> ''`),
  ],
);
