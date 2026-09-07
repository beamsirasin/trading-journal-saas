'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { outcomeLabel, statusLabel, type PrototypeCopy } from '../copy';
import type { PrototypeTrade } from '../fixtures';
import {
  closedPercentLabel,
  moneyAbsenceKind,
  signedMoney,
  signedR,
  toneForDecimal,
} from '../presentation';

/**
 * The journal's shared numeric and lifecycle vocabulary.
 *
 * ONE definition of each figure, used by all three compositions — the
 * seven-column table, the mid-width journal row and the mobile list. The three
 * layouts differ in arrangement only; a Trade that reads `+2.10R` on a desktop
 * must not read `+2.1R` on a phone, and the only way to guarantee that is for
 * the three to share the same renderer rather than each format their own.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every figure carries its sign, every
 * lifecycle carries its word, and every unavailable value says what it is
 * ("Not recorded", "Not available") rather than being drawn in a lighter grey
 * and left to be guessed at.
 */

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  flat: 'text-foreground',
  unavailable: 'text-subtle-foreground',
} as const;

/**
 * Where the "Realized" marker sits, and why it is a choice.
 *
 * `below` is the TABLE's answer: a fixed-width column can afford a second line
 * under the figure, and the marker lines up down the page with every other
 * row's.
 *
 * `inline` is the JOURNAL ROW's answer, and it exists because `below` was
 * visibly wrong there. In a three-line row the figures are baseline-aligned
 * with the text opposite them; a stacked marker pushed the money down, then the
 * R down, and the partially-closed row lost its alignment with the two lines of
 * text beside it — the one row in the list that most needs to be readable ended
 * up the one that looked broken.
 */
type MarkerPlacement = 'below' | 'inline';

/**
 * The inline marker sits BEFORE the number, not after it.
 *
 * Both figures in a journal row are hard right, which is what lets a reader
 * scan P&L straight down the page. A marker after the value pushes that row's
 * number left by its own width and breaks the one alignment the composition
 * is built on; in front of it, the number stays on the edge and the marker
 * simply extends leftwards into space the row already has.
 */
function Marker({ placement, label }: { placement: MarkerPlacement; label: string }) {
  return (
    <span className={cn('text-muted-foreground text-xs', placement === 'inline' && 'mr-1.5')}>
      {label}
    </span>
  );
}

export function MoneyFigure({
  trade,
  copy,
  className,
  marker = 'below',
}: {
  trade: PrototypeTrade;
  copy: PrototypeCopy;
  className?: string;
  marker?: MarkerPlacement;
}) {
  const text = signedMoney(trade.netPnlMinor, trade.currency);
  const tone = toneForDecimal(trade.netPnlMinor);
  const isRealized = trade.lifecycle === 'partially_closed';

  if (text === null) {
    // Two different absences, said differently — see `moneyAbsenceKind`.
    return moneyAbsenceKind(trade) === 'not_recorded' ? (
      <span className={cn('text-subtle-foreground text-xs', className)}>{copy.notRecorded}</span>
    ) : (
      <span className={cn('text-subtle-foreground', className)} aria-label={copy.notAvailable}>
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        marker === 'below' ? 'flex flex-col items-end gap-0.5' : 'inline-block',
        className,
      )}
    >
      {isRealized && marker === 'inline' ? (
        <Marker placement={marker} label={copy.realized} />
      ) : null}
      <span className={cn('numeric text-sm font-semibold', TONE_CLASS[tone])}>{text}</span>
      {isRealized && marker === 'below' ? (
        <Marker placement={marker} label={copy.realized} />
      ) : null}
    </span>
  );
}

/**
 * R, WITHOUT REPEATING THE PARTIAL QUALIFIER.
 *
 * Both figures carried a "From closed portion" marker, so a partially closed row
 * said it twice within 200px — and in the narrow R column the phrase wrapped to
 * two lines, making those rows visibly taller than every other row in the table.
 * The Status cell already says "Partially closed · 40% closed" and the money
 * beside it carries the marker; a third statement of the same fact is noise that
 * costs the table its rhythm.
 */
export function RFigure({
  trade,
  copy,
  className,
}: {
  trade: PrototypeTrade;
  copy: PrototypeCopy;
  className?: string;
  marker?: MarkerPlacement;
}) {
  const text = signedR(trade.actualR);
  const tone = toneForDecimal(trade.actualR);

  if (text === null) {
    return (
      <span className={cn('text-subtle-foreground', className)} aria-label={copy.notAvailable}>
        —
      </span>
    );
  }

  return (
    <span className={cn('numeric inline-block text-sm font-semibold', TONE_CLASS[tone], className)}>
      {text}
    </span>
  );
}

const LIFECYCLE_DOT: Record<PrototypeTrade['lifecycle'], string> = {
  open: 'bg-info',
  partially_closed: 'bg-info',
  closed: 'bg-muted-foreground/50',
  canceled: 'bg-subtle-foreground/40',
};

const OUTCOME_CLASS: Record<NonNullable<PrototypeTrade['outcome']>, string> = {
  win: 'text-positive',
  loss: 'text-negative',
  break_even: 'text-break-even',
  unresolved: 'text-muted-foreground',
};

/**
 * Lifecycle first, outcome beneath it.
 *
 * A PARTIALLY CLOSED POSITION CARRIES NO OUTCOME. It has a realized result and
 * a closed percentage, and both appear — but a Win/Loss label before the
 * position is settled would be a verdict on a trade that has not finished
 * (spec §N.8).
 */
export function StatusCell({
  trade,
  copy,
  className,
}: {
  trade: PrototypeTrade;
  copy: PrototypeCopy;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 flex-col gap-0.5', className)}>
      <span className="flex items-center gap-1.5 text-sm">
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0 rounded-full', LIFECYCLE_DOT[trade.lifecycle])}
        />
        <span className="text-foreground min-w-0 truncate">
          {statusLabel(copy, trade.lifecycle)}
        </span>
      </span>
      {trade.outcome === null ? (
        trade.lifecycle === 'partially_closed' ? (
          <span className="text-muted-foreground pl-3 text-xs">
            {closedPercentLabel(trade.closedBps)} {copy.closedOfPosition}
          </span>
        ) : null
      ) : (
        <span className={cn('pl-3 text-xs font-medium', OUTCOME_CLASS[trade.outcome])}>
          {outcomeLabel(copy, trade.outcome)}
        </span>
      )}
    </span>
  );
}

/**
 * The strategy a trade came from, when it came from one.
 */
export function ClassificationCell({
  trade,
  className,
}: {
  trade: PrototypeTrade;
  className?: string;
}) {
  /*
    DEMOTED, DELIBERATELY, AND NOT REMOVED.

    Strategy and Setup were `text-sm` on the strategy line — the same size as the
    symbol and the date, and one step above the R beside them once tone is taken
    into account. That put "which system produced this" in the same rank as
    "what did it make", and a reader scanning a column of results had four
    competing sizes to sort through per row. Both lines are `text-xs` and muted
    now: still legible, still scannable down the column, visibly subordinate to
    the two figures the journal exists to show.
  */
  /*
    STRATEGY ONLY, AND SILENCE WHEN THERE IS NONE.

    Two changes, both about what a journal row is for. Setup moved to Trade
    details: it is the second half of a classification the reader is rarely
    scanning for, and it was spending a line of every row plus half the column's
    width on a value that truncates at typical names anyway.

    And an unassigned strategy now renders NOTHING. It used to print "No
    strategy", which put a small grey accusation in every row of a journal
    belonging to someone who simply has not created strategies yet — a valid
    record made to look deficient by a label. Absence of an optional
    classification is not information worth a row's space.
  */
  if (trade.strategy === null) return null;

  return (
    <span
      className={cn('text-muted-foreground block min-w-0 truncate text-xs', className)}
      title={trade.strategy}
    >
      {trade.strategy}
    </span>
  );
}

/** A label whose only job is to sit above a figure without competing with it. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground text-xs">{children}</span>;
}
