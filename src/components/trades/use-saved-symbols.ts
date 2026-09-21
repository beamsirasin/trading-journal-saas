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
  type SavedSymbolActionResult,
} from '@/server/actions/saved-symbols';

/** Whitespace is not part of a symbol. Identity ignores case; spelling does not. */
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** One change the trader asked for that the server has not answered yet. */
interface PendingWrite {
  readonly kind: 'save' | 'remove';
  readonly symbol: string;
}

/** A change applied to a list: the same arithmetic the server does. */
function applyWrite(list: readonly string[], write: PendingWrite): readonly string[] {
  if (write.kind === 'remove') return list.filter((item) => !same(item, write.symbol));
  return list.some((item) => same(item, write.symbol)) ? list : [write.symbol, ...list];
}

/**
 * THE SAVED SYMBOL LIBRARY, AS THE PICKER SEES IT.
 *
 * The server holds it. Add and remove show at once and write in the
 * background — and what is on screen is always rebuilt the same way:
 *
 *     the last library the server confirmed
 *   + every change still waiting for an answer, in the order it was made.
 *
 * WHY REBUILD, RATHER THAN REMEMBER "THE LIST BEFORE" EACH WRITE. An earlier
 * version captured the list at the moment each write began and restored that
 * on failure. With two writes in flight that is wrong both ways round, and both
 * were measured: an earlier write's answer, adopted wholesale, erased a later
 * change still on its way; and an earlier write that FAILED after a later one
 * had landed restored a list from before both — erasing a symbol the server
 * really held. A write whose request never reached the server was worse again:
 * the rejection skipped the restore entirely and left the symbol on screen as
 * though it were saved. Rebuilding from server truth plus pending intents has
 * none of these: a failed write drops only its own intent, which puts back
 * exactly what the server holds, and nothing in flight is ever forgotten.
 *
 * THE FRESHEST ANSWER WINS. Every write is numbered as it is made. Each
 * successful answer describes the library after that write and every write
 * before it, so the highest-numbered answer received is the newest truth; an
 * older one arriving late is not allowed to replace it. That rests on the
 * server applying one browser's writes in the order they were made, which it
 * does twice over: Next.js dispatches a client's Server Actions one at a time,
 * and the service serialises every write on the workspace row lock.
 *
 * THE ONE-TIME MOVE FROM THIS BROWSER. Saved Symbols used to live only in
 * `localStorage`. On first load any still there are merged into the server
 * library, and only once the server has confirmed them are they removed from
 * the browser; a failure leaves them to try again next time. Recents in the
 * same store are left alone: At Entry still reads them.
 */
export function useSavedSymbols(initial: readonly string[], workspaceId: string) {
  const [symbols, setSymbols] = useState<readonly string[]>(initial);
  /** The last library the server confirmed, and the write that confirmed it. */
  const confirmed = useRef<{ list: readonly string[]; write: number }>({
    list: initial,
    write: 0,
  });
  /** Changes made but not yet answered, keyed by their number. */
  const pending = useRef(new Map<number, PendingWrite>());
  const nextWrite = useRef(0);
  const importing = useRef(false);

  /** What the screen should say: server truth, then everything still in flight. */
  function show() {
    let list = confirmed.current.list;
    for (const write of pending.current.values()) list = applyWrite(list, write);
    setSymbols(list);
  }

  /** Take a server answer if it is newer than the truth already held. */
  function accept(write: number, result: SavedSymbolActionResult | null) {
    if (result?.ok === true && write > confirmed.current.write) {
      confirmed.current = { list: result.symbols, write };
    }
  }

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
    const write = ++nextWrite.current;
    void importSavedSymbolsAction({ symbols: local.favorites })
      .catch(() => null)
      .then((result) => {
        accept(write, result);
        show();
        if (result?.ok !== true) return;
        try {
          // Re-read, so a recent recorded meanwhile is not lost with the move.
          const now = parseFavoritesState(window.localStorage.getItem(key));
          window.localStorage.setItem(key, serializeFavoritesState({ ...now, favorites: [] }));
        } catch {
          /* The server has them; a copy left behind is harmless and re-imports as nothing. */
        }
      });
  }, [workspaceId]);

  /*
    ONE REQUEST PER PRESS, AND IT ALWAYS SETTLES. A request that never reaches
    the server rejects rather than answering; that is caught and treated as the
    refusal it is, so the intent is dropped and the screen goes back to the
    truth instead of keeping a change nothing saved.
  */
  async function write(change: PendingWrite, send: () => Promise<SavedSymbolActionResult>) {
    const id = ++nextWrite.current;
    pending.current.set(id, change);
    show();
    const result = await send().catch(() => null);
    pending.current.delete(id);
    accept(id, result);
    show();
  }

  function save(symbol: string) {
    const value = symbol.trim();
    if (value === '') return Promise.resolve();
    return write({ kind: 'save', symbol: value }, () => saveSymbolAction({ symbol: value }));
  }

  function remove(symbol: string) {
    return write({ kind: 'remove', symbol }, () => removeSymbolAction({ symbol }));
  }

  return { symbols, save, remove };
}
