import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { tradingAccounts } from './trading-accounts';
import { workspaces } from './workspaces';

/**
 * One row per user. `user_id` is both primary key and foreign key — a
 * preferences row cannot exist without a user, and a user has at most one.
 *
 * `locale`/`theme` CHECK constraints are the database half of validation;
 * the application half reuses the existing, already-tested sources of truth
 * rather than redeclaring them — `routing.locales` (`src/i18n/routing.ts`)
 * for locale, and the literal `next-themes` value set for theme. Widening
 * either set is a migration, which is the point: an invalid value should
 * never be representable, not merely rejected by a form.
 *
 * `timezone` has no CHECK constraint (Postgres CHECK cannot call
 * `Intl.supportedValuesOf`), so it is validated at the application boundary
 * with `isValidTimeZone` (`src/lib/time/timezone.ts`) before every write —
 * see `src/server/services/workspace-provisioning.ts` and the preferences
 * update path.
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeWorkspaceId: uuid('active_workspace_id').references(() => workspaces.id, {
      onDelete: 'set null',
    }),
    /**
     * The real FK only guarantees "this row references *some* existing,
     * non-deleted trading account" — it cannot express "...that belongs to
     * this user's CURRENT active workspace," a cross-table condition FKs
     * cannot encode. That check is an application-level authoritative
     * boundary: `src/server/auth/dal.ts`'s active-trading-account resolution
     * re-validates workspace ownership and non-archived status on every
     * read, and repairs (clears) a stale/invalid reference rather than
     * trusting it — the same "verify, don't just reference" posture
     * `getActiveWorkspaceContext` already takes for `activeWorkspaceId`.
     */
    activeTradingAccountId: uuid('active_trading_account_id').references(() => tradingAccounts.id, {
      onDelete: 'set null',
    }),
    locale: text('locale').notNull().default('en'),
    theme: text('theme').notNull().default('system'),
    timezone: text('timezone').notNull().default('UTC'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('user_preferences_locale_check', sql`${table.locale} IN ('en', 'th')`),
    check('user_preferences_theme_check', sql`${table.theme} IN ('light', 'dark', 'system')`),
  ],
);
