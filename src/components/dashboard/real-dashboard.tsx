import { ArrowRight, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import type {
  AnalyticsMetric,
  AnalyticsUnavailableReason,
  DashboardOverview,
  PerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import {
  formatAnalyticsMetric,
  type AnalyticsDisplayStyle,
  type AnalyticsDisplayTone,
} from '@/lib/analytics/presentation';
import { cn } from '@/lib/utils';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';
import type { TradeAttentionCounts, TradeListItem } from '@/server/dal/trades';
import { ActiveTradingAccountSummaryCard } from '@/components/dashboard/empty-trading-dashboard';
import { MetricLabel, MetricValue } from '@/components/product/metric';
import { TradeStatusBadge } from '@/components/trades/trade-status-badge';
import { TradingCalendar, type TradingCalendarProps } from '@/components/trades/trading-calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export type DashboardRecentTrade = TradeListItem & { readonly occurredAtDisplay: string };

const RANGE_ORDER: readonly AnalyticsDatePreset[] = ['30d', '90d', 'all'];
const RANGE_KEY = { '30d': 'range30', '90d': 'range90', all: 'rangeAll' } as const;

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

export function RealDashboard({
  account,
  overview,
  recentTrades,
  attention,
  calendar,
}: {
  account: ActiveTradingAccountSummary;
  overview: DashboardOverview;
  recentTrades: readonly DashboardRecentTrade[];
  attention: TradeAttentionCounts;
  calendar?: TradingCalendarProps;
}) {
  const t = useTranslations('dashboard.real');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ActiveTradingAccountSummaryCard account={account} />

      <section aria-labelledby="performance-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="performance-heading" className="text-xl font-semibold tracking-tight">
              {t('performanceTitle')}
            </h2>
          </div>
          <DashboardRangeControl selected={overview.scope.datePreset} />
        </div>

        <HeadlineMetrics overview={overview} />
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)]">
        {calendar === undefined ? null : <TradingCalendar {...calendar} compact />}
        <NeedsAttentionPanel attention={attention} />
      </div>

      <RecentTrades trades={recentTrades} />
      <PerformanceWorkspace overview={overview} />
    </div>
  );
}

function HeadlineMetrics({ overview }: { overview: DashboardOverview }) {
  const t = useTranslations('dashboard.real');
  return (
    <div
      data-dashboard-panel="headline-metrics"
      className="border-border bg-card grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4 sm:divide-x"
    >
      <div className="border-border border-b p-4 sm:border-b-0">
        <DashboardMetric
          label={t('trader.title')}
          metric={overview.trader.totalR}
          style="r"
          prominent
        />
      </div>
      <div className="border-border border-b border-l p-4 sm:border-b-0 sm:border-l-0">
        <DashboardMetric
          label={t('system.title')}
          metric={overview.system.totalR}
          style="r"
          prominent
        />
      </div>
      <div className="p-4">
        <DashboardMetric
          label={t('winRate')}
          metric={overview.trader.winRate}
          style="percent"
          prominent
          forceNeutral
        />
      </div>
      <div className="border-border border-l p-4 sm:border-l-0">
        <DashboardMetric
          label={t('executionGap')}
          metric={overview.comparison.averageExecutionGapR}
          style="r"
          prominent
          forceNeutral
        />
      </div>
    </div>
  );
}

function DashboardRangeControl({ selected }: { selected: AnalyticsDatePreset }) {
  const t = useTranslations('dashboard.real');
  return (
    <nav aria-label={t('dateRangeLabel')} className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-label uppercase">{t('dateRangeLabel')}</span>
      <div className="border-border bg-surface inline-flex w-fit max-w-full flex-wrap rounded-lg border p-1">
        {RANGE_ORDER.map((range) => (
          <Link
            key={range}
            href={`/app?range=${range}`}
            aria-current={range === selected ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-11 min-w-14 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2',
              range === selected
                ? 'bg-primary/12 text-primary'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(RANGE_KEY[range])}
          </Link>
        ))}
      </div>
    </nav>
  );
}

function PerformancePanel({
  series,
  metrics,
}: {
  series: 'system' | 'trader';
  metrics: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
}) {
  const t = useTranslations('dashboard.real');
  return (
    <section data-dashboard-panel={series} className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b pb-3">
        <h3 className="text-sm font-semibold">{t(`${series}.title`)}</h3>
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-medium">
          {t('sampleCount', { count: metrics.sampleCount })}
        </span>
      </div>
      {metrics.sampleCount === 0 ? (
        <p className="text-muted-foreground py-4 text-sm">
          {series === 'system' ? t('system.empty') : t('trader.empty')}
        </p>
      ) : null}
      <dl className="grid grid-cols-3 gap-3 pt-4">
        <DashboardMetric label={t('expectancy')} metric={metrics.expectancyR} style="r" />
        <DashboardMetric label={t('winRate')} metric={metrics.winRate} style="percent" />
        <DashboardMetric label={t('profitFactor')} metric={metrics.profitFactor} style="factor" />
      </dl>
    </section>
  );
}

/**
 * Four independent, informational counts (Phase 14C §18) — never a combined
 * "completeness score" (CLAUDE.md's Discipline Score precedent applies
 * equally here). Each count links to the Journal, where a trader can
 * actually act on it; the panel itself never blocks or nags. Definitions:
 * `openTrades` = `status = 'open'`; `pendingSystemOutcomes` =
 * `system_status = 'pending'`; `unclassifiedTrades` = `strategy_id IS NULL`
 * (Phase 14B); `reviewsPending` = `status = 'closed' AND review_notes IS
 * NULL` — see `getWorkspaceTradeAttentionCounts` (`src/server/dal/trades.ts`)
 * for the exact query.
 */
function NeedsAttentionPanel({ attention }: { attention: TradeAttentionCounts }) {
  const t = useTranslations('dashboard.real');
  const total =
    attention.openTrades +
    attention.pendingSystemOutcomes +
    attention.unclassifiedTrades +
    attention.reviewsPending +
    attention.needsExecutionDetails;
  if (total === 0) return null;

  const items: readonly { readonly key: string; readonly count: number }[] = [
    { key: 'openTrades', count: attention.openTrades },
    { key: 'pendingSystemOutcomes', count: attention.pendingSystemOutcomes },
    { key: 'unclassifiedTrades', count: attention.unclassifiedTrades },
    { key: 'reviewsPending', count: attention.reviewsPending },
    // Phase 14E — legacy/internal `planned` rows only; zero (and hidden via
    // the `count > 0` filter below) for every workspace with none.
    { key: 'needsExecutionDetails', count: attention.needsExecutionDetails },
  ];

  return (
    <section
      aria-labelledby="needs-attention-heading"
      data-dashboard-panel="needs-attention"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <ListChecks className="text-primary size-4" aria-hidden="true" />
        <h2 id="needs-attention-heading" className="text-sm font-semibold">
          {t('needsAttention.title')}
        </h2>
        <span className="bg-warning/10 text-warning numeric ml-auto rounded-full px-2 py-0.5 text-xs font-semibold">
          {total}
        </span>
      </div>
      <div className="p-4">
        <dl className="divide-border divide-y">
          {items
            .filter((item) => item.count > 0)
            .map((item) => (
              <div
                key={item.key}
                className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <MetricLabel>{t(`needsAttention.${item.key}`)}</MetricLabel>
                <span className="numeric text-lg font-semibold">{item.count}</span>
              </div>
            ))}
        </dl>
        <div className="mt-5">
          <Link
            href="/app/trades"
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('needsAttention.review')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function PerformanceWorkspace({ overview }: { overview: DashboardOverview }) {
  const t = useTranslations('dashboard.real');
  return (
    <section
      aria-labelledby="comparison-heading"
      className="border-border bg-card overflow-hidden rounded-lg border"
    >
      <div className="border-border flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <h2 id="comparison-heading" className="text-base font-semibold">
          {t('comparison.title')}
        </h2>
        <Link href="/app/analytics" className="text-primary text-sm font-medium">
          {t('viewFullAnalytics')}
        </Link>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[1fr_1fr_1.15fr] lg:divide-x">
        <PerformancePanel series="trader" metrics={overview.trader} />
        <PerformancePanel series="system" metrics={overview.system} />
        <div
          data-dashboard-panel="comparison"
          className="border-border border-t p-4 sm:p-5 lg:border-t-0"
        >
          <h3 className="border-border border-b pb-3 text-sm font-semibold">{t('executionGap')}</h3>
          <dl className="grid grid-cols-3 gap-3 pt-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <MetricLabel>{t('comparableTrades')}</MetricLabel>
              <span className="numeric text-2xl font-semibold">
                {overview.comparison.comparableCount}
              </span>
            </div>
            <DashboardMetric
              label={t('executionGap')}
              metric={overview.comparison.averageExecutionGapR}
              style="r"
              forceNeutral
            />
            <DashboardMetric
              label={t('executionEfficiency')}
              metric={overview.comparison.executionEfficiency}
              style="percent"
              forceNeutral
            />
          </dl>
        </div>
      </div>
    </section>
  );
}

function DashboardMetric({
  label,
  metric,
  style,
  prominent = false,
  forceNeutral = false,
  className,
}: {
  label: string;
  metric: AnalyticsMetric;
  style: AnalyticsDisplayStyle;
  prominent?: boolean;
  forceNeutral?: boolean;
  className?: string;
}) {
  const t = useTranslations('dashboard.real');
  const formatted = formatAnalyticsMetric(metric, style);
  return (
    <div
      data-metric={label}
      data-metric-status={formatted.status}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      <dt>
        <MetricLabel>{label}</MetricLabel>
      </dt>
      <dd>
        {formatted.status === 'available' ? (
          <MetricValue
            value={formatted.text}
            className={cn(
              prominent ? 'text-3xl' : 'text-xl',
              forceNeutral ? 'text-foreground' : TONE_CLASS[formatted.tone],
            )}
          />
        ) : (
          <span className="text-muted-foreground text-sm leading-snug">
            {formatted.status === 'error'
              ? t('unavailable.data_integrity_error')
              : t(`unavailable.${formatted.reason as AnalyticsUnavailableReason}`)}
          </span>
        )}
      </dd>
    </div>
  );
}

function RecentTrades({ trades }: { trades: readonly DashboardRecentTrade[] }) {
  const t = useTranslations('dashboard.real');
  const tTrades = useTranslations('trades');
  return (
    <section aria-labelledby="recent-trades-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="recent-trades-heading" className="text-xl font-semibold tracking-tight">
            {t('recent.title')}
          </h2>
        </div>
        <Link
          href="/app/trades"
          className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('recent.viewAll')} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {trades.length === 0 ? (
        <div className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-5">
          <p className="font-medium">{t('recent.emptyTitle')}</p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {t('recent.emptyDescription')}
          </p>
          <Link
            href="/app/trades/new"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('recent.logTrade')}
          </Link>
        </div>
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-lg border">
          <div className="bg-surface text-muted-foreground hidden grid-cols-[minmax(8rem,1fr)_minmax(9rem,1.2fr)_7rem_7rem_minmax(8rem,1fr)_auto] gap-3 border-b px-4 py-2 text-[11px] font-semibold tracking-wider uppercase md:grid">
            <span>{tTrades('list.date')}</span>
            <span>{tTrades('list.trade')}</span>
            <span className="text-right">{tTrades('list.actual')}</span>
            <span className="text-right">{tTrades('list.system')}</span>
            <span>{tTrades('list.strategy')}</span>
            <span>{tTrades('list.action.label')}</span>
          </div>
          <ul className="divide-border divide-y" aria-label={t('recent.listLabel')}>
            {trades.map((trade) => (
              <li
                key={trade.tradeId}
                className="hover:bg-primary/[0.04] px-4 py-2 transition-colors"
              >
                <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(8rem,1fr)_minmax(9rem,1.2fr)_7rem_7rem_minmax(8rem,1fr)_auto] md:items-center">
                  <p className="text-muted-foreground text-xs">{trade.occurredAtDisplay}</p>
                  <div className="min-w-0">
                    <Link
                      href={`/app/trades?trade=${trade.tradeId}`}
                      className="focus-visible:ring-ring inline-flex min-h-9 items-center rounded-md text-sm font-bold outline-none focus-visible:ring-2"
                    >
                      {trade.symbol}
                    </Link>
                    <p className="text-muted-foreground text-xs">
                      {tTrades(`direction.${trade.direction}`)}
                    </p>
                  </div>
                  <RecentR label={t('recent.actualR')} value={trade.actualR} />
                  <RecentR label={t('recent.systemR')} value={trade.systemR} />
                  <div className="min-w-0 text-sm">
                    {trade.strategyName === null ? (
                      <p className="text-muted-foreground break-words">
                        {tTrades('common.notAssigned')}
                      </p>
                    ) : (
                      <>
                        <p className="font-medium break-words">{trade.strategyName}</p>
                        {trade.setupName === null ? null : (
                          <p className="text-muted-foreground break-words">{trade.setupName}</p>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 md:justify-end">
                    <TradeStatusBadge status={trade.status} />
                    <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function RecentR({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('dashboard.real');
  const formatted =
    value === null ? null : formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <span className="flex items-center justify-between gap-2 md:justify-end">
      <span className="text-muted-foreground text-[11px] font-medium uppercase md:hidden">
        {label}
      </span>
      <span className="numeric text-sm font-semibold md:text-right">
        {formatted?.status === 'available' ? formatted.text : t('notAvailableShort')}
      </span>
    </span>
  );
}

export function DashboardDataError() {
  const t = useTranslations('dashboard.real');
  return (
    <Card role="alert">
      <CardHeader>
        <CardTitle>{t('error.title')}</CardTitle>
        <CardDescription>{t('error.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Link
          href="/app"
          className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('error.retry')}
        </Link>
      </CardContent>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-8" aria-hidden="true">
      <div className="border-border bg-card h-40 rounded-lg border" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="border-border bg-card h-80 rounded-lg border" />
        <div className="border-border bg-card h-80 rounded-lg border" />
      </div>
      <div className="border-border bg-card h-48 rounded-lg border" />
      <div className="space-y-3">
        <div className="bg-muted h-7 w-40 rounded-md" />
        <div className="border-border bg-card h-24 rounded-lg border" />
        <div className="border-border bg-card h-24 rounded-lg border" />
      </div>
    </div>
  );
}
