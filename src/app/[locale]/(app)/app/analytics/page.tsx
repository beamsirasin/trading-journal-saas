import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { demoBundle } from '@/lib/demo';
import { CumulativeRChart } from '@/components/charts/cumulative-r-chart';
import { CumulativeRTable } from '@/components/charts/cumulative-r-table';
import { MistakeSummary } from '@/components/dashboard/mistake-summary';
import { ChartContainer } from '@/components/product/chart-container';
import { barPercent, ComparisonMetric } from '@/components/product/comparison-metric';
import { DemoBadge, DemoDataNotice } from '@/components/product/demo-badge';
import { PageHeader, SectionHeader } from '@/components/product/page-header';
import { Container } from '@/components/shell/container';
import type { AppLocale } from '@/i18n/routing';

type PageParams = { locale: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<PageParams>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'analytics' });
  return { title: t('title') };
}

/**
 * Analytics preview.
 *
 * The full metric set laid out side by side, which the overview deliberately
 * does not do — the overview answers "how am I doing", this answers "show me
 * everything". Both read the same fixtures.
 */
export default async function AnalyticsPage({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('analytics');
  const tCommon = await getTranslations('common');
  const { attribution, equityCurve, mistakes, closedTrades } = demoBundle('all');

  return (
    <Container width="wide" className="flex flex-col gap-8 py-8">
      <PageHeader title={t('title')} description={t('description')} meta={<DemoBadge />} />

      <DemoDataNotice />

      <section aria-labelledby="metric-matrix" className="flex flex-col gap-4">
        <SectionHeader
          id="metric-matrix"
          title={t('systemVsActual.title')}
          description={t('systemVsActual.description', { closedTrades })}
        />

        <div className="bg-card border-border grid gap-7 rounded-lg border p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
          <ComparisonMetric
            label={t('systemVsActual.winRate')}
            systemValue={attribution.systemWinRatePct}
            actualValue={attribution.actualWinRatePct}
            unit="%"
            scaleMax="100%"
            systemPercent={barPercent(attribution.systemWinRatePct, 100)}
            actualPercent={barPercent(attribution.actualWinRatePct, 100)}
          />
          <ComparisonMetric
            label={t('systemVsActual.averageR')}
            systemValue={attribution.systemAvgR}
            actualValue={attribution.actualAvgR}
            unit="R"
            scaleMax="0.50R"
            systemPercent={barPercent(attribution.systemAvgR, 0.5)}
            actualPercent={barPercent(attribution.actualAvgR, 0.5)}
          />
          <ComparisonMetric
            label={t('systemVsActual.expectancy')}
            systemValue={attribution.systemExpectancyR}
            actualValue={attribution.actualExpectancyR}
            unit="R"
            scaleMax="0.50R"
            systemPercent={barPercent(attribution.systemExpectancyR, 0.5)}
            actualPercent={barPercent(attribution.actualExpectancyR, 0.5)}
          />
          <ComparisonMetric
            label={t('systemVsActual.profitFactor')}
            systemValue={attribution.systemProfitFactor}
            actualValue={attribution.actualProfitFactor}
            scaleMax="3.00"
            systemPercent={barPercent(attribution.systemProfitFactor, 3)}
            actualPercent={barPercent(attribution.actualProfitFactor, 3)}
          />
          <ComparisonMetric
            label={t('systemVsActual.totalR')}
            systemValue={attribution.systemTotalR}
            actualValue={attribution.actualTotalR}
            unit="R"
            scaleMax="40R"
            systemPercent={barPercent(attribution.systemTotalR, 40)}
            actualPercent={barPercent(attribution.actualTotalR, 40)}
          />
          <ComparisonMetric
            label={t('systemVsActual.maxDrawdown')}
            systemValue={attribution.systemMaxDrawdownR}
            actualValue={attribution.actualMaxDrawdownR}
            unit="R"
            scaleMax="8R"
            systemPercent={barPercent(attribution.systemMaxDrawdownR, 8)}
            actualPercent={barPercent(attribution.actualMaxDrawdownR, 8)}
            note={t('systemVsActual.lowerIsBetter')}
          />
        </div>
      </section>

      <section aria-labelledby="equity-heading" className="flex flex-col gap-4">
        <SectionHeader id="equity-heading" title={t('cumulativeR.title')} />
        <ChartContainer
          title={t('cumulativeR.chartTitle')}
          description={t('cumulativeR.chartDescription')}
          caption={t('cumulativeR.caption', { edgeLeakage: attribution.edgeLeakageR })}
          legend={[
            { series: 'system', label: tCommon('system'), lineStyle: 'dashed' },
            { series: 'trader', label: tCommon('actual'), lineStyle: 'solid' },
          ]}
          tableFallback={<CumulativeRTable points={equityCurve} />}
        >
          <CumulativeRChart points={equityCurve} className="h-72 w-full sm:h-96" />
        </ChartContainer>
      </section>

      <section aria-labelledby="mistake-heading" className="flex flex-col gap-4">
        <SectionHeader id="mistake-heading" title={t('mistakeCost.title')} />
        <MistakeSummary mistakes={mistakes} edgeLeakageR={attribution.edgeLeakageR} />
      </section>
    </Container>
  );
}
