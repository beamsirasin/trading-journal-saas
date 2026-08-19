import { useTranslations } from 'next-intl';

import type { ConfidenceAnalyticsModel } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Card, CardContent } from '@/components/ui/card';

export function ConfidencePerformance({ confidence }: { confidence: ConfidenceAnalyticsModel }) {
  const t = useTranslations('analytics.real');
  const hasAnyLevelData = confidence.levels.some(
    (level) => level.trader.tradeCount > 0 || level.system.tradeCount > 0,
  );

  return (
    <Card data-analytics-panel="confidence">
      <CardContent className="pt-5 sm:pt-6">
        <AnalyticsMetricDisplay
          label={t('confidence.average')}
          metric={confidence.averageConfidence}
          style="percent"
          prominent
          forceNeutral
        />
        <p className="text-muted-foreground mt-4 text-sm">
          {t('confidence.sampleCount', { count: confidence.sampleCount })}
        </p>

        {!hasAnyLevelData ? null : (
          <ul className="mt-5 grid gap-3" aria-label={t('confidence.levelsLabel')}>
            {confidence.levels.map((level) => (
              <li key={level.level} className="border-border rounded-md border p-3 text-sm">
                <p className="font-medium">{t('confidence.levelLabel', { level: level.level })}</p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <DimensionAxisSummaryBlock axis="trader" summary={level.trader} />
                  <DimensionAxisSummaryBlock axis="system" summary={level.system} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">{t('confidence.help')}</p>
      </CardContent>
    </Card>
  );
}
