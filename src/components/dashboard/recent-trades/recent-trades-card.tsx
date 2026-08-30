import { ArrowRight, History } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { DashboardRecentTrade } from '@/lib/dashboard/page-data';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { formatTradeDay } from '@/components/trades/trade-format';
import { Card } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

const LAYOUT = dashboardLayoutItem('trades.recent');

export interface RecentTradesCardProps {
  readonly trades: readonly DashboardRecentTrade[];
  readonly timezone: string;
  readonly dateLocale: string;
  readonly className?: string;
}

/**
 * D6B — Recent Trades.
 *
 * D2's scope is untouched — the same `occurred_at` ordering and the same
 * Account/date/Strategy/Setup filters. Two things change in this pass.
 *
 * THE ROW IS THREE FIELDS. See `RecentTradeRow` for the full reasoning; in
 * short, the measured benchmark's Dashboard trade preview shows three columns
 * against its own Trade View's ten, and this card had drifted to eight.
 *
 * THE LIST IS ELEVEN ROWS, AND IT SCROLLS. Five, then seven, were each
 * chosen against the row height of the day (67px, then 44px). Eleven is
 * chosen against the Calendar beside it, which is a fixed six-week grid this
 * card cannot influence: at seven rows this card was 413px against 630px and
 * the 217px of empty column between them was the largest blank surface on
 * the page. `selectDashboardRecentTrades` carries the arithmetic and the
 * reason the count moved from twelve. The capped, scrolling list is what
 * keeps a future height change on either side from reopening the gap.
 *
 * It is a compact record list, deliberately not an enterprise data table: no
 * column headers, no sorting, no pagination. The Journal is one link away and
 * owns all three.
 */
export function RecentTradesCard({
  trades,
  timezone,
  dateLocale,
  className,
}: RecentTradesCardProps) {
  const t = useTranslations('dashboard.real');
  const headingId = 'recent-trades-heading';

  return (
    <section
      {...dashboardWidgetAttributes(LAYOUT)}
      aria-labelledby={headingId}
      data-recent-trades-count={trades.length}
      className={cn('min-w-0', className)}
    >
      <Card
        data-dashboard-panel="recent-trades"
        className="flex h-full min-w-0 flex-col gap-4 p-4 sm:p-5"
      >
        {/*
          TITLE · ACTION. The description said "The five most recent Trades in
          the active account" — a sentence restating the card's own title, the
          row count a reader can see, and the account named twice above. The
          benchmark's equivalent card carries a title, a tab and a "View More"
          link and no prose at all.
        */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
              <History className="size-4.5" aria-hidden="true" />
            </span>
            <h2 id={headingId} className="text-card-title min-w-0 truncate">
              {t('recent.title')}
            </h2>
          </div>
          <Link
            href="/app/trades"
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-2 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('recent.viewAll')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        {trades.length === 0 ? (
          <div
            data-recent-trades-state="empty"
            className="border-border flex min-w-0 flex-col items-start gap-2 rounded-lg border border-dashed p-4"
          >
            <p className="text-sm font-medium">{t('recent.emptyTitle')}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t('recent.emptyDescription')}
            </p>
            <Link
              href="/app/trades/new"
              className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring mt-1 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
            >
              {t('recent.logTrade')}
            </Link>
          </div>
        ) : (
          <ul
            /*
              A CAPPED, SCROLLING LIST — the benchmark's own pattern for this
              card, and the thing that decouples it from the Calendar beside
              it. The projection returns eleven rows, sized to land this
              column beside the Calendar's fixed six-week grid (see
              `selectDashboardRecentTrades`). The cap is what keeps that true
              in the other direction: a month that renders five weeks instead
              of six shortens the Calendar without leaving this card standing
              proud of it.

              `max-h-[30.9375rem]` is eleven 45px rows exactly, so at the
              designed count nothing scrolls and no scrollbar appears; it
              only engages if the row height or the count later grows.
              `overscroll-contain` so reaching the end does not start
              scrolling the page underneath.
            */
            className="divide-border border-border -mx-1 flex max-h-[30.9375rem] min-w-0 flex-col divide-y overflow-y-auto overscroll-contain border-t"
            aria-label={t('recent.listLabel')}
          >
            {trades.map((trade) => (
              <RecentTradeRow
                key={trade.tradeId}
                trade={trade}
                timezone={timezone}
                dateLocale={dateLocale}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

/**
 * One row: DATE · SYMBOL · ACTUAL R. Three fields, and deliberately no
 * fourth.
 *
 * THIS IS THE PASS'S LARGEST CUT, AND IT IS A DELIBERATE ONE. The row used to
 * carry eight visible fields — symbol, direction, a status chip, the Strategy
 * and Setup names, the occurred timestamp, Actual R, System R and the
 * Execution Gap — inside a card that is a PREVIEW. The measured benchmark
 * shows exactly the opposite discipline: its Dashboard table renders three
 * columns (Close Date, Symbol, Net P&L) while the same product's full Trade
 * View renders ten. The Dashboard list is a teaser that answers "what
 * happened lately"; everything else is one click away.
 *
 * WHICH THREE, FOR THIS PRODUCT. Date and Symbol map straight across. The
 * benchmark's third column is Net P&L, which TradeChemist's Recent Trades
 * projection does not carry and must not invent (§35) — the canonical
 * per-Trade result on this payload is `actualR`, the Trader-performance
 * figure, so that is the one primary value the row shows.
 *
 * WHAT LEFT, AND WHERE IT WENT. System R and the per-Trade Execution Gap are
 * still on the Dashboard — the Execution Gap section directly above this one
 * publishes both as totals and averages over the paired population, with the
 * daily series and the distribution. Strategy, Setup, direction and status
 * belong to the Trade record and are on the Trade itself, which is where this
 * row goes. Nothing is unreachable; it is reached in one action instead of
 * being printed five times over.
 *
 * THE WHOLE ROW IS THE TARGET. It was a text-sized link on the symbol inside
 * a hover-tinted list item, which is a hover affordance promising a click
 * area it did not have. With the row reduced to three fields there is no
 * other interactive element left in it to nest against, so the row itself is
 * the link — same destination as before (`/app/trades?trade=<id>`, the Trade
 * quick preview), a real 44px touch target, and one tab stop instead of one
 * per row plus a decoy.
 */
function RecentTradeRow({
  trade,
  timezone,
  dateLocale,
}: {
  trade: DashboardRecentTrade;
  timezone: string;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.real');
  const tExecution = useTranslations('trades.status.execution');
  const occurredDay = formatTradeDay(trade.occurredAt, timezone, dateLocale);
  const formatted =
    trade.actualR === null
      ? null
      : formatAnalyticsMetric({ status: 'available', value: trade.actualR }, 'r');
  const hasResult = formatted !== null && formatted.status === 'available';

  /*
   * "NO RESULT YET" IS NOT ONE THING, AND THE ROW USED TO SAY IT WAS.
   *
   * Every row without an Actual R printed the same em dash. On a
   * twelve-row list that was a third of the card saying nothing at all —
   * and it was saying nothing about three genuinely different situations:
   * a `planned` Trade has no entry recorded, an `open` one is still
   * running, a `canceled` one never happened. Each of those is a real
   * answer to "why is there no number here", and the reader had to open
   * the Trade to get any of them.
   *
   * The labels are the Journal's own (`trades.status.execution`), not new
   * copy, so a row says exactly what the Trade page says about the same
   * Trade.
   *
   * A `closed` Trade with no Actual R keeps the dash, deliberately. There
   * is no state to name there — it is an incomplete record, and inventing
   * a reassuring label for a data gap would be the same fabrication as
   * printing 0.00R.
   */
  const pendingState = hasResult || trade.status === 'closed' ? null : trade.status;

  return (
    <li data-recent-trade-row={trade.tradeId} className="min-w-0">
      <Link
        href={`/app/trades?trade=${trade.tradeId}`}
        // `min-h-11` (44px), not the benchmark's measured ~45px by
        // coincidence. To be accurate about the standard, since this comment
        // previously was not: WCAG 2.5.8 Target Size (Minimum) is Level AA at
        // 24x24 CSS px, and 44x44 is 2.5.5 Target Size (Enhanced), Level AAA.
        // So 44px is not the AA floor — it is the AAA target, and it is also
        // this codebase's convention for every interactive row and control
        // (147 call sites). The row is the whole click target rather than a
        // word inside it, which is exactly the case where the enhanced size
        // is worth keeping. It happens to agree with the benchmark's rhythm,
        // so nothing is traded either way.
        className="hover:bg-muted/40 focus-visible:ring-ring grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-1 py-1.5 transition-colors outline-none focus-visible:ring-2"
      >
        <span className="numeric text-muted-foreground shrink-0 text-xs tabular-nums">
          {occurredDay ?? '—'}
        </span>
        <span className="min-w-0 truncate text-sm font-semibold">{trade.symbol}</span>
        {/*
          THE THIRD FIELD, IN THREE SHAPES — one slot, so the column still
          scans as a column.

          A finished Trade prints its R, right-aligned and tone-coloured;
          this is the one place on the row colour does work, and it never
          does it alone, because the sign is in the text. An unfinished one
          names its state. A closed Trade with no R prints the dash. What
          none of them do is print a 0.00R that would claim a flat outcome
          that has not happened.
        */}
        {hasResult ? (
          <span
            data-recent-trade-result="available"
            className={cn(
              'numeric shrink-0 text-right text-sm font-semibold',
              formatted.tone === 'positive' && 'text-positive',
              formatted.tone === 'negative' && 'text-negative',
            )}
          >
            {formatted.text}
          </span>
        ) : pendingState !== null ? (
          /*
            A LABEL, NOT A RESULT — so it must not look like one.
            Deliberately no positive/negative tone and no `numeric` face: an
            outcome has not happened, and borrowing the result colours would
            put a Trade that is still running into the same visual class as
            one that finished flat. A quiet outlined pill reads as state.
          */
          <span
            data-recent-trade-result="unavailable"
            data-recent-trade-state={pendingState}
            className="border-border text-muted-foreground shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap"
          >
            {tExecution(pendingState)}
          </span>
        ) : (
          <span
            data-recent-trade-result="unavailable"
            className="numeric text-muted-foreground shrink-0 text-right text-sm font-semibold"
          >
            {t('notAvailableShort')}
          </span>
        )}
      </Link>
    </li>
  );
}
