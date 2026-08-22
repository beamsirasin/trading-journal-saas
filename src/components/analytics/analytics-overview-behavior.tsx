import { Brain } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ConfidenceAnalyticsModel, EmotionGroupModel } from '@/lib/analytics/metrics';
import {
  selectEmotionConcern,
  selectStrongestConfidenceLevel,
  selectStrongestEmotion,
} from '@/lib/analytics/overview-selectors';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { HeroMetric } from '@/components/product/summary-primitives';
import { ZoneSection } from '@/components/product/zone-section';
import { Link } from '@/i18n/navigation';

/**
 * Phase 15C — Analytics Overview, BEHAVIOR zone. Confidence and Emotion each
 * get exactly one observation card (Trader-side only, matching the existing
 * Phase 13H convention that Trader is the primary behavioral axis) instead
 * of leading with the full bucket/group table — the full independent
 * Trader/System comparison for every level and every Emotion remains fully
 * intact in the existing "Psychology" section below (Explore), Option C of
 * the brief's §19 treatment (see the Phase 15 doc for the recorded
 * rationale). No new calculation: the "strongest observed" values are picked
 * from data `composeConfidenceAnalytics`/`composeEmotionAnalytics` already
 * returned (`lib/analytics/overview-selectors.ts`).
 */
export function BehaviorZone({
  confidence,
  emotions,
  exploreHref,
}: {
  confidence: ConfidenceAnalyticsModel;
  emotions: readonly EmotionGroupModel[];
  exploreHref: string;
}) {
  const t = useTranslations('analytics.real');
  const tZones = useTranslations('zones');
  const tTrades = useTranslations('trades');

  const strongestConfidence = selectStrongestConfidenceLevel(confidence);
  const strongestEmotion = selectStrongestEmotion(emotions);
  const emotionConcern = selectEmotionConcern(emotions, strongestEmotion?.key ?? null);

  const emotionLabel = (key: string, fallback: string) =>
    tTrades.has(`emotions.${key}`) ? tTrades(`emotions.${key}`) : fallback;

  /** Selectors only ever return a valid decimal string, so this always formats — the explicit status check is what satisfies `exactOptionalPropertyTypes`, not a real fallback path. */
  const formatAvgR = (value: string) => {
    const formatted = formatAnalyticsMetric({ status: 'available', value }, 'r');
    return formatted.status === 'available' ? formatted.text : '—';
  };

  return (
    <ZoneSection
      zone="behavior"
      icon={Brain}
      title={tZones('behavior')}
      description={t('overview.behavior.description')}
      id="analytics-overview-behavior"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="border-border rounded-lg border p-4 sm:p-5" data-overview-card="confidence">
          {strongestConfidence === null ? (
            <p className="text-muted-foreground text-sm">
              {t('overview.behavior.confidenceEmpty')}
            </p>
          ) : (
            <HeroMetric
              label={t('overview.behavior.strongestConfidence')}
              value={t('confidence.levelLabel', { level: strongestConfidence.level })}
              supporting={`${formatAvgR(strongestConfidence.averageR)} ${t('overview.avgSuffix')}`}
              sample={t('axis.tradeCount', { count: strongestConfidence.tradeCount })}
            />
          )}
        </div>

        <div className="border-border rounded-lg border p-4 sm:p-5" data-overview-card="emotion">
          {strongestEmotion === null ? (
            <p className="text-muted-foreground text-sm">{t('overview.behavior.emotionEmpty')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              <HeroMetric
                label={t('overview.behavior.strongestEmotion')}
                value={emotionLabel(strongestEmotion.key, strongestEmotion.label)}
                supporting={`${formatAvgR(strongestEmotion.averageR)} ${t('overview.avgSuffix')}`}
                sample={t('axis.tradeCount', { count: strongestEmotion.tradeCount })}
              />
              {emotionConcern === null ? null : (
                <HeroMetric
                  className="border-border border-t pt-4"
                  label={t('overview.behavior.emotionConcern')}
                  value={emotionLabel(emotionConcern.key, emotionConcern.label)}
                  supporting={`${formatAvgR(emotionConcern.averageR)} ${t('overview.avgSuffix')}`}
                  sample={t('axis.tradeCount', { count: emotionConcern.tradeCount })}
                />
              )}
            </div>
          )}
        </div>
      </div>

      <Link
        href={exploreHref}
        className="text-primary mt-4 inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline"
      >
        {t('overview.explore')}
      </Link>
    </ZoneSection>
  );
}
