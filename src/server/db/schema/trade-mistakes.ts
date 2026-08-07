import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { mistakeTypes } from './mistake-types';
import { trades } from './trades';
import { workspaces } from './workspaces';

/**
 * Join table, primary key `(trade_id, mistake_type_id)` — a mistake either
 * applies to a Trade or it doesn't, once. `severity_at_time`/
 * `weight_at_time` snapshot `mistake_types.severity`/`default_weight` as
 * they stood when this row was saved, so a later taxonomy edit never
 * rewrites a historical discipline score
 * (`docs/data-dictionary.md`'s explicit requirement).
 *
 * `mistake_type_id` uses `ON DELETE RESTRICT`, not `CASCADE` — unlike an
 * ordinary tenant-owned reference, losing a `mistake_types` row out from
 * under historical `trade_mistakes` rows would silently corrupt discipline
 * history, the same reasoning `billing_transactions` applies to its own
 * workspace reference. In practice this is a defensive posture: no delete
 * flow for `mistake_types` exists (archive-only).
 *
 * Cross-workspace tenant isolation for a workspace-defined custom mistake
 * type cannot be expressed as a plain composite foreign key, because
 * `mistake_types.workspace_id` is NULL for shared system rows — an exact
 * `(mistake_type_id, workspace_id)` match would incorrectly reject every
 * reference to a system type. `drizzle/0008_trade_domain_and_discipline.sql`
 * installs a `BEFORE INSERT OR UPDATE` trigger
 * (`trade_mistakes_workspace_scope_check`) instead: it allows any reference
 * to a `workspace_id IS NULL` (system) row, and requires an exact workspace
 * match for any other (custom) row. Drizzle has no trigger DDL, so it is
 * hand-authored in the migration, the same posture Phase 06 already
 * established for version-lock protection.
 */
export const tradeMistakes = pgTable(
  'trade_mistakes',
  {
    tradeId: uuid('trade_id')
      .notNull()
      .references(() => trades.id, { onDelete: 'cascade' }),
    mistakeTypeId: uuid('mistake_type_id')
      .notNull()
      .references(() => mistakeTypes.id, { onDelete: 'restrict' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    note: text('note'),
    severityAtTime: text('severity_at_time').notNull(),
    /** `NUMERIC(12,4)`, matching `mistake_types.default_weight`'s own precision — see that column's comment. */
    weightAtTime: numeric('weight_at_time', { precision: 12, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tradeId, table.mistakeTypeId] }),
    index('trade_mistakes_workspace_idx').on(table.workspaceId),
    index('trade_mistakes_mistake_type_idx').on(table.mistakeTypeId),
    foreignKey({
      name: 'trade_mistakes_trade_workspace_fk',
      columns: [table.tradeId, table.workspaceId],
      foreignColumns: [trades.id, trades.workspaceId],
    }).onDelete('cascade'),
    check(
      'trade_mistakes_severity_at_time_check',
      sql`${table.severityAtTime} IN ('minor', 'moderate', 'severe')`,
    ),
    check('trade_mistakes_weight_at_time_check', sql`${table.weightAtTime} >= 0`),
  ],
);
