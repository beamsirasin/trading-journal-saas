import { useTranslations } from 'next-intl';

import type { SetupPerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import type { AnalyticsSetupOption, AnalyticsStrategyOption } from '@/server/dal/analytics';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Setup Performance — Phase 15D EDGE Explore. Distinct from Setup Adherence
 * (brief §13): this answers "how did this Setup perform", Setup Adherence
 * answers "how closely did entries match the configured Setup Checklist" —
 * the two stay separate cards, never merged, per the frozen distinction.
 */
export function SetupPerformancePanel({
  performance,
  setupOptions,
  strategyOptions,
}: {
  performance: SetupPerformanceAnalyticsModel;
  setupOptions: readonly AnalyticsSetupOption[];
  strategyOptions: readonly AnalyticsStrategyOption[];
}) {
  const t = useTranslations('analytics.real');

  return (
    <Card data-analytics-panel="setup-performance">
      <CardContent className="pt-5 sm:pt-6">
        {performance.setups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('explore.setupPerformance.empty')}</p>
        ) : (
          <ul className="grid gap-3" aria-label={t('explore.setupPerformance.title')}>
            {performance.setups.map((setup) => {
              const option = setupOptions.find((item) => item.setupId === setup.setupId);
              const strategyOption = strategyOptions.find(
                (item) => item.strategyId === setup.strategyId,
              );
              return (
                <li key={setup.setupId} className="border-border rounded-md border p-3 text-sm">
                  <p className="inline-flex flex-wrap items-center gap-2 font-medium">
                    {option?.label ?? setup.setupId}
                    {option?.isArchived === true ? <Badge>{t('filters.archived')}</Badge> : null}
                  </p>
                  {strategyOption === undefined ? null : (
                    <p className="text-muted-foreground text-xs">{strategyOption.label}</p>
                  )}
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <DimensionAxisSummaryBlock axis="trader" summary={setup.trader} />
                    <DimensionAxisSummaryBlock axis="system" summary={setup.system} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {performance.setups.length === 1 ? (
          <p className="text-muted-foreground mt-4 text-xs">
            {t('explore.setupPerformance.onlyOneNote')}
          </p>
        ) : null}

        <dl className="text-muted-foreground mt-5 grid gap-1 border-t pt-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="inline font-medium">{t('axis.trader')}: </dt>
            <dd className="inline">
              {t('explore.coverage.classified', { count: performance.classifiedTraderCount })}
              {' · '}
              {t('explore.coverage.unclassified', { count: performance.unclassifiedTraderCount })}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">{t('axis.system')}: </dt>
            <dd className="inline">
              {t('explore.coverage.classified', { count: performance.classifiedSystemCount })}
              {' · '}
              {t('explore.coverage.unclassified', { count: performance.unclassifiedSystemCount })}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
