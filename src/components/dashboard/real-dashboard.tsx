import { ArrowRight, ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { AnalyticsDatePreset } from '@/lib/analytics/filters';
import { buildDashboardHref, type DashboardFilterState } from '@/lib/dashboard/filters';
import type { DashboardPageData } from '@/lib/dashboard/page-data';
import { composePerformanceCards } from '@/lib/dashboard/performance-card';
import {
  dashboardLayoutItem,
  dashboardWidgetAttributes,
  DEFAULT_DASHBOARD_LAYOUT,
} from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { DashboardStateLink } from '@/components/dashboard/dashboard-state-link';
import { ActiveTradingAccountSummaryCard } from '@/components/dashboard/empty-trading-dashboard';
import { ExecutionGapSection } from '@/components/dashboard/execution-gap/execution-gap-section';
import { BasicKpiRow } from '@/components/dashboard/kpi/basic-kpi-row';
import { BASIC_KPI_GRID_CLASS, kpiSpanClassName } from '@/components/dashboard/kpi/kpi-widget-card';
import { PerformanceCard } from '@/components/dashboard/performance/performance-card';
import { RecentTradesCard } from '@/components/dashboard/recent-trades/recent-trades-card';
import { MetricLabel } from '@/components/product/metric';
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
  calendarSlot,
  insightSlot,
  riskSlot,
}: {
  data: DashboardPageData;
  dateLocale: string;
  /**
   * The Calendar's own server boundary, streamed in by the route.
   *
   * Passed as a node rather than as data because D6A deliberately kept the
   * Calendar out of `DashboardPageData` — it is a separate read on a
   * dimension (the month) the Dashboard bundle does not have. Handing the
   * rendered subtree in lets it suspend on its own without the five core
   * reads waiting for it, and keeps this component free of any knowledge of
   * how a month is fetched.
   */
  calendarSlot: React.ReactNode;
  /**
   * D8 insight pillars. Its own streamed boundary too: five more bulk
   * projections must never hold the five core reads off the screen.
   */
  insightSlot: React.ReactNode;
  /**
   * D7's Risk Performance boundary, on exactly the same terms and for the
   * same reason: a modeled balance needs the Account's whole authoritative
   * money history to know what the visible range opened at, which is a
   * different horizon from the five bounded core reads.
   */
  riskSlot: React.ReactNode;
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

      {/*
        D8B — the three insight pillars, between the Execution Gap they help
        explain and the record list that follows. The Gap says HOW MUCH edge
        the execution captured; these three ask where that came from — the
        system, the trader state, the trader discipline — and only then does
        the page hand over to individual records.
      */}
      <div className="mt-7 min-w-0">{insightSlot}</div>

      {/*
        D6B — the one section whose two widgets are genuinely unequal (§30):
        seven columns of Trade rows beside five of Calendar grid. The Basic KPI
        band's five-column grid is deliberately NOT reused here; each section
        owns its own, which is exactly what D4.5's section-aware metadata was
        for.

        `items-stretch`, so the section has one bottom edge rather than a
        ragged one. This cannot damage the Calendar's geometry: the grid's
        squares are fixed-height rows inside a `flex-col` card, so stretching
        only ever adds room BELOW them — and in practice the Calendar is the
        taller of the two, which makes this a rule about the Trade list. §23
        forbids forcing equal height at the Calendar's expense, which is a
        different thing from letting the shorter card fill its column.
      */}
      <section aria-labelledby="recent-and-calendar-heading" className="mt-8 min-w-0">
        <h2 id="recent-and-calendar-heading" className="sr-only">
          {t('recentAndCalendarSection')}
        </h2>
        <div className="grid min-w-0 items-stretch gap-4 lg:grid-cols-12">
          <RecentTradesCard
            trades={data.recentTrades.items}
            timezone={data.scope.timezone}
            dateLocale={dateLocale}
            className="lg:col-span-7"
          />
          <div className="min-w-0 lg:col-span-5">{calendarSlot}</div>
        </div>
      </section>

      {/*
        D7B — the Risk Performance section, in the layout slot the registry
        has recorded for `account.balance`/`risk.drawdown` since D2 (orders
        120 and 130, after the record list). It is the page's last analytical
        beat: the KPI band, the two baselines and the Execution Gap are all
        expressed in R over the selected range, and this is the one section
        that answers the money question those cannot — where the modeled
        balance actually stands, and how far below its own high-water mark.

        A node rather than data, for the same reason as `calendarSlot`: it is
        its own server boundary and suspends on its own.
      */}
      <div className="mt-8 min-w-0">{riskSlot}</div>

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

function DashboardRangeControl({ filters }: { filters: DashboardFilterState }) {
  const t = useTranslations('dashboard.real');
  return (
    <nav aria-label={t('dateRangeLabel')} className="flex flex-col gap-1.5">
      <span className="text-muted-foreground text-label uppercase">{t('dateRangeLabel')}</span>
      <div className="border-border bg-muted/50 inline-flex w-fit max-w-full flex-wrap rounded-lg border p-1">
        {RANGE_ORDER.map((range) => (
          <DashboardStateLink
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
          </DashboardStateLink>
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
      {/*
        D6B's 7 + 5 section, reserved at the geometry it actually renders at.
        A skeleton that reserved two stacked full-width bands would visibly
        reflow into two columns the moment the payload arrived, which is the
        exact jump a skeleton exists to prevent. Both blocks are the same
        height because the real section stretches to one bottom edge.
      */}
      <div className="mt-8 grid items-stretch gap-4 lg:grid-cols-12">
        <div className="border-border bg-card h-96 rounded-lg border lg:col-span-7" />
        <div className="border-border bg-card h-96 rounded-lg border lg:col-span-5" />
      </div>
      {/* D7's Risk Performance section: one card, a summary strip over a
          chart, at the height it actually renders at. */}
      <div className="border-border bg-card mt-8 h-[420px] rounded-lg border" />
    </div>
  );
}
