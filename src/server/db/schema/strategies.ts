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

import { workspaces } from './workspaces';

/**
 * Phase 06B's first tenant-owned business tables. `strategies` and
 * `strategy_versions` are mutually referential — a strategy points at its
 * current version, and a version points back at its owning strategy — so
 * they live in one file and one migration, exactly like `workspaces`/
 * `workspace_members` (`workspaces.ts`).
 *
 * `strategies` is deliberately an identity row only: no name, description,
 * timeframe, instrument, or rules column belongs here. All display content
 * — including the current name a user sees — lives on `strategy_versions`
 * and is reached through `current_version_id`. This is what makes immutable
 * versioning possible: the identity a trade will eventually reference never
 * changes shape, only which version is "current" changes.
 *
 * `current_version_id` is nullable at the database level because a Strategy
 * and its first Version are created atomically by a future service (Phase
 * 06C) — the identity row must exist first (to get an id for the version's
 * `strategy_id`) before a version can be inserted, so there is a brief
 * window, even inside one transaction, where no current version exists yet.
 */
export const strategies = pgTable(
  'strategies',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * A composite FK (`strategies_current_version_strategy_fk`, hand-authored
     * SQL in the forward migration — see its comment) pins this to a
     * `strategy_versions` row whose `strategy_id` equals this row's own `id`,
     * so a version can never become "current" for a strategy it does not
     * belong to. It cannot be expressed in this file: `strategies` and
     * `strategy_versions` are mutually referential, and TypeScript cannot
     * resolve the circular type this composite FK's `foreignColumns` would
     * create (unlike Drizzle's runtime, which defers `extraConfig` callbacks
     * until the whole module has loaded and so has no such problem). NULL is
     * exempt from FK checking (Postgres `MATCH SIMPLE`), which is exactly the
     * atomic-creation window described above.
     */
    currentVersionId: uuid('current_version_id'),
    isArchived: boolean('is_archived').notNull().default(false),
    /** Create-idempotency, identical pattern to `trading_accounts.mutation_key`. */
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('strategies_workspace_idx').on(table.workspaceId),
    index('strategies_workspace_archived_idx').on(table.workspaceId, table.isArchived),
    uniqueIndex('strategies_workspace_mutation_key_idx').on(table.workspaceId, table.mutationKey),
    // Composite-FK plumbing only — lets `strategy_versions` and other
    // children prove "this row belongs to the same workspace as its parent
    // strategy" via a database-enforced relationship instead of trusting
    // application code. `id` alone is already unique; this pair is too.
    uniqueIndex('strategies_id_workspace_idx').on(table.id, table.workspaceId),
    // `strategies_current_version_strategy_fk` (current_version_id -> a
    // strategy_versions row belonging to this same strategy) is hand-authored
    // SQL in the forward migration — see the comment on `currentVersionId`
    // above for why it cannot live here.
  ],
);

/**
 * One immutable-once-locked snapshot of a strategy's content. `locked_at`
 * transitions null -> non-null exactly once, enforced by a trigger installed
 * in the forward migration (Drizzle has no DDL for triggers/functions) —
 * TypeScript `readonly` is not database immutability, so the guarantee lives
 * here, not in application code. Phase 08 sets `locked_at` the moment the
 * first trade references a version; Phase 06B only builds the protection.
 *
 * Structured rules (`strategy_rules`) and setup snapshots
 * (`strategy_setup_versions`) reference a version by `id`, not by number, so
 * a locked version's full historical shape — including its rules and its
 * setups' names at the time — never mutates retroactively.
 */
export const strategyVersions = pgTable(
  'strategy_versions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    strategyId: uuid('strategy_id')
      .notNull()
      .references(() => strategies.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    notes: text('notes'),
    /** Required by convention when superseding a locked version — not DB-enforced (a future service's job), since an unlocked first version legitimately has none. */
    changeNote: text('change_note'),
    /** Null = unlocked (editable in place). Non-null = permanently locked; see the migration's protection trigger. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('strategy_versions_workspace_strategy_idx').on(table.workspaceId, table.strategyId),
    uniqueIndex('strategy_versions_strategy_version_number_idx').on(
      table.strategyId,
      table.versionNumber,
    ),
    // Composite-FK plumbing for `strategies.current_version_id` (above) and
    // for children (`strategy_setup_versions`, `strategy_rules`) that must
    // prove they reference a version belonging to the expected strategy.
    uniqueIndex('strategy_versions_id_strategy_idx').on(table.id, table.strategyId),
    // Composite-FK plumbing for children that must prove workspace
    // consistency against the version they reference.
    uniqueIndex('strategy_versions_id_workspace_idx').on(table.id, table.workspaceId),
    foreignKey({
      name: 'strategy_versions_strategy_workspace_fk',
      columns: [table.strategyId, table.workspaceId],
      foreignColumns: [strategies.id, strategies.workspaceId],
    }),
    check('strategy_versions_version_number_check', sql`${table.versionNumber} > 0`),
    check('strategy_versions_name_not_blank_check', sql`btrim(${table.name}) <> ''`),
  ],
);
