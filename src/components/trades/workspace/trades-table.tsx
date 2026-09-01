'use client';

import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';

import { deriveTradeResult } from '@/lib/trades/result';
import {
  deriveTradeReviewState,
  isActionableReviewState,
  TRADE_REVIEW_STATE_TAB,
  type TradeReviewState,
} from '@/lib/trades/review-state';
import { cn } from '@/lib/utils';
import { formatPlannedRr, formatR, formatTradeMoney } from '@/components/trades/trade-format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroller,
} from '@/components/ui/table';
import { Link, useRouter } from '@/i18n/navigation';

import { useTradeDetailsHref } from './trade-links';
import { TradeResultBadge } from './trade-result-badge';
import { rememberTradeFocusReturn } from './use-trade-focus-return';
import type { TradesWorkspaceRow } from './workspace-row';

/**
 * THE DESKTOP TRADES WORKSPACE — table-first, nine columns, and every one of
 * them earns its place by answering a question a trader actually asks:
 *
 *   Date, Symbol      what did I trade, and when?
 *   Result            what happened?
 *   P&L, R            how much money, how many R?
 *   Planned RR        what did I plan?
 *   Strategy, Setup   which system produced it?
 *   Review            is there anything left to do on it?
 *
 * NINE, NOT FIFTEEN. A column-management product is not built here and none
 * exists in this repository to reuse cheaply, so the default IS the offer for
 * this pass. Direction, session, timeframe, entry/stop/exit, size, fees,
 * confidence, emotion and holding time are all present in the domain and all
 * reachable — inside Trade Details, one click away, where they have room to
 * be read rather than truncated into a 90px cell.
 *
 * REAL TABLE SEMANTICS, through the project's own primitives, so a screen
 * reader announces row and column position; a grid of divs cannot reproduce
 * that without getting it subtly wrong. The table scrolls inside
 * `TableScroller` rather than pushing the page sideways (docs/design-system.md
 * section 6 — no horizontal PAGE overflow at any width).
 *
 * ROW ACTIVATION, TWICE OVER. The Symbol cell holds the real link: it is what
 * a keyboard reaches, what a screen reader announces, and what focus returns
 * to when the sheet closes. The whole row is ALSO clickable for a pointer,
 * because a nine-column row whose only target is one short word is a poor
 * pointer experience. The row handler defers to whatever interactive element
 * the click actually landed on, so the Review cell's own deep link is never
 * swallowed by it.
 */
export function TradesTable({
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
  const detailsHref = useTradeDetailsHref();
  const router = useRouter();

  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, tradeId: string) {
    // A modified click opens a new tab and must leave this document alone; a
    // click that landed on a link or button belongs to that control.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('a,button,input,select,textarea') !== null) return;
    rememberTradeFocusReturn(tradeId);
    router.push(detailsHref(tradeId), { scroll: false });
  }

  return (
    <TableScroller label={t('label')} className={cn('border-border rounded-lg border', className)}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t('columns.date')}</TableHead>
            <TableHead>{t('columns.symbol')}</TableHead>
            <TableHead>{t('columns.result')}</TableHead>
            <TableHead className="text-right">{t('columns.netPnl')}</TableHead>
            <TableHead className="text-right">{t('columns.actualR')}</TableHead>
            <TableHead className="text-right">{t('columns.plannedRr')}</TableHead>
            <TableHead>{t('columns.strategy')}</TableHead>
            <TableHead>{t('columns.setup')}</TableHead>
            <TableHead>{t('columns.review')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {trades.map((trade) => {
            const isSelected = selectedTradeId === trade.tradeId;
            /*
              R IS THE TRADE'S OWN CANONICAL FIGURE, NEVER A RECOMPUTED ONE. A
              closed Trade prints `actual_r`. A partially-exited open Trade
              prints the realized-to-date R the DAL already derived through the
              calc engine, marked as such so it is never mistaken for a settled
              result. Nothing in this file divides, sums or averages.
            */
            const isRealized = trade.status === 'open' && trade.closedBps > 0;
            const rValue = trade.status === 'closed' ? trade.actualR : trade.realizedRToDate;
            const plannedRr = formatPlannedRr(trade.plannedR);
            /*
              PER-ROW MONEY CARRIES ITS CURRENCY CODE, NOT A SYMBOL. Under an
              "All accounts" scope consecutive rows can be in different
              currencies, and a bare "$" would be ambiguous across them — so
              this uses the product's existing `formatTradeMoney`, exactly as
              every Trade Detail section does. The summary figure above the
              table is the one place a symbol is safe, because canonical
              `netPnl` fails closed on a mixed-currency population rather than
              summing it.
            */
            const netPnl = formatTradeMoney(trade.netPnlMinor, trade.tradingAccountBaseCurrency);

            return (
              <TableRow
                key={trade.tradeId}
                data-trade-row-id={trade.tradeId}
                onClick={(event) => handleRowClick(event, trade.tradeId)}
                className={cn(
                  'cursor-pointer',
                  trade.status === 'open' && 'bg-info/5',
                  isSelected && 'bg-accent',
                )}
              >
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                  {trade.occurredAtDisplay}
                </TableCell>
                <TableCell>
                  <Link
                    href={detailsHref(trade.tradeId)}
                    scroll={false}
                    data-trade-row={trade.tradeId}
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => rememberTradeFocusReturn(trade.tradeId)}
                    className="focus-visible:ring-ring rounded-sm font-semibold break-all outline-none hover:underline focus-visible:ring-2"
                  >
                    {trade.symbol}
                  </Link>
                  <span className="text-muted-foreground ml-2 text-[11px] tracking-wide uppercase">
                    {tTrades(`direction.${trade.direction}`)}
                  </span>
                </TableCell>
                <TableCell>
                  <TradeResultBadge result={deriveTradeResult(trade)} />
                </TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  <MoneyCell value={netPnl} minor={trade.netPnlMinor} />
                </TableCell>
                <TableCell className="numeric text-right whitespace-nowrap">
                  <RCell value={rValue} realized={isRealized} />
                </TableCell>
                <TableCell className="numeric text-muted-foreground text-right whitespace-nowrap">
                  {plannedRr === null ? <Unavailable /> : plannedRr}
                </TableCell>
                <TableCell className="max-w-40 text-sm break-words">
                  {trade.strategyName === null ? <Unavailable /> : trade.strategyName}
                </TableCell>
                <TableCell className="max-w-40 text-sm break-words">
                  {trade.setupName === null ? <Unavailable /> : trade.setupName}
                </TableCell>
                <TableCell>
                  <ReviewCell tradeId={trade.tradeId} state={deriveTradeReviewState(trade)} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableScroller>
  );
}

/**
 * A Trade with no monetary result prints an em dash, never a zero. The
 * difference between "this made nothing" and "no money was ever recorded for
 * this" is exactly the distinction a journal exists to preserve.
 */
function MoneyCell({ value, minor }: { value: string | null; minor: string | null }) {
  if (value === null || minor === null) return <Unavailable />;
  const isNegative = minor.startsWith('-');
  const isZero = /^-?0+$/.test(minor);
  return (
    <span className={cn(isZero ? '' : isNegative ? 'text-negative' : 'text-positive')}>
      {isNegative || isZero ? '' : '+'}
      {value}
    </span>
  );
}

function RCell({ value, realized }: { value: string | null; realized: boolean }) {
  const t = useTranslations('trades.workspace.table');
  const formatted = formatR(value);
  if (formatted === null || value === null) return <Unavailable />;
  const isNegative = value.startsWith('-');
  const isZero = Number(value) === 0;
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={cn(isZero ? '' : isNegative ? 'text-negative' : 'text-positive')}>
        {formatted}
      </span>
      {realized ? (
        <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          {t('realized')}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The Review cell.
 *
 * AN ACTIONABLE STATE IS A LINK INTO THE TAB THAT CLEARS IT — "Needs review"
 * opens Review, "Needs system result" opens Plan, "Needs details" opens
 * Execution. A cell that names a job without offering it is a to-do list with
 * no checkboxes, and this is the same work the Dashboard's Needs Attention
 * panel counts (`TRADE_REVIEW_STATE_ATTENTION`), reached the same way.
 *
 * "Reviewed" is deliberately NOT a link. There is nothing to do, and dressing
 * a settled state as an action teaches the reader to ignore the ones that are.
 */
function ReviewCell({ tradeId, state }: { tradeId: string; state: TradeReviewState }) {
  const t = useTranslations('trades.workspace.review');
  const detailsHref = useTradeDetailsHref();
  const label = t(state);

  if (!isActionableReviewState(state)) {
    return (
      <span
        data-trade-review-state={state}
        className="text-muted-foreground text-xs whitespace-nowrap"
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      href={detailsHref(tradeId, TRADE_REVIEW_STATE_TAB[state])}
      scroll={false}
      data-trade-review-state={state}
      onClick={() => rememberTradeFocusReturn(tradeId)}
      className="text-warning focus-visible:ring-ring rounded-sm text-xs font-medium whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2"
    >
      {label}
    </Link>
  );
}

/** One shared unavailable mark, so no cell invents its own. */
function Unavailable() {
  const t = useTranslations('trades');
  return (
    <span className="text-subtle-foreground" aria-label={t('common.notAvailable')}>
      —
    </span>
  );
}
