'use client';

import type { MouseEvent } from 'react';

import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { PrototypeCopy } from '../copy';
import type { PrototypeTrade } from '../fixtures';
import { deriveFollowUp } from '../presentation';
import { FollowUpAction } from './follow-up-action';
import { ClassificationCell, MoneyFigure, RFigure, StatusCell } from './journal-figures';
import type { DetailTab } from './trade-details-panel';

/**
 * THE SEVEN-COLUMN JOURNAL — the desktop composition, at a journal content
 * width of roughly 1,120px and above.
 *
 * WHAT THE NINE COLUMNS LOST, AND WHY. Planned RR left the default view because
 * it is an EXPECTATION sitting in a row of RESULTS, and at equal visual weight
 * a reader has to work out every time which of the three numbers is the one
 * that happened. Strategy and Setup merged into one two-line cell for the same
 * reason: they are one fact about a Trade — which system produced it — not two
 * peers of the money. Both remain one click away in Trade details, where they
 * have room to be read rather than truncated.
 *
 * WHAT THE ORDER IS FOR. Identity, then when, then lifecycle, then the two
 * figures, then the classification, then the one thing left to do. That is the
 * order a trader scans a journal in, and it puts the result before the
 * metadata, which is the whole point of the redesign (spec §B4).
 *
 * REAL TABLE SEMANTICS through the project's own primitives, so a screen reader
 * announces row and column position. The row is clickable for a pointer and the
 * symbol is a genuine link for everything else — keyboard, copy-link, new tab —
 * exactly as the production table already does it.
 */
export function TradeLogTable({
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
  /** Under All accounts the account name joins the Trade cell's secondary line. */
  showAccount: boolean;
  onSelect: (tradeId: string, tab: DetailTab) => void;
  className?: string;
}) {
  function handleRowClick(event: MouseEvent<HTMLTableRowElement>, tradeId: string) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if ((event.target as HTMLElement).closest('a,button,input,select,textarea') !== null) return;
    // Selecting text inside a row is reading, not navigating.
    if ((window.getSelection()?.toString() ?? '') !== '') return;
    onSelect(tradeId, 'overview');
  }

  return (
    <Table className={cn('min-w-0 table-fixed', className)}>
      {/*
        Fixed columns, with Strategy / Setup as the ONE that absorbs slack.
        Status is 156px rather than the 104px minimum the spec names, measured
        rather than guessed: "Partially closed" at 14px plus its dot and the
        cell's padding needs 149px, and below that the two longest lifecycle
        words wrapped onto a second line, which grew those rows and broke the
        column rhythm the table exists to provide.
      */}
      <colgroup>
        <col className="w-[160px]" />
        <col className="w-[148px]" />
        <col className="w-[156px]" />
        <col className="w-[164px]" />
        <col className="w-[104px]" />
        <col />
        <col className="w-[168px]" />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-4">{copy.colTrade}</TableHead>
          <TableHead className="h-10 px-4" title={copy.timezoneNote}>
            {copy.colActivity}
          </TableHead>
          <TableHead className="h-10 px-4">{copy.colStatus}</TableHead>
          <TableHead className="h-10 px-4 text-right">{copy.colNetPnl}</TableHead>
          <TableHead className="h-10 px-4 text-right">{copy.colActualR}</TableHead>
          <TableHead className="h-10 px-4">{copy.colStrategySetup}</TableHead>
          <TableHead className="h-10 px-4">{copy.colFollowUp}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => {
          const isSelected = selectedTradeId === trade.id;
          return (
            <TableRow
              key={trade.id}
              data-trade-row={trade.id}
              aria-selected={isSelected}
              onClick={(event) => handleRowClick(event, trade.id)}
              className={cn(
                'group/row h-16 cursor-pointer',
                // Hover is a neutral surface tint and nothing else — no
                // revealed controls, no border change, no lift.
                'hover:bg-accent/60',
                // Selected adds the accent fill plus a 2px inset leading
                // marker, so the open Trade is identifiable without relying on
                // the fill alone.
                isSelected &&
                  'bg-accent hover:bg-accent shadow-[inset_2px_0_0_0_var(--color-primary)]',
              )}
            >
              <TableCell className="px-4 py-3">
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
                  className="focus-visible:ring-ring block min-w-0 rounded-sm outline-none focus-visible:ring-2"
                >
                  <span className="text-foreground block text-sm font-semibold break-words">
                    {trade.symbol}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {trade.direction === 'long' ? 'Long' : 'Short'}
                    {showAccount ? ` · ${trade.accountName}` : ''}
                  </span>
                </a>
              </TableCell>

              <TableCell className="px-4 py-3">
                <span className="text-foreground block text-sm">{trade.activityDate}</span>
                <span className="text-muted-foreground block text-xs">{trade.activityTime}</span>
              </TableCell>

              <TableCell className="px-4 py-3">
                <StatusCell trade={trade} copy={copy} />
              </TableCell>

              <TableCell className="px-4 py-3 text-right">
                <MoneyFigure trade={trade} copy={copy} className="items-end" />
              </TableCell>

              <TableCell className="px-4 py-3 text-right">
                <RFigure trade={trade} copy={copy} className="items-end" />
              </TableCell>

              <TableCell className="min-w-0 px-4 py-3">
                <ClassificationCell trade={trade} copy={copy} />
              </TableCell>

              <TableCell className="px-4 py-3">
                <FollowUpAction
                  followUp={deriveFollowUp(trade)}
                  copy={copy}
                  onSelect={(tab) => onSelect(trade.id, tab)}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
