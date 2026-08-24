import { MonitorCog, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import { cn } from '@/lib/utils';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { Link } from '@/i18n/navigation';

export function PerformancePanel({
  series,
  metrics,
  pendingCount,
}: {
  series: 'system' | 'trader';
  metrics: PerformanceAnalyticsModel;
  /** Phase 14C §19 — System-axis only; `undefined`/omitted on the Trader panel. */
  pendingCount?: number;
}) {
  const t = useTranslations('analytics.real');
  const Icon = series === 'system' ? MonitorCog : UserRound;

  return (
    <section
      data-analytics-panel={series}
      className="border-border min-w-0 overflow-hidden border-y"
    >
      <div className="border-border border-b px-1 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
                series === 'system' ? 'bg-system/10 text-system' : 'bg-trader/10 text-trader',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-base font-semibold">{t(`${series}.title`)}</h3>
            </div>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-medium">
            {t('sampleCount', { count: metrics.sampleCount })}
          </span>
        </div>
      </div>
      <div className="px-1 py-5">
        {series === 'system' && pendingCount !== undefined && pendingCount > 0 ? (
          <div className="border-border bg-muted/40 mb-5 flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <span>
              {t('resolvedCount', { count: metrics.sampleCount })}
              {' · '}
              {t('pendingCount', { count: pendingCount })}
            </span>
            <Link
              href="/app/trades"
              className="text-primary min-h-11 shrink-0 content-center font-medium underline-offset-4 hover:underline"
            >
              {t('reviewPending')}
            </Link>
          </div>
        ) : null}
        {metrics.sampleCount === 0 ? (
          <p className="border-border bg-muted/40 text-muted-foreground mb-5 rounded-md border p-3 text-sm">
            {t(`${series}.empty`)}
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          <AnalyticsMetricDisplay
            className="col-span-2 border-b pb-5"
            label={t('metrics.totalR')}
            metric={metrics.totalR}
            style="r"
            prominent
          />
          <AnalyticsMetricDisplay
            label={t('metrics.expectancy')}
            metric={metrics.expectancyR}
            style="r"
          />
          <AnalyticsMetricDisplay
            label={t('metrics.winRate')}
            metric={metrics.winRate}
            style="percent"
          />
          <AnalyticsMetricDisplay
            label={t('metrics.profitFactor')}
            metric={metrics.profitFactor}
            style="factor"
          />
          <AnalyticsMetricDisplay
            label={t('metrics.maximumDrawdown')}
            metric={metrics.maximumDrawdownR}
            style="r"
            forceNeutral
          />
          <AnalyticsMetricDisplay
            label={t('metrics.averageWin')}
            metric={metrics.averageWinR}
            style="r"
          />
          <AnalyticsMetricDisplay
            label={t('metrics.averageLoss')}
            metric={metrics.averageLossR}
            style="r"
          />
          <AnalyticsMetricDisplay
            label={t('metrics.payoffRatio')}
            metric={metrics.payoffRatio}
            style="factor"
          />
        </dl>
      </div>
    </section>
  );
}
