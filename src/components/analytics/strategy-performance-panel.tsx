import { useTranslations } from 'next-intl';

import type { FrameworkPerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import type { AnalyticsStrategyOption } from '@/server/dal/analytics';
import { DimensionAxisSummaryBlock } from '@/components/analytics/dimension-axis-summary';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Strategy Performance — Phase 15D EDGE Explore. Reuses the exact same
 * "grouped list with independent Trader/System `DimensionAxisSummaryBlock`s"
 * shape already established for Setup Adherence buckets/Confidence levels/
 * Emotion groups — this is a grouping addition, not a new visual language.
 *
 * Already sorted by `composeStrategyPerformance` (Trader average R desc,
 * then Trader Trade count desc, then id asc — deterministic, documented in
 * `docs/phases/PHASE-15-ux-simplification.md`); this component renders that
 * order as-is rather than re-sorting.
 */
export function StrategyPerformancePanel({
  performance,
  options,
}: {
  performance: FrameworkPerformanceAnalyticsModel;
  options: readonly AnalyticsStrategyOption[];
}) {
  const t = useTranslations('analytics.real');

  return (
    <Card data-analytics-panel="strategy-performance">
      <CardContent className="pt-5 sm:pt-6">
        {performance.strategies.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('explore.strategyPerformance.empty')}</p>
        ) : (
          <ul className="grid gap-3" aria-label={t('explore.strategyPerformance.title')}>
            {performance.strategies.map((strategy) => {
              const option = options.find((item) => item.strategyId === strategy.strategyId);
              return (
                <li
                  key={strategy.strategyId}
                  className="border-border rounded-md border p-3 text-sm"
                >
                  <p className="inline-flex flex-wrap items-center gap-2 font-medium">
                    {option?.label ?? strategy.strategyId}
                    {option?.isArchived === true ? <Badge>{t('filters.archived')}</Badge> : null}
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <DimensionAxisSummaryBlock axis="trader" summary={strategy.trader} />
                    <DimensionAxisSummaryBlock axis="system" summary={strategy.system} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {performance.strategies.length === 1 ? (
          <p className="text-muted-foreground mt-4 text-xs">
            {t('explore.strategyPerformance.onlyOneNote')}
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
