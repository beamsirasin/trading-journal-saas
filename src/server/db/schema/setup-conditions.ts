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
import { strategySetupVersions } from './strategy-setup-versions';
import { workspaces } from './workspaces';

/**
 * Version-owned Setup checklist content. `id` identifies one immutable row
 * in one Setup Version; `condition_key` is the logical identity that survives
 * Strategy copy-on-write. Labels are content, never identity.
 */
export const setupConditions = pgTable(
  'setup_conditions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    setupId: uuid('setup_id')
      .notNull()
      .references(() => setups.id, { onDelete: 'cascade' }),
    setupVersionId: uuid('setup_version_id')
      .notNull()
      .references(() => strategySetupVersions.id, { onDelete: 'cascade' }),
    conditionKey: uuid('condition_key').notNull().$defaultFn(generateId),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('setup_conditions_version_key_idx').on(table.setupVersionId, table.conditionKey),
    uniqueIndex('setup_conditions_id_version_key_workspace_idx').on(
      table.id,
      table.setupVersionId,
      table.conditionKey,
      table.workspaceId,
    ),
    index('setup_conditions_version_sort_idx').on(table.setupVersionId, table.sortOrder),
    index('setup_conditions_workspace_idx').on(table.workspaceId),
    foreignKey({
      name: 'setup_conditions_setup_version_setup_workspace_fk',
      columns: [table.setupVersionId, table.setupId, table.workspaceId],
      foreignColumns: [
        strategySetupVersions.id,
        strategySetupVersions.setupId,
        strategySetupVersions.workspaceId,
      ],
    }),
    check('setup_conditions_key_present_check', sql`${table.conditionKey} IS NOT NULL`),
    check('setup_conditions_label_not_blank_check', sql`btrim(${table.label}) <> ''`),
    check('setup_conditions_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);
