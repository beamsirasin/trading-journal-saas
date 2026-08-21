import { ArrowRight, GitCompareArrows, ListChecks, MonitorCog, UserRound } from 'lucide-react';
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
}: {
  account: ActiveTradingAccountSummary;
  overview: DashboardOverview;
  recentTrades: readonly DashboardRecentTrade[];
  attention: TradeAttentionCounts;
}) {
  const t = useTranslations('dashboard.real');

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <ActiveTradingAccountSummaryCard account={account} />
      <NeedsAttentionPanel attention={attention} />

      <section aria-labelledby="performance-heading" className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h2 id="performance-heading" className="text-xl font-semibold tracking-tight">
              {t('performanceTitle')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {t('performanceDescription', { account: account.name })}
            </p>
          </div>
          <DashboardRangeControl selected={overview.scope.datePreset} />
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <PerformancePanel
            series="system"
            title={t('system.title')}
            description={t('system.description')}
            metrics={overview.system}
          />
          <PerformancePanel
            series="trader"
            title={t('trader.title')}
            description={t('trader.description')}
            metrics={overview.trader}
          />
        </div>
      </section>

      <ComparisonPanel comparison={overview.comparison} />
      <RecentTrades trades={recentTrades} />

      <div className="flex justify-end">
        <Link
          href="/app/analytics"
          className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
        >
          {t('viewFullAnalytics')} <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function DashboardRangeControl({ selected }: { selected: AnalyticsDatePreset }) {
  const t = useTranslations('dashboard.real');
  return (
    <nav aria-label={t('dateRangeLabel')} className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-label uppercase">{t('dateRangeLabel')}</span>
      <div className="border-border bg-muted/50 inline-flex w-fit max-w-full flex-wrap rounded-lg border p-1">
        {RANGE_ORDER.map((range) => (
          <Link
            key={range}
            href={`/app?range=${range}`}
            aria-current={range === selected ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-11 min-w-14 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2',
              range === selected
                ? 'bg-background text-foreground shadow-sm'
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
  title,
  description,
  metrics,
}: {
  series: 'system' | 'trader';
  title: string;
  description: string;
  metrics: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
}) {
  const t = useTranslations('dashboard.real');
  const Icon = series === 'system' ? MonitorCog : UserRound;
  return (
    <Card
      data-dashboard-panel={series}
      className={cn(
        'overflow-hidden border-t-4',
        series === 'system' ? 'border-t-system' : 'border-t-trader',
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg',
                series === 'system' ? 'bg-system/10 text-system' : 'bg-trader/10 text-trader',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription className="mt-1 leading-relaxed">{description}</CardDescription>
            </div>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-medium">
            {t('sampleCount', { count: metrics.sampleCount })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {metrics.sampleCount === 0 ? (
          <p className="border-border bg-muted/40 text-muted-foreground mb-4 rounded-md border p-3 text-sm">
            {series === 'system' ? t('system.empty') : t('trader.empty')}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          <DashboardMetric
            className="col-span-2 border-b pb-5"
            label={t('totalR')}
            metric={metrics.totalR}
            style="r"
            prominent
          />
          <DashboardMetric label={t('expectancy')} metric={metrics.expectancyR} style="r" />
          <DashboardMetric label={t('winRate')} metric={metrics.winRate} style="percent" />
          <DashboardMetric label={t('profitFactor')} metric={metrics.profitFactor} style="factor" />
        </dl>
      </CardContent>
    </Card>
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
    <section aria-labelledby="needs-attention-heading">
      <Card data-dashboard-panel="needs-attention" className="overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <ListChecks className="size-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle id="needs-attention-heading">{t('needsAttention.title')}</CardTitle>
              <CardDescription className="mt-1 leading-relaxed">
                {t('needsAttention.description')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {items
              .filter((item) => item.count > 0)
              .map((item) => (
                <div key={item.key} className="flex min-w-0 flex-col gap-1.5">
                  <MetricLabel>{t(`needsAttention.${item.key}`)}</MetricLabel>
                  <span className="numeric text-2xl font-semibold">{item.count}</span>
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
        </CardContent>
      </Card>
    </section>
  );
}

function ComparisonPanel({ comparison }: { comparison: DashboardOverview['comparison'] }) {
  const t = useTranslations('dashboard.real');
  return (
    <section aria-labelledby="comparison-heading">
      <Card data-dashboard-panel="comparison" className="overflow-hidden">
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <GitCompareArrows className="size-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle id="comparison-heading">{t('comparison.title')}</CardTitle>
              <CardDescription className="mt-1 leading-relaxed">
                {t('comparison.description')}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-5 sm:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <MetricLabel>{t('comparableTrades')}</MetricLabel>
              <span className="numeric text-2xl font-semibold">{comparison.comparableCount}</span>
            </div>
            <DashboardMetric
              label={t('executionGap')}
              metric={comparison.averageExecutionGapR}
              style="r"
              forceNeutral
            />
            <DashboardMetric
              label={t('executionEfficiency')}
              metric={comparison.executionEfficiency}
              style="percent"
              forceNeutral
            />
          </dl>
          <p className="text-muted-foreground mt-5 text-xs leading-relaxed">
            {t('comparison.help')}
          </p>
        </CardContent>
      </Card>
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
          <p className="text-muted-foreground mt-1 text-sm">{t('recent.description')}</p>
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
        <ul className="grid gap-3" aria-label={t('recent.listLabel')}>
          {trades.map((trade) => (
            <li key={trade.tradeId} className="border-border bg-card rounded-lg border p-4">
              <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1.25fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <Link
                    href={`/app/trades?trade=${trade.tradeId}`}
                    className="focus-visible:ring-ring inline-flex min-h-11 items-center rounded-md text-base font-semibold outline-none focus-visible:ring-2"
                  >
                    {trade.symbol}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {tTrades(`direction.${trade.direction}`)} · {trade.occurredAtDisplay}
                  </p>
                </div>
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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
                  <TradeStatusBadge status={trade.status} />
                  <RecentR label={t('recent.actualR')} value={trade.actualR} />
                  <RecentR label={t('recent.systemR')} value={trade.systemR} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecentR({ label, value }: { label: string; value: string | null }) {
  const t = useTranslations('dashboard.real');
  const formatted =
    value === null ? null : formatAnalyticsMetric({ status: 'available', value }, 'r');
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-[11px] font-medium uppercase">{label}</span>
      <span className="numeric text-sm font-semibold">
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
