import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
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
 * Phase 3A's first tenant-owned business table. Every row carries
 * `workspace_id` (CLAUDE.md §4), resolved server-side from the caller's
 * active workspace membership — `src/server/services/trading-account.ts` is
 * the only writer, and it never accepts a workspace ID from client input.
 *
 * `account_mode` and `base_currency` are deliberately different shapes:
 *
 * - `account_mode` is a small, truly closed set (`live`/`demo`/`prop`/
 *   `backtest`) — `text` + CHECK, the same migration-cheap pattern as
 *   `workspaces.kind` and `workspace_members.role`.
 * - `base_currency` is NOT constrained to the closed, fiat-only
 *   `CurrencyCode` registry in `src/lib/money/currencies.ts` (that registry
 *   carries a per-currency minor-unit *scale* needed for exact minor-unit
 *   arithmetic, which crypto tickers like BTC/ETH/USDT don't have entries
 *   for here). Deliberately just `text`, validated at the Zod boundary
 *   (`src/lib/trading-accounts/validation.ts`) for shape only (uppercase,
 *   alphanumeric, bounded length) — future-compatible with any ticker,
 *   fiat or not, without a schema migration.
 *
 * `starting_balance`/`risk_per_trade_percent`/`maximum_daily_loss_percent`
 * are `NUMERIC`, read back as strings and validated with `decimal.js`
 * (CLAUDE.md §5's "instrument prices"/"R-multiples" convention) rather than
 * the `bigint` minor-units `Money` primitive — the same reason as above:
 * minor-unit conversion requires a known per-currency scale this account
 * model's currency field does not guarantee. No arithmetic is performed on
 * these values this phase; `starting_balance` is only ever the account's
 * opening reference figure (current balance is Phase 07+ ledger work).
 *
 * `onboarding_completed_at` lives on `workspaces`, not here — completing
 * onboarding does not depend on which specific account was created, only
 * that *a* first account and an active-account preference now exist.
 */
export const tradingAccounts = pgTable(
  'trading_accounts',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    brokerName: text('broker_name'),
    platformName: text('platform_name'),
    accountMode: text('account_mode').notNull(),
    baseCurrency: text('base_currency').notNull(),
    /**
     * Read back as a string by both `postgres.js` (default) and Drizzle
     * (`numeric()` without `mode: 'number'`) — never parsed to a JS `number`.
     * Precision 20/scale 10 matches the "instrument prices" convention
     * (CLAUDE.md §5) since a crypto starting balance can have many
     * significant fractional digits (e.g. BTC).
     */
    startingBalance: numeric('starting_balance', { precision: 20, scale: 10 }).notNull(),
    timezone: text('timezone').notNull(),
    /** NUMERIC(12,4) matches the "R-multiples and ratios" convention (CLAUDE.md §5) — this is a bounded percentage, not a monetary amount. */
    riskPerTradePercent: numeric('risk_per_trade_percent', { precision: 12, scale: 4 }),
    maximumDailyLossPercent: numeric('maximum_daily_loss_percent', { precision: 12, scale: 4 }),
    isArchived: boolean('is_archived').notNull().default(false),
    /**
     * Phase 3B's creation-idempotency boundary (`trading-account-management.ts`'s
     * `createTradingAccount`). The client generates one UUID per logical "create
     * this account" intent and resubmits the SAME value on a retry; the unique
     * index below is what actually makes a duplicate submission a no-op rather
     * than a second row — `INSERT ... ON CONFLICT DO NOTHING` on this column
     * pair, then re-reading the existing row when the insert reports a conflict.
     * `$defaultFn(generateId)` covers every OTHER insert path (Phase 3A's
     * onboarding-driven first account) that has no client-supplied key at all:
     * each gets its own random, never-colliding value, so "two different
     * creation requests may create two accounts" holds trivially for them.
     */
    mutationKey: uuid('mutation_key').notNull().$defaultFn(generateId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The actual Phase 3A+ read pattern: "list this workspace's (non-archived)
    // accounts" — every dashboard/indicator/list query filters on workspace
    // first, so it is the leading index column.
    index('trading_accounts_workspace_idx').on(table.workspaceId),
    index('trading_accounts_workspace_archived_idx').on(table.workspaceId, table.isArchived),
    uniqueIndex('trading_accounts_workspace_mutation_key_idx').on(
      table.workspaceId,
      table.mutationKey,
    ),
    // Composite-FK plumbing added in Phase 07B — lets `trades` prove the
    // Trading Account it references belongs to the same workspace as the
    // trade itself, the same technique every Phase 06 child table already
    // uses against `strategies`/`strategy_versions`/`setups`. `id` alone is
    // already unique; this pair is too.
    uniqueIndex('trading_accounts_id_workspace_idx').on(table.id, table.workspaceId),
    check(
      'trading_accounts_account_mode_check',
      sql`${table.accountMode} IN ('live', 'demo', 'prop', 'backtest')`,
    ),
    // Shape validation only (uppercase alphanumeric, 2-10 chars) — mirrors
    // src/lib/trading-accounts/validation.ts's BASE_CURRENCY_PATTERN exactly,
    // as a defence-in-depth constraint against any future write path that
    // might skip the application boundary.
    check('trading_accounts_base_currency_check', sql`${table.baseCurrency} ~ '^[A-Z0-9]{2,10}$'`),
    check('trading_accounts_starting_balance_check', sql`${table.startingBalance} >= 0`),
    check(
      'trading_accounts_risk_per_trade_percent_check',
      sql`${table.riskPerTradePercent} IS NULL OR (${table.riskPerTradePercent} > 0 AND ${table.riskPerTradePercent} <= 100)`,
    ),
    check(
      'trading_accounts_maximum_daily_loss_percent_check',
      sql`${table.maximumDailyLossPercent} IS NULL OR (${table.maximumDailyLossPercent} > 0 AND ${table.maximumDailyLossPercent} <= 100)`,
    ),
  ],
);
