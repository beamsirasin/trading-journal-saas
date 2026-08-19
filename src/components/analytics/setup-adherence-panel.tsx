import { useTranslations } from 'next-intl';

import type { SetupAdherenceAnalyticsModel } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Card, CardContent } from '@/components/ui/card';

export function SetupAdherencePanel({ adherence }: { adherence: SetupAdherenceAnalyticsModel }) {
  const t = useTranslations('analytics.real');
  const hasAnyBucketData = adherence.buckets.some(
    (bucket) => bucket.trader.tradeCount > 0 || bucket.system.tradeCount > 0,
  );

  return (
    <Card data-analytics-panel="setup-adherence">
      <CardContent className="pt-5 sm:pt-6">
        <dl className="grid gap-5 sm:grid-cols-2">
          <AnalyticsMetricDisplay
            label={t('setupAdherence.average')}
            metric={adherence.averageAdherence}
            style="percent"
            prominent
            forceNeutral
          />
          <AnalyticsMetricDisplay
            label={t('setupAdherence.conditionsMetRate')}
            metric={adherence.conditionsMetRate}
            style="percent"
            forceNeutral
          />
        </dl>
        <p className="text-muted-foreground mt-4 text-sm">
          {t('setupAdherence.sampleCount', { count: adherence.sampleCount })}
        </p>

        {!hasAnyBucketData ? null : (
          <ul className="mt-5 grid gap-3" aria-label={t('setupAdherence.bucketsLabel')}>
            {adherence.buckets.map((bucket) => (
              <li key={bucket.bucket} className="border-border rounded-md border p-3 text-sm">
                <p className="font-medium">{t(`setupAdherence.bucket.${bucket.bucket}`)}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <DimensionAxisSummaryBlock axis="trader" summary={bucket.trader} />
                  <DimensionAxisSummaryBlock axis="system" summary={bucket.system} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">
          {t('setupAdherence.help')}
        </p>
      </CardContent>
    </Card>
  );
}
