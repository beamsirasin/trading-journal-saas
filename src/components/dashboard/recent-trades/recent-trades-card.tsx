import { ArrowRight, History } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { DashboardRecentExecutionGap, DashboardRecentTrade } from '@/lib/dashboard/page-data';
import { dashboardLayoutItem, dashboardWidgetAttributes } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradeStatusBadge } from '@/components/trades/trade-status-badge';
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
 * D2's scope is untouched: the same five Trades, the same `occurred_at`
 * ordering, the same Account/date/Strategy/Setup filters. What changes is the
 * shape. Through D5 this was a full-bleed three-column band that gave symbol,
 * Strategy and two R values equal weight and left the Execution Gap off the
 * row entirely, so the one number the product exists to surface was the one
 * number a reader had to open a Trade to find.
 *
 * The hierarchy is now explicit: identity first, then the three results as a
 * fixed triple — Actual, System, Gap — reading left to right in the order the
 * attribution argument is made. Strategy, Setup and the occurred time are
 * supporting context and are typeset as such. It is a compact record list,
 * deliberately not an enterprise data table: no column headers, no sorting, no
 * pagination. The Journal is one link away and owns all three.
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-primary/10 text-primary mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg">
              <History className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id={headingId} className="text-card-title">
                {t('recent.title')}
              </h2>
              <p className="text-muted-foreground mt-0.5 text-sm leading-snug text-pretty">
                {t('recent.description')}
              </p>
            </div>
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
          <ul className="flex min-w-0 flex-col gap-2" aria-label={t('recent.listLabel')}>
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
  const tTrades = useTranslations('trades');
  const occurred = formatTradeInstant(trade.occurredAt, timezone, dateLocale) ?? '—';

  return (
    <li
      data-recent-trade-row={trade.tradeId}
      className="border-border bg-muted/25 hover:bg-muted/45 min-w-0 rounded-lg border transition-colors"
    >
      <div className="grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/app/trades?trade=${trade.tradeId}`}
              className="focus-visible:ring-ring rounded-md text-sm font-semibold outline-none focus-visible:ring-2"
            >
              {trade.symbol}
            </Link>
            <span className="text-muted-foreground text-xs">
              {tTrades(`direction.${trade.direction}`)}
            </span>
            <TradeStatusBadge status={trade.status} />
          </div>
          {/*
            Supporting context, typeset as supporting context. An unclassified
            Trade says so rather than borrowing a neighbour's Strategy name.
          */}
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {trade.strategyName === null
              ? tTrades('common.notAssigned')
              : trade.setupName === null
                ? trade.strategyName
                : `${trade.strategyName} · ${trade.setupName}`}
            {' · '}
            {occurred}
          </p>
        </div>

        <div className="flex min-w-0 shrink-0 items-start gap-4 sm:justify-end">
          <RecentR label={t('recent.actualR')} value={trade.actualR} />
          <RecentR label={t('recent.systemR')} value={trade.systemR} />
          <RecentGap gap={trade.executionGapR} />
        </div>
      </div>
    </li>
  );
}

function RecentR({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('dashboard.real');
  const formatted =
    value === null ? null : formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <span className="flex min-w-14 flex-col gap-0.5">
      <span className="text-muted-foreground text-[10px] font-medium uppercase">{label}</span>
      <span className="numeric text-sm font-semibold">
        {formatted?.status === 'available' ? formatted.text : t('notAvailableShort')}
      </span>
    </span>
  );
}

/**
 * The Execution Gap, from the state D5A already resolved.
 *
 * `Actual R − System R` is NOT re-derived here — not from the two values on
 * this very row, not anywhere in React. The three states are the composer's:
 * an available signed R, a truthful unresolved reason (which side is missing),
 * or an explicit integrity error. A Trade whose System side is still pending
 * keeps its row and says so; it never renders a 0.00R Gap, which would assert
 * perfect execution on a comparison that has not happened yet.
 */
function RecentGap({ gap }: { gap: DashboardRecentExecutionGap }) {
  const t = useTranslations('dashboard.real');
  const formatted =
    gap.status === 'available'
      ? formatAnalyticsMetric({ status: 'available', value: gap.value }, 'r')
      : null;

  return (
    <span className="flex min-w-14 flex-col gap-0.5" data-recent-gap-status={gap.status}>
      <span className="text-muted-foreground text-[10px] font-medium uppercase">
        {t('recent.gapR')}
      </span>
      {formatted !== null && formatted.status === 'available' ? (
        <span
          className={cn(
            'numeric text-sm font-semibold',
            formatted.tone === 'positive' && 'text-positive',
            formatted.tone === 'negative' && 'text-negative',
          )}
        >
          {formatted.text}
        </span>
      ) : (
        <span
          className={cn(
            'text-xs leading-5 font-medium',
            gap.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={
            gap.status === 'unavailable'
              ? t(`recent.gapUnavailable.${gap.reason}`)
              : t('recent.gapError')
          }
        >
          {gap.status === 'unavailable' ? t('recent.gapPending') : t('recent.gapErrorShort')}
        </span>
      )}
    </span>
  );
}
