import {
  boolean,
  foreignKey,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { strategies } from './strategies';
import { workspaces } from './workspaces';

/**
 * A Setup is a repeatable entry pattern inside a Strategy — it cannot exist
 * without one (`strategy_id` is required, no orphan Setup). Like
 * `strategies`, this is an identity row only: the current name/description a
 * user sees lives on `strategy_setup_versions`, snapshotted per strategy
 * version, not here.
 *
 * Archiving a Strategy never writes to this table — `is_archived` here is an
 * independent lifecycle flag. Effective availability for new use is the
 * conjunction `strategies.is_archived = false AND setups.is_archived =
 * false`, computed by a future service/query, not stored redundantly.
 */
export const setups = pgTable(
  'setups',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    isArchived: boolean('is_archived').notNull().default(false),
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('setups_strategy_idx').on(table.strategyId),
    index('setups_workspace_archived_idx').on(table.workspaceId, table.isArchived),
    uniqueIndex('setups_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    // Composite-FK plumbing for `strategy_setup_versions`, which must prove
    // the Setup it snapshots belongs to the same Strategy as the Version.
    uniqueIndex('setups_id_strategy_idx').on(table.id, table.strategyId),
    foreignKey({
      name: 'setups_strategy_workspace_fk',
      columns: [table.strategyId, table.workspaceId],
      foreignColumns: [strategies.id, strategies.workspaceId],
    }),
  ],
);
