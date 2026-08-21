import { Compass } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { SetupAdherenceAnalyticsModel } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { HeroMetric } from '@/components/product/summary-primitives';
import { ZoneSection } from '@/components/product/zone-section';

/**
 * Phase 15C — Analytics Overview, EDGE zone. Setup Adherence is the ONLY
 * card here this phase — Strategy Performance and Setup Performance ("best
 * observed Strategy/Setup") are explicitly Phase 15D work (brief §11/§13):
 * no current component compares Trades across multiple Strategies/Setups,
 * so there is nothing truthful to summarize yet. A clean, smaller Edge zone
 * now beats a fake "Coming soon" placeholder (brief §11).
 *
 * Preserves the existing Setup Adherence formula/sample-count exactly — this
 * card only relocates the two headline figures (`averageAdherence`,
 * `sampleCount`) that `composeSetupAdherenceAnalytics` already computes; the
 * full bucket breakdown and Setup Condition performance stay in the existing
 * "Setup Quality" section below, reachable via Explore.
 */
export function EdgeZone({ setupAdherence }: { setupAdherence: SetupAdherenceAnalyticsModel }) {
  const t = useTranslations('analytics.real');
  const tZones = useTranslations('zones');
  const average = formatAnalyticsMetric(setupAdherence.averageAdherence, 'percent');
  const hasData = setupAdherence.sampleCount > 0 && average.status === 'available';

  return (
    <ZoneSection
      zone="edge"
      icon={Compass}
      title={tZones('edge')}
      description={t('overview.edge.description')}
      id="analytics-overview-edge"
    >
      <div className="border-border rounded-lg border p-4 sm:p-5">
        {!hasData ? (
          <p className="text-muted-foreground text-sm">{t('overview.edge.empty')}</p>
        ) : (
          <HeroMetric
            label={t('setupAdherence.average')}
            value={average.text}
            sample={t('setupAdherence.sampleCount', { count: setupAdherence.sampleCount })}
          />
        )}
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
