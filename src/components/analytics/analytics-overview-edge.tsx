import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type {
  FrameworkPerformanceAnalyticsModel,
  SetupAdherenceAnalyticsModel,
  SetupPerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import {
  selectBestObservedSetup,
  selectBestObservedStrategy,
} from '@/lib/analytics/overview-selectors';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { AnalyticsSetupOption, AnalyticsStrategyOption } from '@/server/dal/analytics';
import { HeroMetric } from '@/components/product/summary-primitives';
import { ZoneSection } from '@/components/product/zone-section';
import { Badge } from '@/components/ui/badge';

/**
 * Phase 15C/15D — Analytics Overview, EDGE zone. Three compact cards: Best
 * observed Strategy, Best observed Setup (both Phase 15D — net-new
 * composition, `lib/analytics/metrics.ts`'s `composeStrategyPerformance`/
 * `composeSetupPerformance`), and Setup Adherence (Phase 15C, unchanged).
 * "Best observed" — never "Best Strategy"/"Best Setup" (brief §8/§12): no
 * statistical-significance claim is made, only what was observed. The full
 * ranking, coverage, and independent Trader/System detail for every
 * Strategy/Setup live in Edge Explore, reachable below.
 */
export function EdgeZone({
  setupAdherence,
  strategyPerformance,
  setupPerformance,
  strategyOptions,
  setupOptions,
}: {
  setupAdherence: SetupAdherenceAnalyticsModel;
  strategyPerformance: FrameworkPerformanceAnalyticsModel;
  setupPerformance: SetupPerformanceAnalyticsModel;
  strategyOptions: readonly AnalyticsStrategyOption[];
  setupOptions: readonly AnalyticsSetupOption[];
}) {
  const t = useTranslations('analytics.real');
  const tZones = useTranslations('zones');
  const average = formatAnalyticsMetric(setupAdherence.averageAdherence, 'percent');
  const hasAdherenceData = setupAdherence.sampleCount > 0 && average.status === 'available';

  const bestStrategy = selectBestObservedStrategy(strategyPerformance);
  const bestStrategyOption = strategyOptions.find((s) => s.strategyId === bestStrategy?.strategyId);
  const bestStrategyAvg =
    bestStrategy === null ? null : formatAnalyticsMetric(bestStrategy.trader.averageR, 'r');

  const bestSetup = selectBestObservedSetup(setupPerformance);
  const bestSetupOption = setupOptions.find((s) => s.setupId === bestSetup?.setupId);
  const bestSetupAvg =
    bestSetup === null ? null : formatAnalyticsMetric(bestSetup.trader.averageR, 'r');

  return (
    <ZoneSection
      zone="edge"
      icon={Compass}
      title={tZones('edge')}
      description={t('overview.edge.description')}
      id="analytics-overview-edge"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">
        <div
          className="border-border rounded-lg border p-4 sm:p-5"
          data-overview-card="best-strategy"
        >
          {bestStrategy === null || bestStrategyAvg?.status !== 'available' ? (
            <p className="text-muted-foreground text-sm">{t('overview.edge.noBestStrategy')}</p>
          ) : (
            <HeroMetric
              label={t('overview.edge.bestStrategy')}
              value={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {bestStrategyOption?.label ?? bestStrategy.strategyId}
                  {bestStrategyOption?.isArchived === true ? (
                    <Badge>{t('filters.archived')}</Badge>
                  ) : null}
                </span>
              }
              supporting={`${bestStrategyAvg.text} ${t('overview.avgSuffix')}`}
              sample={t('axis.tradeCount', { count: bestStrategy.trader.tradeCount })}
            />
          )}
        </div>

        <div className="border-border rounded-lg border p-4 sm:p-5" data-overview-card="best-setup">
          {bestSetup === null || bestSetupAvg?.status !== 'available' ? (
            <p className="text-muted-foreground text-sm">{t('overview.edge.noBestSetup')}</p>
          ) : (
            <HeroMetric
              label={t('overview.edge.bestSetup')}
              value={
                <span className="inline-flex flex-wrap items-center gap-2">
                  {bestSetupOption?.label ?? bestSetup.setupId}
                  {bestSetupOption?.isArchived === true ? (
                    <Badge>{t('filters.archived')}</Badge>
                  ) : null}
                </span>
              }
              supporting={`${bestSetupAvg.text} ${t('overview.avgSuffix')}`}
              sample={t('axis.tradeCount', { count: bestSetup.trader.tradeCount })}
            />
          )}
        </div>

        <div
          className="border-border rounded-lg border p-4 sm:p-5"
          data-overview-card="setup-adherence"
        >
          {!hasAdherenceData ? (
            <p className="text-muted-foreground text-sm">{t('overview.edge.empty')}</p>
          ) : (
            <HeroMetric
              label={t('setupAdherence.average')}
              value={average.text}
              sample={t('setupAdherence.sampleCount', { count: setupAdherence.sampleCount })}
            />
          )}
        </div>
      </div>

      <a
        href="#analytics-setup-quality-heading"
        className="text-primary mt-4 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t('overview.explore')}
      </a>
    </ZoneSection>
  );
}
