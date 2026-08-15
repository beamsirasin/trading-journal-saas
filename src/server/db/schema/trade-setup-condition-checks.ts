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

import { setupConditions } from './setup-conditions';
import { strategySetupVersions } from './strategy-setup-versions';
import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * Immutable Entry Snapshot of explicit Setup Condition answers. Historical
 * rendering uses the snapshotted label/key/order, never live Setup content.
 */
export const tradeSetupConditionChecks = pgTable(
  'trade_setup_condition_checks',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    setupConditionId: uuid('setup_condition_id')
      .notNull()
      .references(() => setupConditions.id, { onDelete: 'cascade' }),
    setupVersionId: uuid('setup_version_id')
      .notNull()
      .references(() => strategySetupVersions.id, { onDelete: 'cascade' }),
    conditionKey: uuid('condition_key').notNull(),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull(),
    checkStatus: text('check_status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_setup_condition_checks_trade_key_idx').on(table.tradeId, table.conditionKey),
    index('trade_setup_condition_checks_workspace_idx').on(table.workspaceId),
    index('trade_setup_condition_checks_condition_key_idx').on(table.conditionKey),
    foreignKey({
      name: 'trade_setup_condition_checks_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'trade_setup_condition_checks_trade_setup_version_fk',
      columns: [table.tradeId, table.setupVersionId],
      foreignColumns: [trades.id, trades.setupVersionId],
    }),
    foreignKey({
      name: 'trade_setup_condition_checks_source_fk',
      columns: [
        table.setupConditionId,
        table.setupVersionId,
        table.conditionKey,
        table.workspaceId,
      ],
      foreignColumns: [
        setupConditions.id,
        setupConditions.setupVersionId,
        setupConditions.conditionKey,
        setupConditions.workspaceId,
      ],
    }),
    check(
      'trade_setup_condition_checks_status_check',
      sql`${table.checkStatus} IN ('met', 'not_met')`,
    ),
    check('trade_setup_condition_checks_label_not_blank_check', sql`btrim(${table.label}) <> ''`),
    check('trade_setup_condition_checks_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);
