import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { strategies } from './strategies';
import { workspaces } from './workspaces';

/**
 * SAVED EXIT PLANS — a small reusable library (Add Trade contract §5).
 *
 * A plan is a name and instructions. A plan may nominate one Strategy it is the
 * DEFAULT for, which is what lets At Entry visibly inherit it; at most one
 * active default exists per Strategy (`exit_plans_strategy_default_idx`).
 *
 * A Trade never points at a live plan for its meaning: `trades` snapshots the
 * plan's name and instructions when it is adopted, so a plan edited or archived
 * later never rewrites what an earlier Trade says its plan was. `exit_plan_id`
 * on `trades` is provenance only and falls back to NULL if a plan row is ever
 * removed. Plans are archived, never hard-deleted, by application code.
 */
export const exitPlans = pgTable(
  'exit_plans',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** The Strategy this plan is the default exit plan for, when it is one. */
    strategyId: uuid('strategy_id'),
    name: text('name').notNull(),
    instructions: text('instructions').notNull(),
    isArchived: boolean('is_archived').notNull().default(false),
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('exit_plans_workspace_idx').on(table.workspaceId),
    uniqueIndex('exit_plans_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    uniqueIndex('exit_plans_id_workspace_idx').on(table.id, table.workspaceId),
    uniqueIndex('exit_plans_strategy_default_idx')
      .on(table.strategyId)
      .where(sql`${table.strategyId} IS NOT NULL AND ${table.isArchived} = false`),
    foreignKey({
      name: 'exit_plans_strategy_workspace_fk',
      columns: [table.strategyId, table.workspaceId],
      foreignColumns: [strategies.id, strategies.workspaceId],
    }).onDelete('cascade'),
    check('exit_plans_name_not_blank_check', sql`btrim(${table.name}) <> ''`),
    check('exit_plans_instructions_not_blank_check', sql`btrim(${table.instructions}) <> ''`),
  ],
);
