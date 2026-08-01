'use client';

import { BookOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  DEMO_ACCOUNTS,
  DEMO_DEFAULT_ACCOUNT,
  DEMO_DEFAULT_RANGE,
  demoBundle,
  demoTradesForAccount,
  type DemoRangeId,
} from '@/lib/demo';
import { formatMoney } from '@/lib/money';
import { CumulativeRChart } from '@/components/charts/cumulative-r-chart';
import { CumulativeRTable } from '@/components/charts/cumulative-r-table';
import { ChartContainer } from '@/components/product/chart-container';
import { barPercent, ComparisonMetric } from '@/components/product/comparison-metric';
import { DemoDataNotice } from '@/components/product/demo-badge';
import { useDemoMistakeLabel } from '@/components/product/demo-mistake-label';
import { EmptyState } from '@/components/product/empty-state';
import { KpiCard } from '@/components/product/kpi-card';
import { SectionHeader } from '@/components/product/page-header';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

import { DashboardFilters } from './dashboard-filters';
import { TradesTable } from './trades-table';

/**
 * The demo attribution dashboard.
 *
 * Rendered on the public `/demo` route and inside the application shell at
 * `/app`, from one component, so the two cannot drift apart.
 *
 * Every number is a fixture. The filters do real local work — the range
 * selects between three literal fixture bundles and the account filters the
 * trade list — but nothing is computed. A demo that faked a recalculation
 * would be inventing a second implementation of the formulas that are the
 * whole point of this product, and it would not be tested.
 *
 * Kept deliberately shallow per the Phase 1.1 dashboard-simplification rule:
 * the dashboard answers "what is happening right now", not "why" — that is
 * `/app/analytics`'s job. Only four headline KPIs render as top-level cards;
 * System Expectancy, Actual Expectancy, Profit Factor, Max Drawdown and
 * Execution Efficiency are analytics-depth figures and live there instead.
 * The system-vs-trader module below shows only Win Rate / Average R /
 * Expectancy, with Edge Leakage folded into one insight sentence rather than
 * its own card, and a link out to the full breakdown.
 *
 * `barPercent` (imported) is bar geometry, not a metric — see its own doc
 * comment.
 *
 * KPI grids are `grid-cols-2` from the smallest viewport up, not the more
 * common `sm:grid-cols-2` (single column below 640px). A trading dashboard's
 * KPI row reads as a real analytics surface at two-up even on a 375px phone;
 * one full-width card per row for four cards in a row turns a five-second
 * glance into a long, sparse scroll. Card content (a short label, one number,
 * one line of hint text) fits comfortably at half width.
 */

export function DemoDashboard() {
  const t = useTranslations('dashboard');
  const tCommon = useTranslations('common');
  const mistakeLabel = useDemoMistakeLabel();
  const [range, setRange] = useState<DemoRangeId>(DEMO_DEFAULT_RANGE);
  const [accountId, setAccountId] = useState<string>(DEMO_DEFAULT_ACCOUNT);

  const bundle = demoBundle(range);
  const { attribution, equityCurve, mistakes, netPnl, closedTrades } = bundle;
  const topMistakes = mistakes.slice(0, 3);

  const trades = demoTradesForAccount(accountId);
  const account = DEMO_ACCOUNTS.find((candidate) => candidate.id === accountId);
  const isCombined = accountId === DEMO_DEFAULT_ACCOUNT;

  return (
    <div className="flex flex-col gap-8">
      <DemoDataNotice />

      <DashboardFilters
        range={range}
        onRangeChange={setRange}
        accountId={accountId}
        onAccountChange={setAccountId}
      />

      <section aria-labelledby="headline-metrics" className="flex flex-col gap-4">
        <SectionHeader
          id="headline-metrics"
          title={t('title')}
          description={`${closedTrades} ${tCommon('closedTrades').toLowerCase()}`}
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <KpiCard
            label={t('netPnl')}
            value={formatMoney(netPnl, { style: 'symbol', signDisplay: 'always' })}
            tone={netPnl.amountMinor >= 0n ? 'positive' : 'negative'}
            animate={false}
            hint={t('netPnlHint')}
          />
          <KpiCard
            label={t('actualWinRate')}
            value={attribution.actualWinRatePct}
            suffix="%"
            hint={t('actualWinRateHint')}
          />
          <KpiCard
            label={t('actualAverageR')}
            value={attribution.actualAvgR}
            suffix="R"
            hint={t('actualAverageRHint')}
          />
          <KpiCard
            label={t('disciplineScore')}
            value={attribution.disciplineScore}
            tone="warning"
            hint={t('disciplineScoreHint')}
          />
        </div>
      </section>

      <section aria-labelledby="attribution-metrics" className="flex flex-col gap-4">
        <div className="bg-card border-border grid gap-4 rounded-lg border p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col gap-5">
            <SectionHeader
              id="attribution-metrics"
              title={t('systemVsTrader.title')}
              description={t('systemVsTrader.description')}
            />

            <div className="flex flex-col gap-6">
              <ComparisonMetric
                label={t('systemVsTrader.winRate')}
                systemValue={attribution.systemWinRatePct}
                actualValue={attribution.actualWinRatePct}
                unit="%"
                scaleMax="100%"
                systemPercent={barPercent(attribution.systemWinRatePct, 100)}
                actualPercent={barPercent(attribution.actualWinRatePct, 100)}
              />
              <ComparisonMetric
                label={t('systemVsTrader.averageR')}
                systemValue={attribution.systemAvgR}
                actualValue={attribution.actualAvgR}
                unit="R"
              />
              <ComparisonMetric
                label={t('systemVsTrader.expectancy')}
                systemValue={attribution.systemExpectancyR}
                actualValue={attribution.actualExpectancyR}
                unit="R"
              />
            </div>

            <p className="text-warning text-sm leading-relaxed">
              {t('systemVsTrader.edgeLeakageInsight', { value: attribution.edgeLeakageR })}
            </p>

            <Button asChild variant="outline" className="min-h-11 self-start">
              <Link href="/app/analytics">{t('systemVsTrader.viewDetailedAnalytics')}</Link>
            </Button>
          </div>

          <ChartContainer
            title={t('chart.title')}
            description={t('chart.description')}
            caption={t('chart.caption')}
            legend={[
              { series: 'system', label: tCommon('system'), lineStyle: 'dashed' },
              { series: 'trader', label: tCommon('actual'), lineStyle: 'solid' },
            ]}
            tableFallback={<CumulativeRTable points={equityCurve} />}
            className="border-0 bg-transparent p-0 sm:p-0"
          >
            <CumulativeRChart points={equityCurve} className="h-64 w-full sm:h-72" />
          </ChartContainer>
        </div>
      </section>

      <section aria-labelledby="mistakes-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="mistakes-heading"
          title={t('mistakes.title')}
          description={t('mistakes.description')}
        />

        <ul className="flex flex-col gap-2">
          {topMistakes.map((mistake) => (
            <li
              key={mistake.id}
              className="border-border flex items-center gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-foreground text-sm font-medium">
                  {mistakeLabel(mistake.label)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('mistakes.times', { count: mistake.occurrences })}
                </span>
              </div>

              <span className="numeric text-foreground ml-auto w-14 text-right text-sm font-semibold">
                −{mistake.costR}R
              </span>
            </li>
          ))}
        </ul>

        <Button asChild variant="ghost" className="min-h-11 self-start">
          <Link href="/app/analytics">{t('mistakes.viewDetailedAnalytics')}</Link>
        </Button>
      </section>

      <section aria-labelledby="recent-trades" className="flex flex-col gap-4">
        <SectionHeader
          id="recent-trades"
          title={t('recentTrades.title')}
          description={
            isCombined
              ? t('recentTrades.allAccountsDescription')
              : t('recentTrades.filteredTo', { account: account?.name ?? '' })
          }
        />

        {trades.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t('recentTrades.emptyTitle')}
            description={t('recentTrades.emptyDescription')}
            action={
              <Button asChild className="min-h-11">
                <Link href="/register">{t('recentTrades.emptyCta')}</Link>
              </Button>
            }
          />
        ) : (
          <TradesTable trades={trades} />
        )}

        <p className="text-muted-foreground text-xs leading-relaxed">
          {t('recentTrades.footnote')}
        </p>
      </section>
    </div>
  );
}
