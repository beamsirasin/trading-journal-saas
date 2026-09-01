'use client';

import { useTranslations } from 'next-intl';

import { deriveTradeResult } from '@/lib/trades/result';
import {
  deriveTradeReviewState,
  isActionableReviewState,
  TRADE_REVIEW_STATE_TAB,
} from '@/lib/trades/review-state';
import { cn } from '@/lib/utils';
import { formatR, formatTradeMoney } from '@/components/trades/trade-format';
import { Link } from '@/i18n/navigation';

import { useTradeDetailsHref } from './trade-links';
import { TradeResultBadge } from './trade-result-badge';
import { rememberTradeFocusReturn } from './use-trade-focus-return';
import type { TradesWorkspaceRow } from './workspace-row';

/**
 * THE MOBILE TRADES LIST — a list of Trades, not a compressed table.
 *
 * A nine-column financial table squeezed into 390px is either unreadable or
 * scrolls sideways forever, and both outcomes lose the reader. So the phone
 * gets its own composition of the SAME data, in the order a trader scans it:
 * identity and result on the top line, date beneath it, the two figures that
 * matter on their own line, then the system that produced it, then whatever is
 * left to do.
 *
 * ONE CARD PER TRADE AND NO NESTING. The whole card is one link — a single
 * 44px-plus target, one tab stop, one thing a screen reader announces — except
 * for the Review action, which is deliberately its own link because it goes
 * somewhere different (straight to the tab that clears it). Those are the only
 * two targets in a row, which is what keeps the list operable with a thumb.
 *
 * Every figure and every state is derived by exactly the same functions the
 * desktop table uses. Mobile is a different composition of one truth, never a
 * second, simplified reading of it.
 */
export function TradesMobileList({
  trades,
  selectedTradeId,
  className,
}: {
  trades: readonly TradesWorkspaceRow[];
  selectedTradeId: string | null;
  className?: string;
}) {
  const t = useTranslations('trades.workspace.table');
  const tTrades = useTranslations('trades');
  const tReview = useTranslations('trades.workspace.review');
  const detailsHref = useTradeDetailsHref();

  return (
    <ul aria-label={t('label')} className={cn('flex min-w-0 flex-col gap-3', className)}>
      {trades.map((trade) => {
        const isSelected = selectedTradeId === trade.tradeId;
        const reviewState = deriveTradeReviewState(trade);
        const isRealized = trade.status === 'open' && trade.closedBps > 0;
        const rValue = trade.status === 'closed' ? trade.actualR : trade.realizedRToDate;
        const formattedR = formatR(rValue);
        const netPnl = formatTradeMoney(trade.netPnlMinor, trade.tradingAccountBaseCurrency);
        const isNegativeMoney = trade.netPnlMinor?.startsWith('-') ?? false;
        const isZeroMoney = trade.netPnlMinor !== null && /^-?0+$/.test(trade.netPnlMinor);
        const isNegativeR = rValue?.startsWith('-') ?? false;
        const isZeroR = rValue !== null && Number(rValue) === 0;
        // Strategy and Setup share one line as "Strategy - Setup"; an
        // unclassified Trade says so once rather than printing two dashes.
        const classification =
          trade.strategyName === null
            ? tTrades('common.notAssigned')
            : trade.setupName === null
              ? trade.strategyName
              : `${trade.strategyName} · ${trade.setupName}`;

        return (
          <li key={trade.tradeId} className="min-w-0">
            <div
              className={cn(
                'border-border bg-card rounded-lg border transition-colors',
                trade.status === 'open' && 'border-info/35 bg-info/5',
                isSelected && 'border-primary ring-primary/20 ring-2',
              )}
            >
              <Link
                href={detailsHref(trade.tradeId)}
                scroll={false}
                data-trade-row={trade.tradeId}
                aria-current={isSelected ? 'true' : undefined}
                onClick={() => rememberTradeFocusReturn(trade.tradeId)}
                className="focus-visible:ring-ring block min-w-0 rounded-lg p-3.5 outline-none focus-visible:ring-2"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="text-base font-bold break-all">{trade.symbol}</span>
                      <span className="text-muted-foreground text-xs tracking-wide uppercase">
                        {tTrades(`direction.${trade.direction}`)}
                      </span>
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs break-words">
                      {trade.occurredAtDisplay}
                    </p>
                  </div>
                  <TradeResultBadge result={deriveTradeResult(trade)} />
                </div>

                <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span
                    className={cn(
                      'numeric text-sm font-semibold',
                      netPnl === null
                        ? 'text-subtle-foreground'
                        : isZeroMoney
                          ? ''
                          : isNegativeMoney
                            ? 'text-negative'
                            : 'text-positive',
                    )}
                  >
                    <span className="sr-only">{t('columns.netPnl')}: </span>
                    {netPnl === null
                      ? '—'
                      : `${isNegativeMoney || isZeroMoney ? '' : '+'}${netPnl}`}
                  </span>
                  <span
                    className={cn(
                      'numeric text-sm font-semibold',
                      formattedR === null
                        ? 'text-subtle-foreground'
                        : isZeroR
                          ? ''
                          : isNegativeR
                            ? 'text-negative'
                            : 'text-positive',
                    )}
                  >
                    <span className="sr-only">{t('columns.actualR')}: </span>
                    {formattedR ?? '—'}
                    {isRealized && formattedR !== null ? (
                      <span className="text-muted-foreground ml-1 text-[10px] tracking-wide uppercase">
                        {t('realized')}
                      </span>
                    ) : null}
                  </span>
                </div>

                <p className="text-muted-foreground mt-2 text-xs break-words">{classification}</p>
              </Link>

              <div className="border-border flex min-w-0 items-center justify-between gap-3 border-t px-3.5 py-2">
                {isActionableReviewState(reviewState) ? (
                  <Link
                    href={detailsHref(trade.tradeId, TRADE_REVIEW_STATE_TAB[reviewState])}
                    scroll={false}
                    data-trade-review-state={reviewState}
                    onClick={() => rememberTradeFocusReturn(trade.tradeId)}
                    className="text-warning focus-visible:ring-ring inline-flex min-h-11 items-center rounded-sm text-xs font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                  >
                    {tReview(reviewState)}
                  </Link>
                ) : (
                  <span
                    data-trade-review-state={reviewState}
                    className="text-muted-foreground inline-flex min-h-11 items-center text-xs"
                  >
                    {tReview(reviewState)}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
