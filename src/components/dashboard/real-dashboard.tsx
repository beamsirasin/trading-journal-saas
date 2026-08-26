import { ArrowRight, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { buildDashboardHref, type DashboardFilterState } from '@/lib/dashboard/filters';
import type { DashboardPageData, DashboardRecentTrade } from '@/lib/dashboard/page-data';
import { composePerformanceCards } from '@/lib/dashboard/performance-card';
import {
  dashboardLayoutItem,
  dashboardWidgetAttributes,
  DEFAULT_DASHBOARD_LAYOUT,
  type DashboardWidgetId,
} from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { ActiveTradingAccountSummaryCard } from '@/components/dashboard/empty-trading-dashboard';
import { ExecutionGapSection } from '@/components/dashboard/execution-gap/execution-gap-section';
import { BasicKpiRow } from '@/components/dashboard/kpi/basic-kpi-row';
import { BASIC_KPI_GRID_CLASS, kpiSpanClassName } from '@/components/dashboard/kpi/kpi-widget-card';
import { PerformanceCard } from '@/components/dashboard/performance/performance-card';
import { MetricLabel } from '@/components/product/metric';
import { formatTradeInstant } from '@/components/trades/trade-format';
import { TradeStatusBadge } from '@/components/trades/trade-status-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

export type { DashboardRecentTrade } from '@/lib/dashboard/page-data';

const RANGE_ORDER: readonly AnalyticsDatePreset[] = ['30d', '90d', 'all'];
const RANGE_KEY = { '30d': 'range30', '90d': 'range90', all: 'rangeAll' } as const;

const BASIC_KPI_LAYOUT = DEFAULT_DASHBOARD_LAYOUT.filter((item) =>
  item.widgetId.startsWith('basic.'),
);

export function RealDashboard({
  data,
  dateLocale,
}: {
  data: DashboardPageData;
  dateLocale: string;
}) {
  const t = useTranslations('dashboard.real');
  const tFilters = useTranslations('dashboard.filters');
  const accountLabel =
    data.account.kind === 'account' ? data.account.account.name : tFilters('allAccounts');
  const performanceCards = composePerformanceCards(data);

  return (
    /*
      SECTION RHYTHM IS EXPLICIT, NOT ONE UNIFORM GAP.

      Through D4 every boundary on this page was the same `gap-8` (32px),
      which spends the same whitespace separating an account label from a KPI
      band as it does separating two analytical sections — and made the page
      read like a marketing layout rather than a data product. The margins
      below step up with the weight of the boundary they separate: 20px into
      the KPI band, 24px into Needs Attention, 28px into the analytical
      sections, 32px before the record list. `first:mt-0` keeps the top edge
      correct when the account context bar is absent (all-accounts scope).
    */
    <div className="flex min-w-0 flex-col">
      {data.account.kind === 'account' ? (
        <ActiveTradingAccountSummaryCard account={data.account.account} />
      ) : null}
      <BasicKpiRow data={data} className="mt-5 first:mt-0" />
      <NeedsAttentionPanel attention={data.attention.counts} className="mt-6" />

      <section aria-labelledby="performance-heading" className="mt-7 flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <h2 id="performance-heading" className="text-xl font-semibold tracking-tight">
              {t('performanceTitle')}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
              {t('performanceDescription', { account: accountLabel })}
            </p>
          </div>
          <DashboardRangeControl filters={data.filters} />
        </div>

        {/*
          Two equal halves, and `items-stretch` so both cards share a top edge
          and a height whatever each side's population contains. Since D4.5
          this grid AGREES with the layout metadata rather than contradicting
          it: `performance` is its own two-column section and each card spans
          one of its columns, so the retired 2+3-of-five reading is gone from
          both the page and the record it emits.
        */}
        <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-2">
          {performanceCards.map((model) => (
            <PerformanceCard key={model.widgetId} model={model} />
          ))}
        </div>
      </section>

      {/*
        D5B replaces D2's placeholder summary card with the real
        `execution.gap` widget. It still consumes only
        `DashboardPageData.comparison` — one server-composed Population C
        model, no fetch of its own — and it deliberately follows the D4 pair
        it explains rather than sitting between the KPI band and the
        baselines.
      */}
      <ExecutionGapSection comparison={data.comparison} dateLocale={dateLocale} className="mt-7" />
      <WidgetSlot widgetId="trades.recent" className="mt-8">
        <RecentTrades
          trades={data.recentTrades.items}
          timezone={data.scope.timezone}
          dateLocale={dateLocale}
        />
      </WidgetSlot>

      <div className="mt-6 flex justify-end">
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

function WidgetSlot({
  widgetId,
  className,
  children,
}: {
  widgetId: DashboardWidgetId;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      {...dashboardWidgetAttributes(dashboardLayoutItem(widgetId))}
      className={cn('min-w-0', className)}
    >
      {children}
    </div>
  );
}

function DashboardRangeControl({ filters }: { filters: DashboardFilterState }) {
  const t = useTranslations('dashboard.real');
  return (
    <nav aria-label={t('dateRangeLabel')} className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-label uppercase">{t('dateRangeLabel')}</span>
      <div className="border-border bg-muted/50 inline-flex w-fit max-w-full flex-wrap rounded-lg border p-1">
        {RANGE_ORDER.map((range) => (
          <Link
            key={range}
            href={buildDashboardHref({ ...filters, datePreset: range })}
            aria-current={range === filters.datePreset ? 'page' : undefined}
            className={cn(
              'focus-visible:ring-ring inline-flex min-h-11 min-w-14 items-center justify-center rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2',
              range === filters.datePreset
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
 *
 * D4.5 geometry: one bar, not a card with a header block and a four-column
 * grid under it. Through D4 this stood 243px tall — taller than the five KPI
 * cards it sits beneath — to say three numbers, and spread them across the
 * full page width. It is now header-plus-counts-plus-action on one desktop
 * row at roughly 88px. Every count, its label, the title, the supporting
 * sentence and the Review action survive that unchanged; the D2 scope
 * (`workspace_operational`) and the "no score, no invented category" rule
 * are untouched.
 *
 * It owns its own layout slot rather than being wrapped in one, because it
 * renders nothing at all when every count is zero — a wrapper would leave a
 * slot's worth of dead vertical space behind on exactly the workspace with
 * nothing to show.
 */
function NeedsAttentionPanel({
  attention,
  className,
}: {
  attention: DashboardPageData['attention']['counts'];
  className?: string;
}) {
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
      {...dashboardWidgetAttributes(dashboardLayoutItem('review.needs-attention'))}
      aria-labelledby="needs-attention-heading"
      className={cn('min-w-0', className)}
    >
      <Card
        data-dashboard-panel="needs-attention"
        className="flex min-w-0 flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
            <ListChecks className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <CardTitle id="needs-attention-heading">{t('needsAttention.title')}</CardTitle>
            <CardDescription className="leading-snug text-pretty">
              {t('needsAttention.description')}
            </CardDescription>
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3 sm:gap-x-8">
          <dl className="flex min-w-0 flex-wrap gap-x-6 gap-y-3 sm:gap-x-8">
            {items
              .filter((item) => item.count > 0)
              .map((item) => (
                <div key={item.key} className="flex min-w-0 flex-col gap-0.5">
                  <dt>
                    <MetricLabel className="leading-4">
                      {t(`needsAttention.${item.key}`)}
                    </MetricLabel>
                  </dt>
                  <dd className="numeric text-xl leading-7 font-semibold">{item.count}</dd>
                </div>
              ))}
          </dl>
          <Link
            href="/app/trades"
            className="text-primary hover:bg-primary/10 focus-visible:ring-ring inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none focus-visible:ring-2"
          >
            {t('needsAttention.review')} <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </Card>
    </section>
  );
}

function RecentTrades({
  trades,
  timezone,
  dateLocale,
}: {
  trades: readonly DashboardRecentTrade[];
  timezone: string;
  dateLocale: string;
}) {
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
                    {tTrades(`direction.${trade.direction}`)} ·{' '}
                    {formatTradeInstant(trade.occurredAt, timezone, dateLocale) ?? '—'}
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

/**
 * Reserves the real Dashboard's geometry while the server payload resolves.
 * The Basic KPI band mirrors the row's own grid and span metadata, and its
 * fixed card height matches the card anatomy's three minimum-height regions,
 * so the five cards do not resize when the figures arrive.
 *
 * The block heights and the margins between them track D4.5's compressed
 * bars, not the pre-D4.5 ones — a skeleton that reserves the old 173px
 * account card and 243px attention panel would visibly collapse the moment
 * the real page arrived, which is the exact jump a skeleton exists to avoid.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col" aria-hidden="true">
      <div className="border-border bg-card h-[74px] rounded-lg border" />
      <div className={cn('mt-5', BASIC_KPI_GRID_CLASS)}>
        {BASIC_KPI_LAYOUT.map((layout) => (
          <div
            key={layout.widgetId}
            className={cn(
              'border-border bg-card h-[138px] rounded-lg border',
              kpiSpanClassName(layout),
            )}
          />
        ))}
      </div>
      <div className="border-border bg-card mt-6 h-[88px] rounded-lg border" />
      <div className="mt-7 grid gap-4 lg:grid-cols-2">
        <div className="border-border bg-card h-80 rounded-lg border" />
        <div className="border-border bg-card h-80 rounded-lg border" />
      </div>
      <div className="border-border bg-card mt-7 h-48 rounded-lg border" />
      <div className="mt-8 space-y-3">
        <div className="bg-muted h-7 w-40 rounded-md" />
        <div className="border-border bg-card h-24 rounded-lg border" />
        <div className="border-border bg-card h-24 rounded-lg border" />
      </div>
    </div>
  );
}
