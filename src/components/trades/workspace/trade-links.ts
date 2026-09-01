'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

import type { TradeDetailsTab } from '@/lib/trades/details-tabs';
import { usePathname } from '@/i18n/navigation';

/**
 * WHERE A TRADE OPENS, AND WHERE CLOSING IT RETURNS TO.
 *
 * Trade Details is URL-backed (`?trade=<id>`), the contract this route already
 * had before this pass and the reason a Trade survives a refresh, opens from a
 * deep link, and can be linked to from the Dashboard's Needs Attention panel.
 * Every other parameter — the filters, the view, the bucket, the pager's
 * cursor and trail — is carried through verbatim, so opening a Trade never
 * silently changes the population behind the sheet.
 *
 * These are hooks rather than pure functions because the current URL is the
 * input, and reading it from `useSearchParams` keeps every link in the table
 * agreeing with whatever the toolbar last applied without any of them being
 * handed a snapshot that could go stale.
 */
export function useTradeDetailsHref(): (tradeId: string, tab?: TradeDetailsTab) => string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (tradeId: string, tab?: TradeDetailsTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('trade', tradeId);
      // An unspecified tab means "wherever Details opens by default" — spelled
      // by REMOVING the key rather than writing the default into it, so a
      // later change to the default lands on existing links too.
      if (tab === undefined) params.delete('tab');
      else params.set('tab', tab);
      return `${pathname}?${params.toString()}`;
    },
    [pathname, searchParams],
  );
}

/** The list URL behind the sheet — the same scope, with no Trade selected. */
export function useTradesListHref(): () => string {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('trade');
    params.delete('tab');
    const query = params.toString();
    return query === '' ? pathname : `${pathname}?${query}`;
  }, [pathname, searchParams]);
}
