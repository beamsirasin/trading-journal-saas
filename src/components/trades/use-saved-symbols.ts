'use client';

import { useEffect, useRef, useState } from 'react';

import {
  favoritesStorageKey,
  parseFavoritesState,
  serializeFavoritesState,
} from '@/lib/trades/local-favorites';
import {
  importSavedSymbolsAction,
  removeSymbolAction,
  saveSymbolAction,
} from '@/server/actions/saved-symbols';

/** Whitespace is not part of a symbol. Identity ignores case; spelling does not. */
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * THE SAVED SYMBOL LIBRARY, AS THE PICKER SEES IT.
 *
 * The server holds it now. This hook starts from the list the page rendered
 * with, applies each change at once so Add and remove feel instant, and then
 * adopts whatever the server says the library is — so a duplicate the server
 * refused, or a symbol another tab saved, is reflected the moment the action
 * returns. A change the server rejects is rolled back rather than left showing
 * something that is not saved.
 *
 * THE ONE-TIME MOVE FROM THIS BROWSER. Saved Symbols used to live only in
 * `localStorage`. On first load with this hook, any symbols still there are
 * merged into the server library — the server refuses duplicates by case, keeps
 * the spelling it already has, and places them behind what it holds — and only
 * once the server has confirmed them are they removed from the browser. A
 * failure leaves them where they are, so the move simply tries again next time.
 * Recents in the same store are left alone: At Entry still reads them.
 */
export function useSavedSymbols(initial: readonly string[], workspaceId: string) {
  const [symbols, setSymbols] = useState<readonly string[]>(initial);
  const importing = useRef(false);

  useEffect(() => {
    // One attempt per mount, even when a development double-mount repeats it.
    if (importing.current) return;
    importing.current = true;
    const key = favoritesStorageKey('symbol', workspaceId);
    let local;
    try {
      local = parseFavoritesState(window.localStorage.getItem(key));
    } catch {
      return; // Storage unavailable: there is nothing this browser can move.
    }
    if (local.favorites.length === 0) return;
    const pending = local.favorites;
    void importSavedSymbolsAction({ symbols: pending }).then((result) => {
      if (!result.ok) return;
      setSymbols(result.symbols);
      try {
        // Re-read, so a recent recorded meanwhile is not lost with the move.
        const now = parseFavoritesState(window.localStorage.getItem(key));
        window.localStorage.setItem(key, serializeFavoritesState({ ...now, favorites: [] }));
      } catch {
        /* The server has them; a copy left behind is harmless and re-imports as nothing. */
      }
    });
  }, [workspaceId]);

  async function save(symbol: string) {
    const value = symbol.trim();
    if (value === '') return;
    const before = symbols;
    if (!before.some((item) => same(item, value))) setSymbols([value, ...before]);
    const result = await saveSymbolAction({ symbol: value });
    setSymbols(result.ok ? result.symbols : before);
  }

  async function remove(symbol: string) {
    const before = symbols;
    setSymbols(before.filter((item) => !same(item, symbol)));
    const result = await removeSymbolAction({ symbol });
    setSymbols(result.ok ? result.symbols : before);
  }

  return { symbols, save, remove };
}
