import { useTranslations } from 'next-intl';

import type { DimensionAxisSummary } from '@/lib/analytics/metrics';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';

/**
 * One axis's (Trader's or System's) independent sample for a behavioral
 * bucket/level/group — Phase 13H completion, §2/§11. Always shows both
 * sample size and axis identity as text, never relying on color alone to
 * distinguish Trader from System.
 */
export function DimensionAxisSummaryBlock({
  axis,
  summary,
}: {
  axis: 'trader' | 'system';
  summary: DimensionAxisSummary;
}) {
  const t = useTranslations('analytics.real');

  return (
    <div className="min-w-0" data-analytics-axis={axis}>
      <div className="flex items-center justify-between gap-2">
        <span
          className={
            axis === 'trader'
              ? 'text-trader text-xs font-semibold tracking-wide uppercase'
              : 'text-system text-xs font-semibold tracking-wide uppercase'
          }
        >
          {t(`axis.${axis}`)}
        </span>
        <span className="text-muted-foreground text-xs">
          {t('axis.tradeCount', { count: summary.tradeCount })}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        <AnalyticsMetricDisplay label={t('axis.avgR')} metric={summary.averageR} style="r" />
        <AnalyticsMetricDisplay
          label={t('axis.winRate')}
          metric={summary.winRate}
          style="percent"
        />
      </dl>
    </div>
  );
}
