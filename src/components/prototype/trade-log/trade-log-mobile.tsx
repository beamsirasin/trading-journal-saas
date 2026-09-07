'use client';

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
 * row spent restating that there is nothing to do. Here the fourth line exists
 * only when there is genuinely an action, which takes roughly a fifth off the
 * list's height on an ordinary page of closed trades.
 *
 * TWO TARGETS PER ROW AT MOST. The row itself is one link to the trade; the
 * follow-up, when present, is its own 44px target because it goes somewhere
 * different. No swipe gestures, no long-press selection, no hidden menu — a
 * journal read on a train should not have modes.
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
            className={cn(
              'border-border min-w-0 border-b last:border-b-0',
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
              className={cn(
                'focus-visible:ring-ring block min-w-0 px-4 pt-4 outline-none focus-visible:ring-2',
                followUp === 'none' ? 'pb-4' : 'pb-2',
              )}
            >
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 text-base font-semibold break-words">
                  {trade.symbol}
                  <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                    · {trade.direction === 'long' ? 'Long' : 'Short'}
                  </span>
                </span>
                <span
                  className={cn(
                    'numeric shrink-0 text-base font-semibold',
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
                  {money ?? (moneyAbsenceKind(trade) === 'not_recorded' ? copy.notRecorded : '—')}
                </span>
              </div>

              <div className="mt-1 flex min-w-0 items-baseline justify-between gap-3">
                <span className="text-muted-foreground min-w-0 text-sm break-words">
                  {lifecycleLine}
                </span>
                <span
                  className={cn(
                    'numeric shrink-0 text-sm font-semibold',
                    rValue === null
                      ? 'text-subtle-foreground font-normal'
                      : TONE_CLASS[toneForDecimal(trade.actualR)],
                  )}
                >
                  {rValue ?? '—'}
                </span>
              </div>

              {isRealized ? (
                <p className="text-muted-foreground mt-0.5 text-right text-xs">{copy.realized}</p>
              ) : null}

              <p className="text-muted-foreground mt-1.5 min-w-0 text-sm break-words">
                {trade.strategy === null
                  ? copy.noStrategy
                  : trade.setup === null
                    ? trade.strategy
                    : `${trade.strategy} · ${trade.setup}`}
                {showAccount ? (
                  <span className="text-subtle-foreground block text-xs">{trade.accountName}</span>
                ) : null}
              </p>
            </a>

            {/* Only an ACTIONABLE state earns a fourth line. A settled trade
                gets no footer at all, rather than a 44px strip saying so. */}
            {followUp === 'none' ? null : (
              <div className="px-4 pb-1">
                <FollowUpAction
                  followUp={followUp}
                  copy={copy}
                  onSelect={(tab) => onSelect(trade.id, tab)}
                  className="min-h-11"
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
