import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { systemClock, type Clock } from '@/lib/time';
import { SYMBOL_MAX_LENGTH } from '@/lib/trades/constants';
import { getDb, type Database } from '@/server/db/client';
import { savedSymbols } from '@/server/db/schema';

import { acquireWorkspaceWriteAccess, type WorkspaceAccessDenial } from './strategy-management';

/**
 * SAVED SYMBOL LIBRARY — the instruments a workspace has chosen to keep.
 *
 * Every function takes `workspaceId`/`userId` already derived from the session
 * and re-verifies membership and entitlement itself, inside its own
 * transaction, in the canonical lock order `strategy-management.ts` documents.
 * That makes this service, not its callers, the authorization boundary — the
 * same arrangement as the Exit Plan library it sits beside.
 *
 * WHAT THIS NEVER DOES: touch a Trade, or infer a symbol from one. A row exists
 * because a trader pressed Add. `trades.symbol` stores its own text, so
 * removing a saved symbol changes what the picker offers next time and nothing
 * about any Trade already recorded against it.
 */

type Executor = Pick<Database, 'select' | 'insert' | 'delete'>;

export type SavedSymbolErrorCode = WorkspaceAccessDenial | 'blank_symbol';

export type SavedSymbolResult =
  | { readonly ok: true; readonly symbols: readonly string[] }
  | { readonly ok: false; readonly code: SavedSymbolErrorCode };

/** How many a single import may carry — far more than any real browser store held. */
export const SAVED_SYMBOL_IMPORT_LIMIT = 200;

/** Whitespace is not part of a symbol. Nothing else about it is touched. */
function clean(symbol: string): string {
  return symbol.trim();
}

async function list(tx: Pick<Database, 'select'>, workspaceId: string): Promise<string[]> {
  const rows = await tx
    .select({ symbol: savedSymbols.symbol })
    .from(savedSymbols)
    .where(eq(savedSymbols.workspaceId, workspaceId))
    // Newest first; the id breaks a same-instant tie deterministically, since
    // UUIDv7 ids sort by creation time.
    .orderBy(desc(savedSymbols.createdAt), desc(savedSymbols.id));
  return rows.map((row) => row.symbol);
}

/**
 * Insert unless the workspace already holds this symbol in any case. The
 * case-insensitive unique index is what refuses the duplicate, so two tabs
 * saving `btcusd` and `BTCUSD` at the same moment still leave one row — the one
 * that landed first, spelled as it was typed.
 */
async function insertOnce(tx: Executor, workspaceId: string, symbol: string, at: Date) {
  /*
    No conflict target, deliberately. The index that matters is on an
    expression, `upper(symbol)`, which Drizzle cannot name as a target; and the
    table's only other unique constraint is a generated UUIDv7 primary key that
    never collides. So "any conflict" here means exactly "already saved".
  */
  await tx
    .insert(savedSymbols)
    .values({ workspaceId, symbol, createdAt: at })
    .onConflictDoNothing();
}

/** The library as it stands, newest first. A read: membership comes from the caller's DAL. */
export async function listSavedSymbols(workspaceId: string): Promise<string[]> {
  return list(getDb(), workspaceId);
}

/** Adds one symbol to the front of the library. Saving does not select it for any Trade. */
export async function saveSymbol(
  workspaceId: string,
  userId: string,
  symbol: string,
  clock: Clock = systemClock,
): Promise<SavedSymbolResult> {
  const value = clean(symbol);
  if (value === '') return { ok: false, code: 'blank_symbol' };
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };
    await insertOnce(tx, workspaceId, value, clock.now());
    return { ok: true, symbols: await list(tx, workspaceId) };
  });
}

/** Removes a symbol, matched ignoring case. Removing one that is not there is not an error. */
export async function removeSymbol(
  workspaceId: string,
  userId: string,
  symbol: string,
  clock: Clock = systemClock,
): Promise<SavedSymbolResult> {
  const value = clean(symbol);
  if (value === '') return { ok: false, code: 'blank_symbol' };
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };
    await tx
      .delete(savedSymbols)
      .where(
        and(
          eq(savedSymbols.workspaceId, workspaceId),
          sql`upper(${savedSymbols.symbol}) = upper(${value})`,
        ),
      );
    return { ok: true, symbols: await list(tx, workspaceId) };
  });
}

/**
 * THE ONE-TIME MOVE FROM `localStorage`. Merges a browser's old list into the
 * server library without duplicates, keeping that list's own newest-first
 * order and placing it behind whatever the server already holds. A symbol the
 * server already has keeps its existing row and spelling. Safe to repeat — a
 * second import of the same list changes nothing.
 */
export async function importSavedSymbols(
  workspaceId: string,
  userId: string,
  symbols: readonly string[],
  clock: Clock = systemClock,
): Promise<SavedSymbolResult> {
  // Drop what no Trade could be recorded with, rather than refuse the list.
  const usable = symbols
    .map(clean)
    .filter((value) => value !== '' && value.length <= SYMBOL_MAX_LENGTH);
  /*
    ONE ENTRY PER SYMBOL WITHIN THE BROWSER LIST, THE NEWEST ONE. The old store
    compared exactly, so it could hold `US30.cash` and `us30.CASH` as two rows.
    Its list is newest first, so the first spelling met is the trader's latest
    choice, and it keeps its own position. Without this, the insert below —
    which runs oldest first to lay down the order — lets the OLDER spelling
    land first and win, in the older spelling's place.

    Against the server it is the other way round: a symbol the server already
    holds keeps the server's spelling, because that one was saved to the shared
    library on purpose. `insertOnce` enforces that half.
  */
  const values = usable.filter(
    (value, index) =>
      usable.findIndex((other) => other.toUpperCase() === value.toUpperCase()) === index,
  );
  return getDb().transaction(async (tx) => {
    const denial = await acquireWorkspaceWriteAccess(tx, workspaceId, userId, clock);
    if (denial !== null) return { ok: false, code: denial };
    /*
      BEHIND the library the server already holds, not on top of it. Those
      rows were saved to the shared library on purpose; a browser's old list
      carries no real save time, and stamping it "now" would let a stale
      device push itself above everything saved since. So the imports sit just
      older than the oldest existing row, a millisecond apart, in the order the
      browser had them — and anything saved afterwards lands above them all.
    */
    const [oldest] = await tx
      .select({ at: sql<Date>`min(${savedSymbols.createdAt})` })
      .from(savedSymbols)
      .where(eq(savedSymbols.workspaceId, workspaceId));
    const anchor =
      oldest?.at === null || oldest?.at === undefined ? clock.now() : new Date(oldest.at);
    const base = anchor.getTime() - values.length - 1;
    for (const [index, value] of [...values].reverse().entries()) {
      await insertOnce(tx, workspaceId, value, new Date(base + index));
    }
    return { ok: true, symbols: await list(tx, workspaceId) };
  });
}
