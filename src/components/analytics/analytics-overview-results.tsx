import { LineChart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ComparisonAnalyticsModel, PerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import { selectExecutionGapObservation } from '@/lib/analytics/overview-selectors';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { ActionableNotice } from '@/components/product/actionable-notice';
import { HeroMetric, InsightNote } from '@/components/product/summary-primitives';
import { ZoneSection } from '@/components/product/zone-section';
import { Link } from '@/i18n/navigation';

/**
 * Phase 15C — Analytics Overview, RESULTS zone. Answers "what happened?"
 * first: Trader Total R and System Total R as the two hero answers, each
 * with exactly one supporting stat and a factual sample count — every other
 * Trader/System metric (Expectancy, Profit Factor, Drawdown, Avg Win/Loss,
 * Payoff Ratio, the equity curves) stays one "Explore" click below, in the
 * existing "System and Trader Performance" section, untouched.
 *
 * Uses ONLY already-composed `AnalyticsSnapshot` data — no new server/DAL
 * composition (brief §35).
 */
export function ResultsZone({
  trader,
  system,
  systemPendingCount,
  comparison,
  exploreHref,
}: {
  trader: PerformanceAnalyticsModel;
  system: PerformanceAnalyticsModel;
  systemPendingCount: number;
  comparison: ComparisonAnalyticsModel;
  exploreHref: string;
}) {
  const t = useTranslations('analytics.real');
  const tZones = useTranslations('zones');
  const gap = selectExecutionGapObservation(comparison);

  const traderTotal = formatAnalyticsMetric(trader.totalR, 'r');
  const traderWinRate = formatAnalyticsMetric(trader.winRate, 'percent');
  const systemTotal = formatAnalyticsMetric(system.totalR, 'r');
  const systemWinRate = formatAnalyticsMetric(system.winRate, 'percent');

  return (
    <ZoneSection
      zone="results"
      icon={LineChart}
      title={tZones('results')}
      description={t('overview.results.description')}
      id="analytics-overview-results"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="border-border rounded-lg border p-4 sm:p-5" data-overview-card="trader">
          {trader.sampleCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('overview.results.traderEmptyTitle')}
            </p>
          ) : (
            <HeroMetric
              label={t('overview.results.traderHero')}
              value={traderTotal.status === 'available' ? traderTotal.text : '—'}
              supporting={
                traderWinRate.status === 'available'
                  ? `${traderWinRate.text} ${t('metrics.winRate')}`
                  : undefined
              }
              sample={t('sampleCount', { count: trader.sampleCount })}
            />
          )}
        </div>

        <div className="border-border rounded-lg border p-4 sm:p-5" data-overview-card="system">
          {system.sampleCount === 0 && systemPendingCount === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t('overview.results.systemEmptyTitle')}
            </p>
          ) : (
            <HeroMetric
              label={t('overview.results.systemHero')}
              value={systemTotal.status === 'available' ? systemTotal.text : '—'}
              supporting={
                systemWinRate.status === 'available'
                  ? `${systemWinRate.text} ${t('metrics.winRate')}`
                  : undefined
              }
              sample={t('resolvedCount', { count: system.sampleCount })}
              action={
                systemPendingCount > 0 ? (
                  <ActionableNotice
                    fact={t('pendingCount', { count: systemPendingCount })}
                    actionLabel={t('reviewPending')}
                    href="/app/trades?view=log&attention=system-pending"
                  />
                ) : undefined
              }
            />
          )}
        </div>
      </div>

      <InsightNote
        className="mt-4"
        {...(gap === null ? {} : { observation: t(`overview.results.insight.${gap.tone}`) })}
        sample={
          gap === null ? null : t('overview.results.insight.sample', { count: gap.comparableCount })
        }
        noPatternMessage={t('overview.results.insight.independent')}
      />

      <Link
        href={exploreHref}
        className="text-primary mt-4 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t('overview.explore')}
      </Link>
    </ZoneSection>
  );
}
