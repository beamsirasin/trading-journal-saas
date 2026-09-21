import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { generateId } from '@/lib/identifiers';

import { workspaces } from './workspaces';

/**
 * SAVED SYMBOLS — the instruments a workspace has chosen to keep.
 *
 * A library the trader curates, not a record of what was traded: a row exists
 * because someone pressed Add, and nothing else creates one. It used to live in
 * `localStorage`, which meant a trader who changed browser or device lost a
 * list they had deliberately built — the one thing a curated list must not do.
 *
 * WORKSPACE-SCOPED, like the Exit Plan library beside it and like the browser
 * store it replaces, whose key already carried the workspace: in a shared
 * workspace these are the instruments that workspace trades.
 *
 * SPELLING IS THE TRADER'S AND IDENTITY IGNORES CASE. `symbol` keeps exactly
 * what was typed, less surrounding whitespace — `US30.cash`, `XAUUSD.m` and
 * `GER40` are a broker's own names and none survives being tidied up — while
 * `saved_symbols_workspace_symbol_ci_idx` makes `btcusd` and `BTCUSD` one row,
 * so the rule "no duplicate whatever its case" is the database's to keep, not
 * a check every caller must remember. The first spelling saved is the one
 * kept, because that is the one the trader chose.
 *
 * NEWEST FIRST is `created_at DESC`. Removing is a delete: a symbol taken out
 * of a personal library has no history worth archiving, and no Trade points
 * here — a Trade stores its own symbol text.
 */
export const savedSymbols = pgTable(
  'saved_symbols',
  {
    id: uuid('id').primaryKey().$defaultFn(generateId),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('saved_symbols_workspace_symbol_ci_idx').on(
      table.workspaceId,
      sql`upper(${table.symbol})`,
    ),
    index('saved_symbols_workspace_created_idx').on(table.workspaceId, table.createdAt),
    // Stored already trimmed, and never empty: the database refuses what the
    // form should never have sent.
    check(
      'saved_symbols_symbol_trimmed_check',
      sql`${table.symbol} = btrim(${table.symbol}) AND ${table.symbol} <> ''`,
    ),
  ],
);
