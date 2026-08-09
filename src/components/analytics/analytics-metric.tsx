import { useTranslations } from 'next-intl';

import type { AnalyticsMetric, AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import {
  formatAnalyticsMetric,
  type AnalyticsDisplayStyle,
  type AnalyticsDisplayTone,
} from '@/lib/analytics/presentation';
import { cn } from '@/lib/utils';
import { MetricLabel, MetricValue } from '@/components/product/metric';

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

export function AnalyticsMetricDisplay({
  label,
  metric,
  style,
  prominent = false,
  forceNeutral = false,
  className,
}: {
  label: string;
  metric: AnalyticsMetric;
  style: AnalyticsDisplayStyle;
  prominent?: boolean;
  forceNeutral?: boolean;
  className?: string;
}) {
  const t = useTranslations('analytics.real');
  const formatted = formatAnalyticsMetric(metric, style);

  return (
    <div
      data-metric={label}
      data-metric-status={formatted.status}
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
    >
      <dt>
        <MetricLabel>{label}</MetricLabel>
      </dt>
      <dd>
        {formatted.status === 'available' ? (
          <MetricValue
            value={formatted.text}
            className={cn(
              prominent ? 'text-3xl' : 'text-xl',
              forceNeutral ? 'text-foreground' : TONE_CLASS[formatted.tone],
            )}
          />
        ) : (
          <span className="text-muted-foreground text-sm leading-snug">
            {formatted.status === 'error'
              ? t('unavailable.data_integrity_error')
              : t(`unavailable.${formatted.reason as AnalyticsUnavailableReason}`)}
          </span>
        )}
      </dd>
    </div>
  );
}
