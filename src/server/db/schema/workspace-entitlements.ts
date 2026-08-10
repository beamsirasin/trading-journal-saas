import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { workspaces } from './workspaces';

/**
 * The one authoritative source for a workspace's trial, paid-plan, and
 * subscription timing state. Phase 04C only defines the storage boundary;
 * onboarding remains the sole current writer and later trusted billing code
 * will own lifecycle transitions.
 *
 * At most one row per workspace: the unique index below is the actual
 * concurrency guarantee (same technique as `workspaces_personal_owner_idx`),
 * not the `INSERT ... ON CONFLICT DO NOTHING` call sites that rely on it.
 *
 * `status`/`plan_key` are `text` + CHECK, not Postgres enums — the same
 * migration-cost reasoning as `workspaces.kind` and `trading_accounts.
 * account_mode`.
 *
 * Billing and provider fields are nullable so pre-billing historical rows
 * remain truthful. Their presence does not imply a provider integration.
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
    /**
     * Truthful entitlement provenance — added Phase 11B. NOT called
     * `payment_source`: `trial` and `complimentary` are not payments.
     * `startTrialInTx` (`src/server/services/entitlement.ts`) always sets
     * `'trial'` explicitly on insert; `activatePaidSubscriptionInTransaction`
     * (`src/server/services/subscription-lifecycle.ts`) always sets `'paid'`
     * explicitly on its trial/expired/canceled -> active transition — the
     * only two writers, so this column is fully deterministic, never
     * inferred from profit or guessed. `'complimentary'` is reserved for a
     * future Phase 11E admin grant; nothing in Phase 11B ever writes it.
     * Cancellation/expiry never resets this — provenance survives the
     * lifecycle that followed it. The `.default('trial')` exists ONLY so
     * the many existing test fixtures across the Phase 04-10 suites that
     * insert this table directly (bypassing the service layer) keep
     * compiling unchanged; every real application write path sets this
     * column explicitly rather than relying on the default.
     */
    source: text('source').notNull().default('trial'),
    /** `null` for a workspace whose trial has not yet started (onboarding incomplete). */
    trialStartedAt: timestamp('trial_started_at', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    currentPeriodStartedAt: timestamp('current_period_started_at', { withTimezone: true }),
    currentPeriodEndsAt: timestamp('current_period_ends_at', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    billingCurrency: text('billing_currency'),
    billingInterval: text('billing_interval'),
    pendingPlanKey: text('pending_plan_key'),
    pendingPlanEffectiveAt: timestamp('pending_plan_effective_at', { withTimezone: true }),
    providerKind: text('provider_kind'),
    providerCustomerId: text('provider_customer_id'),
    providerSubscriptionId: text('provider_subscription_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workspace_entitlements_workspace_idx').on(table.workspaceId),
    check(
      'workspace_entitlements_status_check',
      sql`${table.status} IN ('trialing', 'active', 'past_due', 'expired', 'canceled')`,
    ),
    // `starter`/`trader`/`professional` — the locked plan registry
    // (`src/config/plans.ts`). Migration 0004 renamed the earlier draft
    // keys (`pro`->`trader`, `elite`->`professional`) and replaced this
    // constraint; see that migration for the reconciliation.
    check(
      'workspace_entitlements_plan_key_check',
      sql`${table.planKey} IS NULL OR ${table.planKey} IN ('starter', 'trader', 'professional')`,
    ),
    check(
      'workspace_entitlements_billing_currency_check',
      sql`${table.billingCurrency} IS NULL OR ${table.billingCurrency} IN ('THB', 'USD')`,
    ),
    check(
      'workspace_entitlements_billing_interval_check',
      sql`${table.billingInterval} IS NULL OR ${table.billingInterval} = 'monthly'`,
    ),
    check(
      'workspace_entitlements_pending_plan_key_check',
      sql`${table.pendingPlanKey} IS NULL OR ${table.pendingPlanKey} IN ('starter', 'trader', 'professional')`,
    ),
    check(
      'workspace_entitlements_period_order_check',
      sql`${table.currentPeriodStartedAt} IS NULL OR ${table.currentPeriodEndsAt} IS NULL OR ${table.currentPeriodStartedAt} <= ${table.currentPeriodEndsAt}`,
    ),
    check(
      'workspace_entitlements_cancel_period_check',
      sql`NOT ${table.cancelAtPeriodEnd} OR ${table.currentPeriodEndsAt} IS NOT NULL`,
    ),
    check(
      'workspace_entitlements_pending_plan_pair_check',
      sql`(${table.pendingPlanKey} IS NULL AND ${table.pendingPlanEffectiveAt} IS NULL) OR (${table.pendingPlanKey} IS NOT NULL AND ${table.pendingPlanEffectiveAt} IS NOT NULL)`,
    ),
    check(
      'workspace_entitlements_source_check',
      sql`${table.source} IN ('trial', 'paid', 'complimentary')`,
    ),
  ],
);
