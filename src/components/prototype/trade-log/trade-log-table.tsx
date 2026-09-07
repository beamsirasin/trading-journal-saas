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
        A REAL `<caption>`, visually hidden. It is the table's native accessible
        name and the sentence a screen reader reads before entering the grid;
        the production table gets the equivalent from `TableScroller`'s
        `role="region"`, which this composition does not use because at
        ≥1,120px of content the table has no reason to scroll.
      */}
      <caption className="sr-only">
        {copy.journalLabel} — {copy.timezoneNote}
      </caption>
      {/*
        Fixed columns, with Strategy / Setup as the ONE that absorbs slack.
        Status is 156px rather than the 104px minimum the spec names, measured
        rather than guessed: "Partially closed" at 14px plus its dot and the
        cell's padding needs 149px, and below that the two longest lifecycle
        words wrapped onto a second line, which grew those rows and broke the
        column rhythm the table exists to provide.
      */}
      {/*
        SIX COLUMNS, NOT SEVEN. The Follow-up column is gone — see the note at
        the top of this file. The 168px it occupied went to the two figures and
        to Strategy, which no longer has to truncate at typical names.
      */}
      <colgroup>
        <col className="w-[180px]" />
        <col className="w-[152px]" />
        <col className="w-[160px]" />
        <col className="w-[180px]" />
        <col className="w-[120px]" />
        <col />
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
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => {
          const isSelected = selectedTradeId === trade.id;
          return (
            <TableRow
              key={trade.id}
              data-trade-row={trade.id}
              /*
                `data-selected`, NOT `aria-selected`.

                `aria-selected` is only defined on a row inside a `grid` or
                `treegrid`; on a row in a plain `table` it is invalid ARIA that
                either gets dropped or, worse, makes the row announce a
                selection state in a widget that has no selection model. The
                open trade is conveyed to assistive tech by `aria-current` on
                the row's own link, which is where the navigation actually is.
              */
              data-selected={isSelected ? '' : undefined}
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
                <ClassificationCell trade={trade} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
