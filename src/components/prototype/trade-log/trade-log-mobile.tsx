'use client';

import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';

import { outcomeLabel, statusLabel, type PrototypeCopy } from '../copy';
import type { PrototypeTrade } from '../fixtures';
import {
  closedPercentLabel,
  deriveFollowUp,
  moneyAbsenceKind,
  signedMoney,
  signedR,
  toneForDecimal,
} from '../presentation';
import { FollowUpAction } from './follow-up-action';
import type { DetailTab } from './trade-details-panel';

/**
 * THE MOBILE JOURNAL — a list of trades, built for the thumb and the scroll.
 *
 * FAST TO SKIM IS THE WHOLE REQUIREMENT. A phone shows six or seven rows at a
 * time, so every pixel a row spends on chrome is a row the reader does not see.
 * The current production list gives EVERY trade a bordered footer strip,
 * including the settled ones whose footer only ever says "Reviewed" — 44px per
 * row spent restating that there is nothing to do.
 *
 * THREE LINES, NEVER FOUR. Identity and money; lifecycle and R; classification
 * and the one follow-up, sharing the third line rather than growing a footer
 * beneath it. "Realized" is inline before its figure for the same reason. The
 * row is as tall as its content and no taller.
 *
 * TWO TARGETS PER ROW AT MOST. The first two lines are one link to the trade,
 * and the whole row is clickable through the row handler; the follow-up, when
 * present, is its own 44px target because it goes somewhere different. No swipe
 * gestures, no long-press selection, no hidden menu — a journal read on a train
 * should not have modes.
 *
 * SIGNS AND CURRENCY CODES ARE NEVER DROPPED TO SAVE ROOM. Under All accounts
 * consecutive rows can be in different currencies, so every amount carries its
 * own code rather than a bare symbol.
 */

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  flat: 'text-foreground',
  unavailable: 'text-subtle-foreground',
} as const;

export function TradeLogMobileList({
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
        const money = signedMoney(trade.netPnlMinor, trade.currency);
        const rValue = signedR(trade.actualR);
        const isRealized = trade.lifecycle === 'partially_closed';

        const lifecycleLine = [
          statusLabel(copy, trade.lifecycle),
          trade.outcome === null
            ? isRealized
              ? `${closedPercentLabel(trade.closedBps)} ${copy.closedOfPosition}`
              : null
            : outcomeLabel(copy, trade.outcome),
          trade.activityShort,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');

        return (
          <li
            key={trade.id}
            data-trade-row={trade.id}
            onClick={(event) => handleRowClick(event, trade.id)}
            className={cn(
              'border-border min-w-0 cursor-pointer border-b last:border-b-0',
              isSelected && 'bg-accent shadow-[inset_2px_0_0_0_var(--color-primary)]',
            )}
          >
            <a
              href={`?trade=${trade.id}`}
              aria-current={isSelected ? 'true' : undefined}
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
              className="focus-visible:ring-ring block min-w-0 px-4 pt-3 pb-1 outline-none focus-visible:ring-2"
            >
              {/*
                THE LINE WRAPS; THE FIGURE DOES NOT TRUNCATE.

                The money span was `shrink-0`, so at 200% text zoom
                "Realized +180.00 USD" claimed 311px on a 288px line and pushed
                the page sideways. Financial values may never be clipped, so the
                fix is the opposite of shrinking: let the line wrap and let the
                figure break at its own spaces. Nothing is lost, the row simply
                gets taller — which at 200% zoom is exactly what should happen.
              */}
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                <span className="min-w-0 text-base font-semibold break-words">
                  {trade.symbol}
                  <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                    · {trade.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                </span>
                <span
                  className={cn(
                    'numeric min-w-0 text-right text-base font-semibold',
                    money === null
                      ? 'text-subtle-foreground text-sm font-normal'
                      : TONE_CLASS[toneForDecimal(trade.netPnlMinor)],
                  )}
                  {...(money === null && moneyAbsenceKind(trade) === 'not_available'
                    ? { 'aria-label': copy.notAvailable }
                    : {})}
                >
                  {/* An open position has no result YET; a closed one with no
                      money has a gap in its record. See `moneyAbsenceKind`. */}
                  {isRealized ? (
                    <span className="text-muted-foreground mr-1.5 text-xs font-normal">
                      {copy.realized}
                    </span>
                  ) : null}
                  {money ?? (moneyAbsenceKind(trade) === 'not_recorded' ? copy.notRecorded : '—')}
                </span>
              </div>

              <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-muted-foreground min-w-0 text-sm break-words">
                  {lifecycleLine}
                </span>
                <span
                  className={cn(
                    'numeric min-w-0 text-right text-sm font-semibold',
                    rValue === null
                      ? 'text-subtle-foreground font-normal'
                      : TONE_CLASS[toneForDecimal(trade.actualR)],
                  )}
                >
                  {rValue ?? '—'}
                </span>
              </div>
            </a>

            {/*
              THE THIRD LINE CARRIES BOTH — classification left, follow-up right.

              The follow-up used to be a fourth line in its own bordered strip
              under the row, which read as a footer and cost ~44px on every
              actionable trade. On the same line as the classification it stays
              inside the row's rhythm and the list gets meaningfully shorter,
              while keeping its own 44px hit area (extended by `::after`, so the
              line height does not grow) and its own tab stop.

              It sits OUTSIDE the anchor because a link inside a link is invalid;
              the whole row remains tappable through the row handler, exactly as
              the mid-width composition does it.
            */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 px-4 pt-0.5 pb-3">
              <span className="text-muted-foreground min-w-0 text-sm break-words">
                {trade.strategy === null
                  ? copy.noStrategy
                  : trade.setup === null
                    ? trade.strategy
                    : `${trade.strategy} · ${trade.setup}`}
                {showAccount ? (
                  <span className="text-subtle-foreground block text-xs">{trade.accountName}</span>
                ) : null}
              </span>
              <FollowUpAction
                followUp={followUp}
                copy={copy}
                onSelect={(tab) => onSelect(trade.id, tab)}
                emptyPlaceholder={false}
                className="min-w-0 text-sm"
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
