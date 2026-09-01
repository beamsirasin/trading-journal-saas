'use client';

import { useEffect } from 'react';

/**
 * RETURNING FOCUS TO THE ROW THE READER CAME FROM.
 *
 * Trade Details is a URL-backed sheet, so opening and closing it are
 * navigations, not local state changes — which means Radix's own focus
 * restoration has nothing to restore to: the trigger element is destroyed and
 * rebuilt by the render that follows. Without this, closing a Trade drops a
 * keyboard user at the top of the document and they have to tab back down
 * through the toolbar to the row they were already on.
 *
 * `sessionStorage` rather than a module variable, because the transport can
 * legitimately be a full document navigation here (the shared Dashboard state
 * controls perform one) and a module variable does not survive that. It is
 * per-tab, holds one non-sensitive Trade id, and is read exactly once before
 * being cleared. Every access is guarded: a private window, blocked site data
 * or a thumbnail capture can make even reading it throw, and losing focus
 * restoration must never break the page.
 */
const STORAGE_KEY = 'tradechemist:trades:focus-return';

export function rememberTradeFocusReturn(tradeId: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, tradeId);
  } catch {
    // Focus restoration is a convenience; storage being unavailable is not an
    // error worth surfacing to a trader.
  }
}

/**
 * Focuses the remembered row once the list is showing again with no Trade
 * selected. Does nothing at all while a Trade IS selected — the sheet owns
 * focus then, and stealing it back would trap the reader outside the dialog.
 */
export function useTradeFocusReturn(selectedTradeId: string | null): void {
  useEffect(() => {
    if (selectedTradeId !== null) return;
    let remembered: string | null = null;
    try {
      remembered = window.sessionStorage.getItem(STORAGE_KEY);
      if (remembered !== null) window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      return;
    }
    if (remembered === null) return;
    // The row may legitimately be gone — the filters changed, or the Trade
    // moved to another page of the pager. Nothing to do, and nothing broken.
    const target = document.querySelector<HTMLElement>(
      `[data-trade-row="${CSS.escape(remembered)}"]`,
    );
    target?.focus();
  }, [selectedTradeId]);
}
