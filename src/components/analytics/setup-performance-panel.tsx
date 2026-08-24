import { useTranslations } from 'next-intl';

import type { SetupPerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import type { AnalyticsSetupOption, AnalyticsStrategyOption } from '@/server/dal/analytics';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Badge } from '@/components/ui/badge';

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
    <div data-analytics-panel="setup-performance" className="min-w-0">
      <div className="pt-2">
        {performance.setups.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('explore.setupPerformance.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="text-muted-foreground hidden min-w-[42rem] grid-cols-[minmax(12rem,1.2fr)_1fr_1fr] gap-5 border-b pb-2 text-[11px] font-semibold tracking-wider uppercase sm:grid">
              <span>{t('explore.setupPerformance.title')}</span>
              <span>{t('axis.trader')}</span>
              <span>{t('axis.system')}</span>
            </div>
            <ul
              className="divide-border min-w-0 divide-y sm:min-w-[42rem]"
              aria-label={t('explore.setupPerformance.title')}
            >
              {performance.setups.map((setup) => {
                const option = setupOptions.find((item) => item.setupId === setup.setupId);
                const strategyOption = strategyOptions.find(
                  (item) => item.strategyId === setup.strategyId,
                );
                return (
                  <li
                    key={setup.setupId}
                    className="grid gap-4 py-4 text-sm sm:grid-cols-[minmax(12rem,1.2fr)_1fr_1fr] sm:gap-5"
                  >
                    <div>
                      <p className="inline-flex flex-wrap items-center gap-2 font-medium">
                        {option?.label ?? setup.setupId}
                        {option?.isArchived === true ? (
                          <Badge>{t('filters.archived')}</Badge>
                        ) : null}
                      </p>
                      {strategyOption === undefined ? null : (
                        <p className="text-muted-foreground text-xs">{strategyOption.label}</p>
                      )}
                    </div>
                    <DimensionAxisSummaryBlock axis="trader" summary={setup.trader} />
                    <DimensionAxisSummaryBlock axis="system" summary={setup.system} />
                  </li>
                );
              })}
            </ul>
          </div>
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
      </div>
    </div>
  );
}
