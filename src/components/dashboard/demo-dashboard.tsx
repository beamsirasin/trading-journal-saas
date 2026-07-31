'use client';

import { BookOpen } from 'lucide-react';
import Link from 'next/link';
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
import { CumulativeRChart, CumulativeRTable } from '@/components/charts/cumulative-r-chart';
import { ChartContainer } from '@/components/product/chart-container';
import { ComparisonMetric } from '@/components/product/comparison-metric';
import { DemoDataNotice } from '@/components/product/demo-badge';
import { EmptyState } from '@/components/product/empty-state';
import { KpiCard } from '@/components/product/kpi-card';
import { SectionHeader } from '@/components/product/page-header';
import { Button } from '@/components/ui/button';

import { DashboardFilters } from './dashboard-filters';
import { MistakeSummary } from './mistake-summary';
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
 * `barPercent` is bar geometry, not a metric. See the same note in
 * `attribution-section.tsx`.
 */
function barPercent(value: string, scaleMax: number): number {
  return (Number(value) / scaleMax) * 100;
}

export function DemoDashboard() {
  const [range, setRange] = useState<DemoRangeId>(DEMO_DEFAULT_RANGE);
  const [accountId, setAccountId] = useState<string>(DEMO_DEFAULT_ACCOUNT);

  const bundle = demoBundle(range);
  const { attribution, equityCurve, mistakes, netPnl, closedTrades } = bundle;

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
          title="Headline"
          description={`${closedTrades} closed trades in the selected range.`}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Total net P&L"
            value={formatMoney(netPnl, { style: 'symbol', signDisplay: 'always' })}
            tone={netPnl.amountMinor >= 0n ? 'positive' : 'negative'}
            animate={false}
            hint="After commission, fees and swap."
          />
          <KpiCard
            label="Actual win rate"
            value={attribution.actualWinRatePct}
            suffix="%"
            hint={`The system's rules won ${attribution.systemWinRatePct}% of the time.`}
          />
          <KpiCard
            label="Actual average R"
            value={attribution.actualAvgR}
            suffix="R"
            hint={`The system averaged ${attribution.systemAvgR}R per trade.`}
          />
          <KpiCard
            label="Discipline score"
            value={attribution.disciplineScore}
            tone="warning"
            hint="100 minus the weighted cost of recorded rule breaks."
          />
        </div>
      </section>

      <section aria-labelledby="attribution-metrics" className="flex flex-col gap-4">
        <SectionHeader
          id="attribution-metrics"
          title="Where the edge went"
          description="The system's result against yours, over the same trades."
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="System expectancy"
            value={attribution.systemExpectancyR}
            suffix="R"
            hint="Mean R per trade if the rules had been followed exactly."
          />
          <KpiCard
            label="Actual expectancy"
            value={attribution.actualExpectancyR}
            suffix="R"
            hint="Mean R per trade as actually executed."
          />
          <KpiCard
            label="Edge leakage"
            value={attribution.edgeLeakageR}
            suffix="R"
            tone="warning"
            hint="System total R minus actual total R."
          />
          <KpiCard
            label="Execution efficiency"
            value={attribution.executionEfficiencyPct}
            suffix="%"
            hint="The share of available edge that reached the account."
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="bg-card border-border flex flex-col gap-7 rounded-lg border p-5">
            <ComparisonMetric
              label="Win rate"
              systemValue={attribution.systemWinRatePct}
              actualValue={attribution.actualWinRatePct}
              unit="%"
              scaleMax="100%"
              systemPercent={barPercent(attribution.systemWinRatePct, 100)}
              actualPercent={barPercent(attribution.actualWinRatePct, 100)}
            />
            <ComparisonMetric
              label="Profit factor"
              systemValue={attribution.systemProfitFactor}
              actualValue={attribution.actualProfitFactor}
              scaleMax="3.00"
              systemPercent={barPercent(attribution.systemProfitFactor, 3)}
              actualPercent={barPercent(attribution.actualProfitFactor, 3)}
            />
            <ComparisonMetric
              label="Max drawdown"
              systemValue={attribution.systemMaxDrawdownR}
              actualValue={attribution.actualMaxDrawdownR}
              unit="R"
              scaleMax="8R"
              systemPercent={barPercent(attribution.systemMaxDrawdownR, 8)}
              actualPercent={barPercent(attribution.actualMaxDrawdownR, 8)}
              note="Lower is better on this row — the actual drawdown is the deeper one."
            />
          </div>

          <ChartContainer
            title="Cumulative R"
            description="Both series in R, on one axis."
            caption={`Demo data. The gap between the lines is ${attribution.edgeLeakageR}R of edge that the strategy offered and execution did not capture. Weekly samples, so intra-week drawdowns are not visible.`}
            legend={[
              { series: 'system', label: 'System', lineStyle: 'dashed' },
              { series: 'trader', label: 'Actual', lineStyle: 'solid' },
            ]}
            tableFallback={<CumulativeRTable points={equityCurve} />}
          >
            <CumulativeRChart points={equityCurve} className="h-64 w-full sm:h-72" />
          </ChartContainer>
        </div>
      </section>

      <section aria-labelledby="mistakes-heading" className="flex flex-col gap-4">
        <SectionHeader
          id="mistakes-heading"
          title="Mistake summary"
          description="The habits behind the leakage."
        />
        <MistakeSummary mistakes={mistakes} edgeLeakageR={attribution.edgeLeakageR} />
      </section>

      <section aria-labelledby="recent-trades" className="flex flex-col gap-4">
        <SectionHeader
          id="recent-trades"
          title="Recent trades"
          description={
            isCombined
              ? 'Across all demo accounts, newest first.'
              : `Filtered to ${account?.name ?? 'this account'}, newest first.`
          }
        />

        {trades.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No trades in this account yet"
            description="Log your first trade to see how much of your strategy's edge you are actually capturing."
            action={
              <Button asChild className="min-h-11">
                <Link href="/register">Start a free trial</Link>
              </Button>
            }
          />
        ) : (
          <TradesTable trades={trades} />
        )}

        <p className="text-muted-foreground text-xs leading-relaxed">
          The headline and attribution figures above cover all demo accounts for the selected range.
          Only this trade list responds to the account picker — per-account attribution arrives with
          the real calculation engine.
        </p>
      </section>
    </div>
  );
}
