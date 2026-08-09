import { useTranslations } from 'next-intl';

import type { ComparisonAnalyticsModel } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { MetricLabel } from '@/components/product/metric';
import { Card, CardContent } from '@/components/ui/card';

export function AnalyticsComparisonPanel({ comparison }: { comparison: ComparisonAnalyticsModel }) {
  const t = useTranslations('analytics.real');

  return (
    <Card data-analytics-panel="comparison">
      <CardContent className="pt-5 sm:pt-6">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <MetricLabel>{t('comparison.comparableTrades')}</MetricLabel>
            <span className="numeric text-2xl font-semibold">{comparison.comparableCount}</span>
          </div>
          <AnalyticsMetricDisplay
            label={t('comparison.pairedSystemTotal')}
            metric={comparison.pairedSystemTotalR}
            style="r"
            forceNeutral
          />
          <AnalyticsMetricDisplay
            label={t('comparison.pairedActualTotal')}
            metric={comparison.pairedActualTotalR}
            style="r"
            forceNeutral
          />
          <AnalyticsMetricDisplay
            label={t('comparison.edgeLeakage')}
            metric={comparison.edgeLeakageR}
            style="r"
            forceNeutral
          />
          <AnalyticsMetricDisplay
            label={t('comparison.executionEfficiency')}
            metric={comparison.executionEfficiency}
            style="percent"
            forceNeutral
          />
        </dl>
        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">{t('comparison.help')}</p>
      </CardContent>
    </Card>
  );
}
