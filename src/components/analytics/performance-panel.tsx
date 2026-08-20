import { MonitorCog, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import { cn } from '@/lib/utils';
import { AnalyticsMetricDisplay } from '@/components/analytics/analytics-metric';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
    <Card
      data-analytics-panel={series}
      className={cn(
        'overflow-hidden border-t-4',
        series === 'system' ? 'border-t-system' : 'border-t-trader',
      )}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg',
                series === 'system' ? 'bg-system/10 text-system' : 'bg-trader/10 text-trader',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <CardTitle>{t(`${series}.title`)}</CardTitle>
              <CardDescription className="mt-1">{t(`${series}.description`)}</CardDescription>
            </div>
          </div>
          <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-1 text-xs font-medium">
            {t('sampleCount', { count: metrics.sampleCount })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
