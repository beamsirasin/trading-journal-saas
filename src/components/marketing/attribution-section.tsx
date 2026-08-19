import { useTranslations } from 'next-intl';

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
 *
 * PHASE 1.1 SIMPLIFICATION — this used to show four mini KPI cards (Execution
 * Gap, execution efficiency, discipline score, closed trades) and four
 * comparison rows (win rate, average R, expectancy, total R) beside the
 * chart. That is analytics-page density on a marketing page. Trimmed to the
 * two figures that best make the pitch (Execution Gap, discipline score) and
 * the three comparison rows the Phase 1.1 brief names explicitly for this
 * exact module. Execution efficiency, total R and the closed-trade count
 * still exist — on `/app/analytics` and the real dashboard, not here.
 */
export function AttributionSection() {
  const t = useTranslations('attribution');
  const { attribution, equityCurve, closedTrades } = demoBundle('all');

  return (
    <Section id="attribution" labelledBy="attribution-title">
      <div className="flex flex-col gap-10">
        <SectionIntro
          eyebrow={t('eyebrow')}
          title={t('title')}
          titleId="attribution-title"
          description={t('description')}
        />

        <div className="flex flex-wrap items-center gap-3">
          <DemoBadge />
          <p className="text-muted-foreground text-sm">{t('demoCaption', { closedTrades })}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <KpiCard
                label={t('executionGap')}
                value={attribution.executionGapR}
                suffix="R"
                tone="warning"
                animate={false}
                hint={t('executionGapHint')}
              />
              <KpiCard
                label={t('disciplineScore')}
                value={attribution.disciplineScore}
                animate={false}
              />
            </div>

            <div className="bg-card border-border flex flex-col gap-7 rounded-lg border p-5 sm:p-6">
              <ComparisonMetric
                label={t('winRate')}
                systemValue={attribution.systemWinRatePct}
                actualValue={attribution.actualWinRatePct}
                unit="%"
                scaleMax="100%"
                systemPercent={barPercent(attribution.systemWinRatePct, 100)}
                actualPercent={barPercent(attribution.actualWinRatePct, 100)}
              />

              <ComparisonMetric
                label={t('averageR')}
                systemValue={attribution.systemAvgR}
                actualValue={attribution.actualAvgR}
                unit="R"
                scaleMax="0.50R"
                systemPercent={barPercent(attribution.systemAvgR, 0.5)}
                actualPercent={barPercent(attribution.actualAvgR, 0.5)}
              />

              <ComparisonMetric
                label={t('expectancy')}
                systemValue={attribution.systemExpectancyR}
                actualValue={attribution.actualExpectancyR}
                unit="R"
                scaleMax="0.50R"
                systemPercent={barPercent(attribution.systemExpectancyR, 0.5)}
                actualPercent={barPercent(attribution.actualExpectancyR, 0.5)}
              />
            </div>
          </div>

          <ChartContainer
            title={t('chartTitle')}
            description={t('chartDescription')}
            caption={t('chartCaption')}
            legend={[
              { series: 'system', label: t('chartLegendSystem'), lineStyle: 'dashed' },
              { series: 'trader', label: t('chartLegendActual'), lineStyle: 'solid' },
            ]}
            tableFallback={<CumulativeRTable points={equityCurve} />}
          >
            <StaticCumulativeRChart points={equityCurve} className="aspect-12/5 w-full" />
          </ChartContainer>
        </div>

        <p className="text-muted-foreground border-border max-w-3xl border-l-2 pl-4 text-sm leading-relaxed">
          {t('closingNote')}
        </p>
      </div>
    </Section>
  );
}
