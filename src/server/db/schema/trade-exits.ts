import { sql } from 'drizzle-orm';
import {
  bigint,
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

import { generateId } from '@/lib/identifiers';

import { trades } from './trades';
import { workspaces } from './workspaces';

/** Authoritative realized Exit legs for one Trade/position. */
export const tradeExits = pgTable(
  'trade_exits',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    sequence: smallint('sequence').notNull(),
    closedBps: integer('closed_bps').notNull(),
    exitPrice: numeric('exit_price', { precision: 20, scale: 10 }),
    realizedPnlMinor: bigint('realized_pnl_minor', { mode: 'bigint' }),
    exitReason: text('exit_reason'),
    exitedAt: timestamp('exited_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_exits_trade_sequence_idx').on(table.tradeId, table.sequence),
    uniqueIndex('trade_exits_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    index('trade_exits_workspace_trade_idx').on(table.workspaceId, table.tradeId),
    foreignKey({
      name: 'trade_exits_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
    check('trade_exits_sequence_check', sql`${table.sequence} > 0`),
    check(
      'trade_exits_closed_bps_check',
      sql`${table.closedBps} > 0 AND ${table.closedBps} <= 10000`,
    ),
    check(
      'trade_exits_result_present_check',
      sql`${table.exitPrice} IS NOT NULL OR ${table.realizedPnlMinor} IS NOT NULL`,
    ),
    check(
      'trade_exits_reason_not_blank_check',
      sql`${table.exitReason} IS NULL OR btrim(${table.exitReason}) <> ''`,
    ),
  ],
);
