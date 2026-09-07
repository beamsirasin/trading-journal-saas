'use client';

import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';

import { outcomeLabel, statusLabel, type PrototypeCopy } from '../copy';
import type { PrototypeTrade } from '../fixtures';
import { closedPercentLabel, deriveFollowUp } from '../presentation';
import { FollowUpAction } from './follow-up-action';
import { MoneyFigure, RFigure } from './journal-figures';
import type { DetailTab } from './trade-details-panel';

/**
 * THE MID-WIDTH JOURNAL ROW — laptop widths, roughly 720–1,119px of journal
 * content.
 *
 * A DIFFERENT COMPOSITION, NOT A COMPRESSED TABLE. Seven columns fit inside
 * 1,120px because the two figure columns have room to sit at their full size
 * beside a classification that can still be read; below that, the honest
 * choices are to shrink the type, to clip the numbers, or to change the
 * arrangement. The first two are how a financial table becomes unreadable while
 * appearing to still work, so this changes the arrangement.
 *
 * WHAT SURVIVES THE TRANSITION IS EVERYTHING. Symbol, direction, lifecycle,
 * outcome, date, money, R, strategy, setup and the follow-up are all present at
 * this width — reflowed into three lines of a two-column row rather than
 * dropped. The only thing lost is the column grid, and with it the ability to
 * compare one field down the page at a glance, which is the trade this width
 * genuinely has to make.
 *
 * The figures stay hard right and keep the table's alignment, so scanning P&L
 * down the list still works exactly as it did one breakpoint up.
 */
export function TradeLogRows({
  trades,
  copy,
  selectedTradeId,
  showAccount,
  onSelect,
  className,
}: {
  trades: readonly PrototypeTrade[];
  copy: PrototypeCopy;
  selectedTradeId: string | null;
  showAccount: boolean;
  onSelect: (tradeId: string, tab: DetailTab) => void;
  className?: string;
}) {
  function handleRowClick(event: MouseEvent<HTMLLIElement>, tradeId: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('a,button,input,select,textarea') !== null) return;
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    onSelect(tradeId, 'overview');
  }

  return (
    <ul aria-label={copy.journalLabel} className={cn('flex min-w-0 flex-col', className)}>
      {trades.map((trade) => {
        const isSelected = selectedTradeId === trade.id;
        const followUp = deriveFollowUp(trade);
        const lifecycleLine = [
          statusLabel(copy, trade.lifecycle),
          trade.outcome === null
            ? trade.lifecycle === 'partially_closed'
              ? `${closedPercentLabel(trade.closedBps)} ${copy.closedOfPosition}`
              : null
            : outcomeLabel(copy, trade.outcome),
          `${trade.activityDate}, ${trade.activityTime.replace(/^\S+\s/, '')}`,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');

        return (
          <li
            key={trade.id}
            data-trade-row={trade.id}
            aria-current={isSelected ? true : undefined}
            onClick={(event) => handleRowClick(event, trade.id)}
            className={cn(
              'border-border min-w-0 cursor-pointer border-b px-4 py-3.5 last:border-b-0',
              'hover:bg-accent/60 transition-colors',
              isSelected &&
                'bg-accent hover:bg-accent shadow-[inset_2px_0_0_0_var(--color-primary)]',
            )}
          >
            <div className="flex min-w-0 items-baseline justify-between gap-4">
              <a
                href={`?trade=${trade.id}`}
                onClick={(event) => {
                  if (
                    event.metaKey ||
                    event.ctrlKey ||
                    event.shiftKey ||
                    event.altKey ||
                    event.button !== 0
                  ) {
                    return;
                  }
                  event.preventDefault();
                  onSelect(trade.id, 'overview');
                }}
                className="focus-visible:ring-ring min-w-0 rounded-sm outline-none focus-visible:ring-2"
              >
                <span className="text-foreground text-sm font-semibold break-words">
                  {trade.symbol}
                </span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {trade.direction === 'long' ? 'Long' : 'Short'}
                </span>
              </a>
              <MoneyFigure
                trade={trade}
                copy={copy}
                marker="inline"
                className="shrink-0 text-right"
              />
            </div>

            <div className="mt-1 flex min-w-0 items-baseline justify-between gap-4">
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {lifecycleLine}
                {showAccount ? ` · ${trade.accountName}` : ''}
              </span>
              <RFigure trade={trade} copy={copy} marker="inline" className="shrink-0 text-right" />
            </div>

            <div className="mt-2 flex min-w-0 items-baseline justify-between gap-4">
              <span className="text-muted-foreground min-w-0 truncate text-xs">
                {trade.strategy === null
                  ? copy.noStrategy
                  : trade.setup === null
                    ? trade.strategy
                    : `${trade.strategy} · ${trade.setup}`}
              </span>
              <FollowUpAction
                followUp={followUp}
                copy={copy}
                onSelect={(tab) => onSelect(trade.id, tab)}
                emptyPlaceholder={false}
                className="shrink-0 text-xs"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
