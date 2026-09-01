'use client';

import { BookOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { TradeAttentionKind } from '@/lib/trades/constants';
import type { TradeDetailsTab } from '@/lib/trades/details-tabs';
import { cn } from '@/lib/utils';
import type { TradeCreateStrategyOption, TradeDetail } from '@/server/dal/trades';
import { EmptyState } from '@/components/product/empty-state';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { TradeDetailsSheet } from './trade-details-sheet';
import { TradesMobileList } from './trades-mobile-list';
import { TradesPagination } from './trades-pagination';
import { TradesTable } from './trades-table';
import { useTradeFocusReturn } from './use-trade-focus-return';
import type { TradesWorkspaceRow } from './workspace-row';

/**
 * THE TRADES WORKSPACE — the list, in whichever shape the viewport can read,
 * plus the Trade Details sheet over the top of it.
 *
 * ONE POPULATION, TWO COMPOSITIONS. The desktop table and the mobile card list
 * render the SAME rows through the same derivations; neither is a reduced or
 * summarised version of the other, and the switch between them is a CSS
 * breakpoint rather than a JavaScript viewport check, so there is no hydration
 * mismatch and no flash of the wrong layout. `md` is the boundary because that
 * is where nine columns stop being legible.
 *
 * THE LIST STAYS MOUNTED WHILE THE SHEET IS OPEN. That is what makes the
 * background remain context — the scroll position, the applied filters and the
 * page of the pager are all still there behind the drawer, and closing returns
 * to exactly them rather than re-entering the workspace from the top.
 */
export function TradesWorkspace({
  trades,
  selectedTrade,
  selectedTradeId,
  detailsTab,
  nextCursor,
  currentCursor,
  cursorTrail,
  attention,
  isDayFiltered,
  isFiltered,
  canWrite,
  timezone,
  locale,
  classificationOptions,
  clearFiltersHref,
  className,
}: {
  trades: readonly TradesWorkspaceRow[];
  /** The fully authorized Trade behind `?trade=`, or `null` when none is selected or it is out of scope. */
  selectedTrade: TradeDetail | null;
  selectedTradeId: string | null;
  detailsTab: TradeDetailsTab;
  nextCursor: string | null;
  currentCursor: string | null;
  cursorTrail: string;
  attention: TradeAttentionKind | null;
  isDayFiltered: boolean;
  /** Whether any Account / Date Range / Filters narrowing is currently applied. */
  isFiltered: boolean;
  canWrite: boolean;
  timezone: string;
  locale: string;
  classificationOptions: readonly TradeCreateStrategyOption[];
  /** Where "Show all Trades" goes — the same workspace with every narrowing dropped. */
  clearFiltersHref: string;
  className?: string;
}) {
  useTradeFocusReturn(selectedTradeId);

  return (
    <div className={cn('flex min-w-0 flex-col gap-4', className)}>
      {trades.length === 0 ? (
        <TradesEmpty
          attention={attention}
          isDayFiltered={isDayFiltered}
          isFiltered={isFiltered}
          isPaged={currentCursor !== null}
          canWrite={canWrite}
          clearFiltersHref={clearFiltersHref}
        />
      ) : (
        <>
          <div className="hidden min-w-0 md:block">
            <TradesTable trades={trades} selectedTradeId={selectedTradeId} />
          </div>
          <div className="min-w-0 md:hidden">
            <TradesMobileList trades={trades} selectedTradeId={selectedTradeId} />
          </div>
        </>
      )}

      {trades.length === 0 && currentCursor === null ? null : (
        <TradesPagination
          nextCursor={nextCursor}
          currentCursor={currentCursor}
          cursorTrail={cursorTrail}
        />
      )}

      {selectedTrade === null ? null : (
        <TradeDetailsSheet
          // Keyed on the Trade, so opening a DIFFERENT Trade re-seeds the
          // sheet's tab from the URL instead of inheriting whichever tab the
          // previously-open Trade happened to be left on.
          key={selectedTrade.tradeId}
          trade={selectedTrade}
          tab={detailsTab}
          timezone={timezone}
          locale={locale}
          canWrite={canWrite}
          classificationOptions={classificationOptions}
        />
      )}
    </div>
  );
}

/**
 * FIVE DIFFERENT NOTHINGS, AND THEY ARE NOT THE SAME NOTHING.
 *
 * "This bucket is clear", "this day has no Trades", "your filters match
 * nothing", "you have paged past the end" and "you have not logged a Trade
 * yet" are five different facts, and only the last one should be inviting the
 * reader to log their first Trade. An empty state that says "No data" to all
 * five teaches the reader that the page is broken.
 *
 * Each one names the way OUT of itself — clear the bucket, clear the filters,
 * page back — which is what an empty state is for
 * (docs/design-system.md section 8).
 */
function TradesEmpty({
  attention,
  isDayFiltered,
  isFiltered,
  isPaged,
  canWrite,
  clearFiltersHref,
}: {
  attention: TradeAttentionKind | null;
  isDayFiltered: boolean;
  isFiltered: boolean;
  isPaged: boolean;
  canWrite: boolean;
  clearFiltersHref: string;
}) {
  const t = useTranslations('trades');
  const tWorkspace = useTranslations('trades.workspace.empty');

  const showAll = (
    <Button asChild variant="outline">
      <Link href={clearFiltersHref}>{t('list.showAll')}</Link>
    </Button>
  );

  if (attention !== null) {
    return (
      <EmptyState
        icon={BookOpen}
        title={t(`list.attentionEmptyTitle.${attention}`)}
        description={t(`list.attentionEmptyDescription.${attention}`)}
        action={showAll}
      />
    );
  }

  if (isPaged) {
    return (
      <EmptyState
        icon={BookOpen}
        title={tWorkspace('paged.title')}
        description={tWorkspace('paged.description')}
        action={showAll}
      />
    );
  }

  if (isDayFiltered) {
    return (
      <EmptyState
        icon={BookOpen}
        title={t('calendar.empty.title')}
        description={t('calendar.empty.description')}
        action={showAll}
      />
    );
  }

  if (isFiltered) {
    return (
      <EmptyState
        icon={BookOpen}
        title={tWorkspace('filtered.title')}
        description={tWorkspace('filtered.description')}
        action={showAll}
      />
    );
  }

  return (
    <EmptyState
      icon={BookOpen}
      title={t('empty.title')}
      description={t('empty.description')}
      action={
        canWrite ? (
          <Button asChild>
            <Link href="/app/trades/new">{t('logTrade')}</Link>
          </Button>
        ) : (
          showAll
        )
      }
    />
  );
}
