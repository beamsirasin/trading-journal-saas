import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { platformAdmins } from './platform-admins';

/**
 * Narrow, typed, append-only VAT configuration — deliberately NOT a generic
 * `platform_settings` key/value table (CLAUDE.md's Phase 11 contract: only
 * VAT needs admin-owned persistence right now; a second setting promotes
 * this to a registry as its own reviewed decision, not speculatively).
 *
 * Each change INSERTS a new row rather than updating the previous one — the
 * same reasoning as `billing_transactions`' immutable snapshot, extended to
 * configuration: "effective config" is defined as the latest row with
 * `effective_at <= now()`, so a change is always effective-dated and always
 * trivially reversible (insert a row reverting the value) without ever
 * losing history of what the rate was at any prior instant. Migration 0009's
 * trigger enforces this at the database level, exactly like `admin_audit_
 * log`'s immutability trigger.
 *
 * `rate_basis_points` reuses the exact bounds `src/lib/billing/vat.ts`'s
 * `assertValidVatRateBasisPoints` already enforces in application code
 * (0 through 10000) — this CHECK is the database-level backstop for a row
 * inserted outside that code path (e.g. the migration's own baseline seed).
 *
 * Phase 11B creates this table and seeds one baseline row (migration 0009);
 * it does NOT wire checkout/quotation to read from it — `src/config/
 * billing.server.ts`'s `DEFAULT_VAT_CONFIGURATION` constant remains the
 * live source of truth until Phase 11F switches it over.
 */
export const platformVatConfiguration = pgTable(
  'platform_vat_configuration',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    enabled: boolean('enabled').notNull(),
    rateBasisPoints: integer('rate_basis_points').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    /** NULL for the migration-seeded baseline row (no platform-admin actor exists yet). */
    createdByAdminId: uuid('created_by_admin_id').references(() => platformAdmins.id, {
      onDelete: 'restrict',
    }),
    reasonCode: text('reason_code').notNull(),
    reasonNote: text('reason_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The "effective config as of now" lookup this table exists to serve —
    // narrow and justified by that one query, per Phase 11A's own
    // index-audit recommendation (no speculative indexes elsewhere).
    index('platform_vat_configuration_effective_idx').on(table.effectiveAt),
    check(
      'platform_vat_configuration_rate_check',
      sql`${table.rateBasisPoints} BETWEEN 0 AND 10000`,
    ),
    // Mirrors ADMIN_AUDIT_REASON_CODES (`src/config/admin-audit-actions.ts`)
    // — the same closed vocabulary as `admin_audit_log.reason_code`, not a
    // second parallel list.
    check(
      'platform_vat_configuration_reason_code_check',
      sql`${table.reasonCode} IN (
        'bootstrap',
        'access_grant',
        'access_revoke',
        'trial_extension_goodwill',
        'complimentary_access',
        'support_adjustment',
        'configuration_change',
        'other'
      )`,
    ),
    check(
      'platform_vat_configuration_reason_note_length_check',
      sql`${table.reasonNote} IS NULL OR char_length(${table.reasonNote}) <= 500`,
    ),
  ],
);
