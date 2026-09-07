'use client';

import { cn } from '@/lib/utils';

import { summaryUnavailable, withCount, type PrototypeCopy } from '../copy';
import type { JournalState, JournalSummary, SummaryFigure } from '../query';

/**
 * ONE COMPACT STRIP, NOT FOUR CARDS.
 *
 * The four metric cards this replaces occupied roughly 120px of the most
 * valuable vertical space on the page to say three things, one of which — Win
 * Rate — belongs to the Dashboard and Analytics rather than to a journal. Worse,
 * they were sourced from a different population than the rows beneath them, so
 * a reader who narrowed the list and read the cards as its totals was simply
 * wrong. Here the figures and the rows come from one query.
 *
 * WHAT EACH FIGURE COUNTS IS STATED, NOT ASSUMED. The trade count describes
 * every matching record across every page. The two financial figures describe
 * the eligible CLOSED subset of those same matches, and the caption names that
 * subset's size — because "124 trades" and "+12.40R" over 98 of them are two
 * different populations and printing them adjacently without saying so is how a
 * summary becomes quietly untrue.
 *
 * NEVER A FABRICATED ZERO. An unavailable figure says what is missing in words
 * — "Multiple currencies", "P&L incomplete", "No closed results yet" — and the
 * strip has no styling that would let a reader mistake any of those for a
 * result of zero.
 */
export function TradeLogSummary({
  copy,
  summary,
  state,
  className,
}: {
  copy: PrototypeCopy;
  summary: JournalSummary;
  state: JournalState;
  className?: string;
}) {
  if (state === 'open') {
    return (
      <section
        aria-label="Journal summary"
        className={cn(
          'border-border bg-card flex min-h-14 min-w-0 items-center rounded-lg border px-4 py-3',
          className,
        )}
      >
        <p className="text-foreground min-w-0 text-sm">
          <span className="numeric font-semibold">{summary.openCount}</span>{' '}
          {copy.summaryOpenTrades}
          <span className="text-muted-foreground">
            {' · '}
            <span className="numeric">{summary.partiallyClosedCount}</span>{' '}
            {copy.summaryPartiallyClosed}
          </span>
        </p>
      </section>
    );
  }

  /*
    THE CAPTION'S SUPPORTING DETAIL, IN THE READING LANGUAGE.

    These sentences used to be produced in `query.ts` as pre-baked English,
    which put product copy in the retrieval layer and left three untranslated
    strings sitting in the middle of the Thai journal. The query returns a
    reason code and a count; the wording is chosen here.
  */
  const details = [summary.netPnl, summary.totalR]
    .map((figure) => {
      if (figure.status !== 'unavailable') return undefined;
      if (figure.reason === 'pnl_incomplete' && figure.count !== undefined) {
        return withCount(copy.summaryPnlIncompleteDetail, figure.count);
      }
      if (figure.reason === 'multiple_currencies') return copy.summaryMultipleCurrenciesHint;
      return undefined;
    })
    .filter((detail): detail is string => detail !== undefined);

  return (
    <section
      aria-label="Journal summary"
      className={cn(
        'border-border bg-card min-h-14 min-w-0 rounded-lg border px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-foreground min-w-0 text-sm">
          <span className="numeric text-base font-semibold">{summary.totalMatching}</span>{' '}
          <span className="text-muted-foreground">{copy.summaryTrades}</span>
        </p>

        <Reading copy={copy} label={copy.summaryNetPnl} figure={summary.netPnl} />
        <Reading copy={copy} label={copy.summaryTotalR} figure={summary.totalR} />
      </div>

      {/*
        ONE CAPTION LINE, CARRYING BOTH FACTS.

        The subset's size and any unavailable-reason detail used to sit in two
        places — the detail inline beside its own figure, the caption below —
        and on a 390px screen that turned a three-reading strip into five
        wrapped lines before the first trade. Both are qualifications of the
        same population, so they belong in the same sentence.
      */}
      <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
        {withCount(copy.summaryResultsFrom, summary.closedEligible)}
        {details.length === 0 ? '' : ` · ${details.join(' · ')}`}
      </p>
    </section>
  );
}

const TONE_CLASS = {
  positive: 'text-positive',
  negative: 'text-negative',
  flat: 'text-foreground',
} as const;

function Reading({
  copy,
  label,
  figure,
}: {
  copy: PrototypeCopy;
  label: string;
  figure: SummaryFigure;
}) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {figure.status === 'available' ? (
        <span className={cn('numeric text-base font-semibold', TONE_CLASS[figure.tone])}>
          {figure.text}
        </span>
      ) : (
        // The REASON, in words, at the figure's own place in the row. Its
        // supporting count moves to the caption — see the caption's note.
        <span className="text-foreground font-medium">
          {summaryUnavailable(copy, figure.reason)}
        </span>
      )}
    </p>
  );
}
