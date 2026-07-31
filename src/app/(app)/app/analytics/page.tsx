import type { Metadata } from 'next';

import { demoBundle } from '@/lib/demo';
import { CumulativeRChart } from '@/components/charts/cumulative-r-chart';
import { CumulativeRTable } from '@/components/charts/cumulative-r-table';
import { MistakeSummary } from '@/components/dashboard/mistake-summary';
import { ChartContainer } from '@/components/product/chart-container';
import { barPercent, ComparisonMetric } from '@/components/product/comparison-metric';
import { DemoBadge, DemoDataNotice } from '@/components/product/demo-badge';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';

export const metadata: Metadata = {
  title: 'Analytics',
};

/**
 * Analytics preview.
 *
 * The full metric set laid out side by side, which the overview deliberately
 * does not do — the overview answers "how am I doing", this answers "show me
 * everything". Both read the same fixtures.
 */
export default function AnalyticsPage() {
  const { attribution, equityCurve, mistakes, closedTrades } = demoBundle('all');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader
        title="Analytics"
        description="Every metric computed twice — once for the strategy, once for you."
        meta={<DemoBadge />}
      />

      <DemoDataNotice />

      <section aria-labelledby="metric-matrix" className="flex flex-col gap-4">
        <SectionHeader
          id="metric-matrix"
          title="System against actual"
          description={`Across ${closedTrades} closed trades. Both columns are normalised to R, which is what makes them comparable when position size differed from the plan.`}
        />

        <div className="bg-card border-border grid gap-7 rounded-lg border p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
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
            label="Average R"
            systemValue={attribution.systemAvgR}
            actualValue={attribution.actualAvgR}
            unit="R"
            scaleMax="0.50R"
            systemPercent={barPercent(attribution.systemAvgR, 0.5)}
            actualPercent={barPercent(attribution.actualAvgR, 0.5)}
          />
          <ComparisonMetric
            label="Expectancy"
            systemValue={attribution.systemExpectancyR}
            actualValue={attribution.actualExpectancyR}
            unit="R"
            scaleMax="0.50R"
            systemPercent={barPercent(attribution.systemExpectancyR, 0.5)}
            actualPercent={barPercent(attribution.actualExpectancyR, 0.5)}
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
            label="Total R"
            systemValue={attribution.systemTotalR}
            actualValue={attribution.actualTotalR}
            unit="R"
            scaleMax="40R"
            systemPercent={barPercent(attribution.systemTotalR, 40)}
            actualPercent={barPercent(attribution.actualTotalR, 40)}
          />
          <ComparisonMetric
            label="Max drawdown"
            systemValue={attribution.systemMaxDrawdownR}
            actualValue={attribution.actualMaxDrawdownR}
            unit="R"
            scaleMax="8R"
            systemPercent={barPercent(attribution.systemMaxDrawdownR, 8)}
            actualPercent={barPercent(attribution.actualMaxDrawdownR, 8)}
            note="Lower is better on this row."
          />
        </div>
      </section>

      <section aria-labelledby="equity-heading" className="flex flex-col gap-4">
        <SectionHeader id="equity-heading" title="Cumulative R" />
        <ChartContainer
          title="Cumulative R over time"
          description="One axis in R. Both series start at zero."
          caption={`Demo data. The gap between the lines is ${attribution.edgeLeakageR}R of edge leakage. Weekly samples, so intra-week drawdowns are not visible here.`}
          legend={[
            { series: 'system', label: 'System', lineStyle: 'dashed' },
            { series: 'trader', label: 'Actual', lineStyle: 'solid' },
          ]}
          tableFallback={<CumulativeRTable points={equityCurve} />}
        >
          <CumulativeRChart points={equityCurve} className="h-72 w-full sm:h-96" />
        </ChartContainer>
      </section>

      <section aria-labelledby="mistake-heading" className="flex flex-col gap-4">
        <SectionHeader id="mistake-heading" title="Mistake cost" />
        <MistakeSummary mistakes={mistakes} edgeLeakageR={attribution.edgeLeakageR} />
      </section>
    </Container>
  );
}
