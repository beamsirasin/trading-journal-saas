import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { users } from './auth';

/**
 * Workspaces are the tenancy boundary (CLAUDE.md §4). Every user-owned
 * business record from Phase 3 onward carries a `workspace_id`, resolved
 * server-side from session + membership — never from client input.
 *
 * `kind` is `text`, not a Postgres enum: the only value this phase writes is
 * `'personal'`, and the CHECK constraint below is a one-line migration to
 * widen later, versus an enum's `ALTER TYPE ... ADD VALUE` (which cannot run
 * inside the same transaction as other DDL in older Postgres and is easy to
 * get wrong). `docs/data-dictionary.md` records this as a deliberate choice,
 * not an oversight.
 *
 * The partial unique index is the actual guarantee the phase brief requires
 * — "a personal workspace must have a database-enforced uniqueness
 * guarantee so concurrent initialization cannot create multiple personal
 * workspaces for the same user." An application-level check-then-insert
 * cannot provide this under concurrency; a constraint can.
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    name: text('name').notNull(),
    /** Stable, public-safe identifier — not currently used in a URL, reserved for when one exists. */
    slug: text('slug').notNull(),
    kind: text('kind').notNull().default('personal'),
    /** Set only for kind = 'personal'. NULL for any future non-personal workspace kind. */
    personalOwnerUserId: text('personal_owner_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    /**
     * NULL until Phase 3A's onboarding transaction commits (first trading
     * account created + active-account preference persisted) —
     * `src/server/services/trading-account.ts`'s `completeOnboarding()` is
     * the only writer. Workspace-scoped, not user-scoped, per the phase
     * brief: onboarding is a property of the workspace's data, not of any
     * one member.
     */
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspaces_slug_idx').on(table.slug),
    uniqueIndex('workspaces_personal_owner_idx')
      .on(table.personalOwnerUserId)
      .where(sql`${table.kind} = 'personal'`),
    check('workspaces_kind_check', sql`${table.kind} IN ('personal')`),
  ],
);

/**
 * `role` is likewise `text` with a CHECK rather than an enum, for the same
 * migration-cost reason as `workspaces.kind`. Minimum viable set per the
 * phase brief: `owner` | `member`. No `admin` yet — added the day a feature
 * actually needs the distinction, not speculatively.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('owner'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_members_workspace_user_idx').on(table.workspaceId, table.userId),
    // Resolving "which workspaces does this session belong to" on every
    // authenticated request is the actual Phase 2 query pattern.
    index('workspace_members_user_id_idx').on(table.userId),
    check('workspace_members_role_check', sql`${table.role} IN ('owner', 'member')`),
    check('workspace_members_status_check', sql`${table.status} IN ('active')`),
  ],
);
