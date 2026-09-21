'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { SYMBOL_MAX_LENGTH } from '@/lib/trades/constants';
import {
  ForbiddenError,
  getActiveWorkspaceContext,
  requireTradeManagement,
} from '@/server/auth/dal';
import {
  importSavedSymbols,
  removeSymbol,
  SAVED_SYMBOL_IMPORT_LIMIT,
  saveSymbol,
  type SavedSymbolErrorCode,
  type SavedSymbolResult,
} from '@/server/services/saved-symbol-library';

/**
 * Saved Symbol library Server Actions. Workspace and actor come from the
 * session, never the payload; `.strict()` schemas refuse a forged
 * `workspaceId`. The service re-verifies membership and entitlement inside its
 * own transaction and is the authorization boundary.
 *
 * Gated like recording a Trade (`requireTradeManagement`), because the library
 * exists to record Trades with — anyone who may do the one may keep the other.
 *
 * Every success returns the whole library as it now stands, so the picker
 * adopts the server's answer rather than guessing: a symbol saved in another
 * tab, or refused as a duplicate, is reflected the moment this returns.
 */

export type SavedSymbolPublicErrorCode =
  SavedSymbolErrorCode | 'validation_error' | 'unauthenticated' | 'unexpected_error';

export type SavedSymbolActionResult =
  | { readonly ok: true; readonly symbols: readonly string[] }
  | { readonly ok: false; readonly error: { readonly code: SavedSymbolPublicErrorCode } };

/**
 * A symbol as a trader types it: trimmed, and bounded by the same length a
 * Trade accepts — a saved symbol no Trade could be recorded with is useless.
 */
const SymbolText = z.string().trim().min(1).max(SYMBOL_MAX_LENGTH);

const SymbolSchema = z.object({ symbol: SymbolText }).strict();
/*
  An import is lenient per entry and strict in shape. The browser store it
  comes from was never length-bounded, so one stale over-long entry must not
  reject the whole list — it would fail the same way on every later visit and
  the move would never complete. The service drops what a Trade could not use.
*/
const ImportSchema = z
  .object({ symbols: z.array(z.string().max(500)).max(SAVED_SYMBOL_IMPORT_LIMIT) })
  .strict();

function fail(code: SavedSymbolPublicErrorCode): SavedSymbolActionResult {
  return { ok: false, error: { code } };
}

async function run(
  work: (ctx: { workspaceId: string; userId: string }) => Promise<SavedSymbolResult>,
): Promise<SavedSymbolActionResult> {
  let ctx: { workspaceId: string; userId: string };
  try {
    const { workspaceId, userId } = await getActiveWorkspaceContext();
    await requireTradeManagement(workspaceId);
    ctx = { workspaceId, userId };
  } catch (error) {
    if (error instanceof ForbiddenError) return fail('workspace_access_denied');
    if (error instanceof Error && error.name === 'UnauthenticatedError') {
      return fail('unauthenticated');
    }
    return fail('unexpected_error');
  }
  try {
    const result = await work(ctx);
    if (!result.ok) return fail(result.code);
    for (const locale of ['en', 'th']) revalidatePath(`/${locale}/app/trades/new`);
    return { ok: true, symbols: result.symbols };
  } catch {
    return fail('unexpected_error');
  }
}

export async function saveSymbolAction(input: unknown): Promise<SavedSymbolActionResult> {
  const parsed = SymbolSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  return run(({ workspaceId, userId }) => saveSymbol(workspaceId, userId, parsed.data.symbol));
}

export async function removeSymbolAction(input: unknown): Promise<SavedSymbolActionResult> {
  const parsed = SymbolSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  return run(({ workspaceId, userId }) => removeSymbol(workspaceId, userId, parsed.data.symbol));
}

/** The one-time move of a browser's old list. Idempotent: repeating it changes nothing. */
export async function importSavedSymbolsAction(input: unknown): Promise<SavedSymbolActionResult> {
  const parsed = ImportSchema.safeParse(input);
  if (!parsed.success) return fail('validation_error');
  return run(({ workspaceId, userId }) =>
    importSavedSymbols(workspaceId, userId, parsed.data.symbols),
  );
}
