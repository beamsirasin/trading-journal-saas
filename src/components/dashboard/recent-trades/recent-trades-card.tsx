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
 * THE LIST IS TWELVE ROWS, AND IT SCROLLS. Five, then seven, were each
 * chosen against the row height of the day (67px, then 44px). Twelve is
 * chosen against the Calendar beside it: that widget is a fixed six-week
 * grid at 630px, this card was 413px, and the 217px of empty column between
 * them was the largest blank surface on the page. Twelve rows bring the two
 * columns to within 8px (`selectDashboardRecentTrades` carries the
 * arithmetic), and the capped, scrolling list keeps that from becoming a new
 * kind of wrong if either side's height changes.
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
              it. The projection returns twelve rows, which is sized to land
              this column within 8px of the Calendar's fixed six-week grid
              (see `selectDashboardRecentTrades`). The cap is what keeps that
              true in the other direction: a month that renders five weeks
              instead of six, or a future header change, shortens the
              Calendar without leaving this card standing proud of it.

              `max-h-[33.75rem]` is twelve 45px rows exactly, so at the
              designed count nothing scrolls and no scrollbar appears; it
              only engages if the row height or the count later grows.
              `overscroll-contain` so reaching the end does not start
              scrolling the page underneath.
            */
            className="divide-border border-border -mx-1 flex max-h-[33.75rem] min-w-0 flex-col divide-y overflow-y-auto overscroll-contain border-t"
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
  const occurredDay = formatTradeDay(trade.occurredAt, timezone, dateLocale);
  const formatted =
    trade.actualR === null
      ? null
      : formatAnalyticsMetric({ status: 'available', value: trade.actualR }, 'r');
  const resultText =
    formatted !== null && formatted.status === 'available'
      ? formatted.text
      : t('notAvailableShort');

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
          Right-aligned and tone-coloured, which is the one place on this row
          colour is allowed to do work — and it never does it alone, because
          the sign is in the text. A Trade with no final Actual result prints
          the neutral unavailable marker rather than a 0.00R that would claim
          a flat outcome that has not happened.
        */}
        <span
          data-recent-trade-result={formatted?.status === 'available' ? 'available' : 'unavailable'}
          className={cn(
            'numeric shrink-0 text-right text-sm font-semibold',
            formatted?.status === 'available' && formatted.tone === 'positive' && 'text-positive',
            formatted?.status === 'available' && formatted.tone === 'negative' && 'text-negative',
            formatted?.status !== 'available' && 'text-muted-foreground',
          )}
        >
          {resultText}
        </span>
      </Link>
    </li>
  );
}
