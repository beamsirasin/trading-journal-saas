import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { workspaces } from './workspaces';

/**
 * The mistake taxonomy a Trade's discipline data draws from. `workspace_id`
 * is nullable — the nine canonical system types
 * (`drizzle/0008_trade_domain_and_discipline.sql`'s seed) are shared,
 * platform-owned reference rows with `workspace_id = NULL`, never tenant
 * data; workspace-defined custom types (a later phase's UI, not built in
 * Phase 07B) are tenant-owned with a real `workspace_id`.
 * `mistake_types_tenancy_check` enforces `workspace_id IS NULL <=>
 * is_system = true` — a custom type can never masquerade as shared, and a
 * system type can never be miscategorized as belonging to one workspace.
 *
 * `default_weight` is the CURRENT default weight for this mistake type. For
 * the nine seeded system rows, Phase 07 MVP deliberately uses one neutral
 * value (`'1.0000'`, `severity = 'moderate'`) rather than an unjustified,
 * evidence-free differentiation — see `src/config/mistakes.ts`'s
 * `CANONICAL_SYSTEM_MISTAKE_TYPES` comment. `MISTAKE_SEVERITY_WEIGHTS` there
 * is a separate, general severity -> weight framework, reserved for a later
 * phase's differentiated weighting. Editing `default_weight` here later must
 * never rewrite history; `trade_mistakes.weight_at_time`/`severity_at_time`
 * are the actual snapshot a past Trade's discipline score is computed from.
 *
 * Archive-only lifecycle (`is_archived`), matching every other tenant-owned
 * table's convention — no `deleted_at`, no hard-delete flow, none planned.
 * A system row's `is_archived` is not expected to ever be set (no admin UI
 * exists yet to do so), but the column exists uniformly rather than being
 * conditionally present.
 */
export const mistakeTypes = pgTable(
  'mistake_types',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    severity: text('severity').notNull(),
    /**
     * `NUMERIC(12,4)` — the CLAUDE.md §5 "R-multiples and ratios" precision,
     * not an arbitrary money-adjacent scale. `perTradePenalty = min(1,
     * Σ severityWeight(mistake))` (CLAUDE.md §6) is itself an R-adjacent
     * ratio computation, so this column follows that convention rather than
     * a narrower one. Read back as a string, never a JS `number`.
     */
    defaultWeight: numeric('default_weight', { precision: 12, scale: 4 }).notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isArchived: boolean('is_archived').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mistake_types_workspace_archived_idx').on(table.workspaceId, table.isArchived),
    // Partial uniqueness: system keys (`workspace_id IS NULL`) are globally
    // unique; custom keys are unique per workspace only. A plain
    // `UNIQUE(workspace_id, key)` cannot express this — Postgres treats every
    // NULL `workspace_id` as distinct from every other, so it would never
    // catch two system rows accidentally sharing a `key`.
    uniqueIndex('mistake_types_system_key_idx')
      .on(table.key)
      .where(sql`${table.isSystem}`),
    uniqueIndex('mistake_types_workspace_key_idx')
      .on(table.workspaceId, table.key)
      .where(sql`NOT ${table.isSystem}`),
    check(
      'mistake_types_severity_check',
      sql`${table.severity} IN ('minor', 'moderate', 'severe')`,
    ),
    check('mistake_types_default_weight_check', sql`${table.defaultWeight} >= 0`),
    check('mistake_types_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('mistake_types_key_not_blank_check', sql`btrim(${table.key}) <> ''`),
    check('mistake_types_label_not_blank_check', sql`btrim(${table.label}) <> ''`),
    check(
      'mistake_types_tenancy_check',
      sql`(${table.isSystem} AND ${table.workspaceId} IS NULL) OR (NOT ${table.isSystem} AND ${table.workspaceId} IS NOT NULL)`,
    ),
  ],
);
