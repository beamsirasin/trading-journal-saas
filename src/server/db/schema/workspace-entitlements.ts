import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { workspaces } from './workspaces';

/**
 * Phase 3C's entitlement record — the one authoritative source for "is this
 * workspace trialing, active, expired or canceled, and under which plan."
 * `src/server/services/entitlement.ts` is the only writer; no public server
 * action mutates `status`, `plan_key`, `trial_started_at`, `trial_ends_at` or
 * `current_period_ends_at` — those are owned by onboarding-completion (trial
 * start) today and a future verified billing webhook (Phase 04+).
 *
 * At most one row per workspace: the unique index below is the actual
 * concurrency guarantee (same technique as `workspaces_personal_owner_idx`),
 * not the `INSERT ... ON CONFLICT DO NOTHING` call sites that rely on it.
 *
 * `status`/`plan_key` are `text` + CHECK, not Postgres enums — the same
 * migration-cost reasoning as `workspaces.kind` and `trading_accounts.
 * account_mode`.
 *
 * No payment-provider identifiers (customer ID, subscription ID, …) exist
 * here yet — this phase has no payment provider integrated. Add them only
 * when a real provider is wired in, not speculatively.
 */
export const workspaceEntitlements = pgTable(
  'workspace_entitlements',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    /** `null` until the workspace ever selects a paid plan — a trial has no plan key yet. */
    planKey: text('plan_key'),
    /** `null` for a workspace whose trial has not yet started (onboarding incomplete). */
    trialStartedAt: timestamp('trial_started_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    /** `null` until a real billing period exists (Phase 04+). */
    currentPeriodEndsAt: timestamp('current_period_ends_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_entitlements_workspace_idx').on(table.workspaceId),
    check(
      'workspace_entitlements_status_check',
      sql`${table.status} IN ('trialing', 'active', 'expired', 'canceled')`,
    ),
    check(
      'workspace_entitlements_plan_key_check',
      sql`${table.planKey} IS NULL OR ${table.planKey} IN ('starter', 'pro', 'elite')`,
    ),
  ],
);
