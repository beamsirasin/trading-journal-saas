import { demoBundle } from '@/lib/demo';
import { CumulativeRTable } from '@/components/charts/cumulative-r-table';
import { StaticCumulativeRChart } from '@/components/charts/static-cumulative-r-chart';
import { ChartContainer } from '@/components/product/chart-container';
import { barPercent, ComparisonMetric } from '@/components/product/comparison-metric';
import { DemoBadge } from '@/components/product/demo-badge';
import { KpiCard } from '@/components/product/kpi-card';

import { Section, SectionIntro } from './section';

/**
 * System performance against trader performance.
 *
 * The centrepiece of the page. Every figure is demo data and is labelled as
 * such twice — once on the section, once on the chart — because these are
 * trading numbers on a marketing page and an unlabelled screenshot of them
 * would read as a track record.
 *
 * No metric is derived here; the real formulas live in `src/lib/calc/` from
 * Phase 07 and this page will read their output instead of these fixtures.
 * `barPercent` (imported) is bar geometry only — see its own doc comment.
 */

export function AttributionSection() {
  const { attribution, equityCurve, closedTrades } = demoBundle('all');

  return (
    <Section id="attribution" labelledBy="attribution-title">
      <div className="flex flex-col gap-12">
        <SectionIntro
          eyebrow="System vs trader"
          title="Two sets of books for the same trades"
          titleId="attribution-title"
          description="Every metric is computed twice: once from the strategy's planned entry, stop and rule-defined exit, and once from what you actually did. Both are expressed in R, which is what makes them comparable even when you sized the position differently from the plan."
        />

        <div className="flex flex-wrap items-center gap-3">
          <DemoBadge />
          <p className="text-muted-foreground text-sm">
            Fictional account · {closedTrades} closed trades · not a performance claim
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <KpiCard
            label="Edge leakage"
            value={attribution.edgeLeakageR}
            suffix="R"
            tone="warning"
            animate={false}
            hint="System total R minus actual total R. This much edge existed and was not captured."
          />
          <KpiCard
            label="Execution efficiency"
            value={attribution.executionEfficiencyPct}
            suffix="%"
            animate={false}
            hint="The share of the system's edge that actually reached the account."
          />
          <KpiCard
            label="Discipline score"
            value={attribution.disciplineScore}
            animate={false}
            hint="100 minus the weighted cost of recorded rule breaks, averaged per trade."
          />
          <KpiCard
            label="Closed trades"
            value={String(closedTrades)}
            animate={false}
            hint="The sample the figures above are drawn from."
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="bg-card border-border flex flex-col gap-7 rounded-lg border p-5 sm:p-6">
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
              label="Average R per trade"
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
              note="Expectancy is the mean R per trade, so it equals average R by definition in this model. Both are shown because traders look for each by name."
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
          </div>

          <ChartContainer
            title="Cumulative R over time"
            description="The same trades, scored two ways."
            caption={`Demo data. Both series start at zero and share one axis in R. The widening gap is the ${attribution.edgeLeakageR}R of edge leakage. Weekly samples, so intra-week drawdowns are not visible here.`}
            legend={[
              { series: 'system', label: 'System — rules followed exactly', lineStyle: 'dashed' },
              { series: 'trader', label: 'Actual — what you did', lineStyle: 'solid' },
            ]}
            tableFallback={<CumulativeRTable points={equityCurve} />}
          >
            <StaticCumulativeRChart points={equityCurve} className="aspect-12/5 w-full" />
          </ChartContainer>
        </div>

        <p className="text-muted-foreground border-border max-w-3xl border-l-2 pl-4 text-sm leading-relaxed">
          Read together, these say something a profit figure cannot: the strategy has an edge, the
          account is up, and roughly three quarters of what the system offered never arrived. That
          is a discipline problem, and rewriting the strategy would make it worse.
        </p>
      </div>
    </Section>
  );
}
