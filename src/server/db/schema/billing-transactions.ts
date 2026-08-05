import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
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
 * One immutable commercial snapshot per billing attempt. Phase 04B remains
 * the calculation source; this table stores its exact bigint quote so later
 * price-book or VAT changes cannot rewrite history.
 *
 * A forward migration installs a PostgreSQL trigger that protects the
 * commercial fields after insert while permitting trusted processing code to
 * update provider references, status, failure details, and lifecycle times.
 */
export const billingTransactions = pgTable(
  'billing_transactions',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    planKey: text('plan_key').notNull(),
    billingCurrency: text('billing_currency').notNull(),
    billingInterval: text('billing_interval').notNull(),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    vatEnabled: boolean('vat_enabled').notNull(),
    appliedVatRateBasisPoints: integer('applied_vat_rate_basis_points').notNull(),
    vatAmountMinor: bigint('vat_amount_minor', { mode: 'bigint' }).notNull(),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    taxMode: text('tax_mode').notNull(),
    taxJurisdiction: text('tax_jurisdiction'),
    vatRegistrationNumber: text('vat_registration_number'),
    providerKind: text('provider_kind'),
    providerCheckoutId: text('provider_checkout_id'),
    providerPaymentId: text('provider_payment_id'),
    status: text('status').notNull().default('created'),
    failureCode: text('failure_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (table) => [
    index('billing_transactions_workspace_created_idx').on(table.workspaceId, table.createdAt),
    uniqueIndex('billing_transactions_workspace_idempotency_idx').on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex('billing_transactions_provider_checkout_idx')
      .on(table.providerCheckoutId)
      .where(sql`${table.providerCheckoutId} IS NOT NULL`),
    uniqueIndex('billing_transactions_provider_payment_idx')
      .on(table.providerPaymentId)
      .where(sql`${table.providerPaymentId} IS NOT NULL`),
    check(
      'billing_transactions_plan_key_check',
      sql`${table.planKey} IN ('starter', 'trader', 'professional')`,
    ),
    check(
      'billing_transactions_billing_currency_check',
      sql`${table.billingCurrency} IN ('THB', 'USD')`,
    ),
    check('billing_transactions_billing_interval_check', sql`${table.billingInterval} = 'monthly'`),
    check(
      'billing_transactions_status_check',
      sql`${table.status} IN ('created', 'pending', 'processing', 'succeeded', 'failed', 'canceled')`,
    ),
    check('billing_transactions_subtotal_check', sql`${table.subtotalMinor} >= 0`),
    check('billing_transactions_vat_amount_check', sql`${table.vatAmountMinor} >= 0`),
    check('billing_transactions_total_check', sql`${table.totalMinor} >= 0`),
    check(
      'billing_transactions_vat_rate_check',
      sql`${table.appliedVatRateBasisPoints} BETWEEN 0 AND 10000`,
    ),
    check(
      'billing_transactions_total_consistency_check',
      sql`${table.totalMinor} = ${table.subtotalMinor} + ${table.vatAmountMinor}`,
    ),
    check(
      'billing_transactions_vat_consistency_check',
      sql`(
        NOT ${table.vatEnabled}
        AND ${table.appliedVatRateBasisPoints} = 0
        AND ${table.vatAmountMinor} = 0
        AND ${table.taxMode} = 'disabled'
      ) OR (
        ${table.vatEnabled}
        AND ${table.taxMode} = 'exclusive'
      )`,
    ),
  ],
);
