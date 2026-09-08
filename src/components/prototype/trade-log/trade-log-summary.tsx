'use client';

import { cn } from '@/lib/utils';

import { fill, type PrototypeCopy } from '../copy';
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
 * A QUALIFIED KNOWN TOTAL, NOT A REFUSAL.
 *
 * The previous presentation printed "P&L incomplete" and no figure at all the
 * moment one closed trade lacked money — which on a real journal means one
 * price-only trade silences the total permanently. It now publishes the total it
 * DOES know, labels it "Known net P&L" so it can never be read as the whole,
 * and states its coverage in the same information unit directly beneath. The
 * coverage line is ordinary visible text: not an asterisk, not a tooltip,
 * because a caveat a reader has to hover to find is a caveat they will not read.
 *
 * THE DENOMINATOR IS THE CLOSED POPULATION, never the matching one. "109 of 111
 * closed trades" is a fact about the figure above it; "109 of 118 trades" would
 * put open positions in the denominator of a settled total and understate
 * coverage every time someone has a position running.
 */
export function TradeLogSummary({
  copy,
  summary,
  state,
  status = 'ready',
  className,
}: {
  copy: PrototypeCopy;
  summary: JournalSummary;
  state: JournalState;
  /**
   * `loading` reserves the strip's geometry while the query resolves;
   * `failed` says the strip describes nothing. Only `ready` prints figures.
   */
  status?: 'ready' | 'loading' | 'failed';
  className?: string;
}) {
  if (status === 'loading') {
    return (
      <Strip aria-busy="true" className={className}>
        {/* The strip's real height, held. A summary that appears after the rows
            pushes the whole journal down under a reader who has already started
            scanning it. */}
        <span aria-hidden="true" className="flex animate-pulse gap-6 motion-reduce:animate-none">
          <span className="bg-muted block h-5 w-24 rounded" />
          <span className="bg-muted block h-5 w-36 rounded" />
          <span className="bg-muted block h-5 w-28 rounded" />
        </span>
      </Strip>
    );
  }

  /*
    A FAILED READ SILENCES THE SUMMARY TOO.

    The error state below the strip said "Trades could not be loaded" while the
    strip above it went on publishing figures from the last successful query.
    Stale numbers presented as current are worse than the zeroes the spec
    forbids: specific, plausible, and wrong.
  */
  if (status === 'failed') {
    return (
      <Strip className={className}>
        <p className="text-muted-foreground min-w-0 text-sm">
          Summary unavailable while the journal cannot be loaded.
        </p>
      </Strip>
    );
  }

  if (state === 'open') {
    return (
      <Strip className={className}>
        <p className="text-foreground min-w-0 text-sm">
          <span className="numeric font-semibold">{summary.openCount}</span>{' '}
          {copy.summaryOpenTrades}
          <span className="text-muted-foreground">
            {' · '}
            <span className="numeric">{summary.partiallyClosedCount}</span>{' '}
            {copy.summaryPartiallyClosed}
          </span>
        </p>
      </Strip>
    );
  }

  /*
    THE SCOPE LINE NAMES THE POPULATION THE FIGURES ARE ACTUALLY OVER.

    Both aggregates are computed from `lifecycle === 'closed'` only — realized
    P&L from a partially closed position that is still running is deliberately
    NOT in them. The strip did not say so, and printed those figures beside a
    "118 trades" count, so the honest reading of the page was that the totals
    covered all 118. They cover 111. The label now describes the calculation
    that is really running, which is the only version of this line worth having.

    Mixed currency and missing P&L stay independent: a mixed-currency money
    figure suppresses its own total and says so, and the R coverage is reported
    regardless.
  */
  const scope =
    summary.closedCount === 0
      ? null
      : fill(copy.summaryClosedScope, {
          count: summary.closedCount,
          trades: summary.closedCount === 1 ? 'closed trade' : 'closed trades',
        });

  const caveats = [
    scope,
    coverageOf(copy, summary.netPnl, copy.summaryMoneyCoverage),
    coverageOf(copy, summary.totalR, copy.summaryRCoverage),
  ].filter((line): line is string => line !== null);

  return (
    <Strip className={cn('flex-col items-start gap-1', className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="text-foreground min-w-0 text-sm">
          <span className="numeric text-base font-semibold">{summary.totalMatching}</span>{' '}
          <span className="text-muted-foreground">{copy.summaryTrades}</span>
        </p>

        <Reading
          copy={copy}
          label={
            summary.netPnl.kind === 'known_total' ? copy.summaryKnownNetPnl : copy.summaryNetPnl
          }
          figure={summary.netPnl}
        />
        {/*
          A QUALIFIED FIGURE SAYS SO IN ITS OWN LABEL. `Total R` printed over an
          incomplete population claims a completeness the number does not have;
          `Recorded total R` is true whether or not every closed trade has one,
          and the missing count underneath says how far short it falls.
        */}
        <Reading
          copy={copy}
          label={summary.totalR.kind === 'known_total' ? 'Recorded total R' : copy.summaryTotalR}
          figure={summary.totalR}
        />
      </div>

      {/*
        THE COVERAGE STATEMENT, ADJACENT TO THE FIGURES IT QUALIFIES.

        One line rather than the two the specification sketches, because the
        same strip has to survive a 320px screen without becoming five wrapped
        rows before the first trade. The facts are identical and both remain
        visible; only the separator changed.
      */}
      {caveats.length === 0 ? null : (
        <p className="text-muted-foreground min-w-0 text-xs leading-relaxed">
          {caveats.join(' · ')}
        </p>
      )}
    </Strip>
  );
}

/**
 * AN INFORMATION LINE, NOT A CARD.
 *
 * The strip was a bordered `bg-card` panel with its own radius and shadow-less
 * fill, sitting between the toolbar and the journal — so the page opened with
 * three stacked framed bands before the first trade, and the summary looked like
 * a small dashboard rather than a caption on the list beneath it.
 *
 * It is unboxed now: the same facts, the same order, the same coverage
 * qualifier, with no border, no fill and no radius. It reads as a line ABOUT the
 * journal, which is what it is, and the journal's own card is left as the one
 * framed surface on the page.
 */
function Strip({ children, className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      aria-label="Journal summary"
      className={cn('flex min-w-0 items-center px-1 pt-1 pb-0.5', className)}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * The coverage sentence for a partial figure, or `null` when the figure covers
 * everything it claims to.
 *
 * IT COUNTS WHAT IS MISSING, NOT THE POPULATION ARITHMETIC. The line used to
 * read "109 of 111 closed trades have monetary results · 2 not recorded" —
 * three numbers and a division for a reader who wanted one fact. "2 closed
 * trades missing P&L" is that fact. The full population is still correct and
 * still derived from the closed set rather than the matching set, and it stays
 * available in the query model for anyone who needs it; what changed is that the
 * strip no longer makes every reader do the subtraction.
 */
function coverageOf(copy: PrototypeCopy, figure: SummaryFigure, template: string): string | null {
  if (figure.kind !== 'known_total' || figure.missing === 0) return null;
  // "1 closed trades missing R" is not a sentence. The Thai template carries no
  // `{trades}` placeholder — Thai nouns do not inflect for number — so `fill`
  // simply leaves the extra value unused there.
  return fill(template, { count: figure.missing });
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
      {figure.kind === 'total' || figure.kind === 'known_total' ? (
        <span className={cn('numeric text-base font-semibold', TONE_CLASS[figure.tone])}>
          {figure.text}
        </span>
      ) : (
        <span className="text-foreground font-medium">
          {figure.kind === 'no_closed'
            ? copy.summaryNoClosedTrades
            : figure.kind === 'mixed_currency'
              ? copy.summaryMultipleCurrencies
              : copy.summaryNotRecorded}
        </span>
      )}
      {/* Mixed currency is the one unavailable state with an ACTION attached:
          the reader can resolve it themselves by narrowing to one account. */}
      {figure.kind === 'mixed_currency' ? (
        <span className="text-muted-foreground text-xs">{copy.summarySelectOneAccount}</span>
      ) : null}
    </p>
  );
}
