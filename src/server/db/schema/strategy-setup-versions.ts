import { sql } from 'drizzle-orm';
import {
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

import { setups } from './setups';
import { strategies, strategyVersions } from './strategies';
import { workspaces } from './workspaces';

/**
 * Snapshots a Setup's name/description as they existed inside one Strategy
 * Version — the historical content a future Trade will actually reference,
 * so a later rename of the Setup (a new version's snapshot) never rewrites
 * what a past trade meant. `setup_id` identifies *which* Setup this is a
 * snapshot of; `strategy_version_id` identifies *when*.
 *
 * The two composite FKs below (`_version_strategy_fk`, `_setup_strategy_fk`)
 * both pin against this row's own `strategy_id` column, which is what
 * transitively forces the Setup and the Strategy Version to belong to the
 * *same* Strategy — the database rejects any row that would combine a Setup
 * and a Version from different Strategies, without needing a direct FK
 * between `setups` and `strategy_versions`.
 *
 * Once locked (via its parent version's `locked_at`), rows here become
 * immutable — enforced by a migration-installed trigger, not by TypeScript.
 */
export const strategySetupVersions = pgTable(
  'strategy_setup_versions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    strategyVersionId: uuid('strategy_version_id')
      .notNull()
      .references(() => strategyVersions.id, { onDelete: 'cascade' }),
    setupId: uuid('setup_id')
      .notNull()
      .references(() => setups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('strategy_setup_versions_version_setup_idx').on(
      table.strategyVersionId,
      table.setupId,
    ),
    index('strategy_setup_versions_version_sort_idx').on(table.strategyVersionId, table.sortOrder),
    // Composite-FK plumbing for `strategy_rules`, which must prove a Rule
    // scoped to a Setup snapshot belongs to the same Strategy Version.
    uniqueIndex('strategy_setup_versions_id_version_idx').on(table.id, table.strategyVersionId),
    // Composite-FK plumbing added in Phase 07B — lets `trades` prove its
    // `setup_version_id` is genuinely a snapshot *of* its own `setup_id`, not
    // merely some other Setup's snapshot within the same Strategy Version
    // (which the Version-level FK alone cannot distinguish). `id` alone is
    // already unique; this pair is too.
    uniqueIndex('strategy_setup_versions_id_setup_idx').on(table.id, table.setupId),
    foreignKey({
      name: 'strategy_setup_versions_version_strategy_fk',
      columns: [table.strategyVersionId, table.strategyId],
      foreignColumns: [strategyVersions.id, strategyVersions.strategyId],
    }),
    foreignKey({
      name: 'strategy_setup_versions_setup_strategy_fk',
      columns: [table.setupId, table.strategyId],
      foreignColumns: [setups.id, setups.strategyId],
    }),
    foreignKey({
      name: 'strategy_setup_versions_version_workspace_fk',
      columns: [table.strategyVersionId, table.workspaceId],
      foreignColumns: [strategyVersions.id, strategyVersions.workspaceId],
    }),
    check('strategy_setup_versions_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('strategy_setup_versions_name_not_blank_check', sql`btrim(${table.name}) <> ''`),
  ],
);
