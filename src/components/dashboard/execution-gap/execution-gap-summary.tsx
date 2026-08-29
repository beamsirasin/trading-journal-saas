import { useTranslations } from 'next-intl';

import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import {
  formatAnalyticsMetric,
  type AnalyticsDisplayStyle,
  type AnalyticsDisplayTone,
} from '@/lib/analytics/presentation';
import type { DashboardExecutionComparison } from '@/lib/dashboard/execution-comparison';
import { cn } from '@/lib/utils';
import { MetricLabel } from '@/components/product/metric';

const TONE_CLASS: Record<AnalyticsDisplayTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  neutral: 'text-foreground',
};

/**
 * The four figures that answer the section's question in text, before any
 * chart is read.
 *
 * They exist as much for accessibility as for scanning: a chart must never be
 * the sole carrier of critical information, and these are the critical
 * information. Every one of them is a canonical D5A metric formatted once
 * here — no ratio is divided, no total is summed, and Average Gap in
 * particular is D5A's own `averageExecutionGapR` rather than
 * `total / count` re-derived in React, which would re-round an already
 * rounded figure.
 */
export function ExecutionGapSummary({
  comparison,
  className,
}: {
  comparison: DashboardExecutionComparison;
  className?: string;
}) {
  const t = useTranslations('dashboard.executionGap');
  const summary = comparison.summary;

  return (
    <dl
      data-execution-gap-summary
      className={cn('grid min-w-0 grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4', className)}
    >
      {/*
        Total Gap keeps its signed tone: negative means the Trader captured
        less R than the paired System, positive means more. The formula is
        never reversed to make a negative read as a friendly positive — a
        chart whose sign flips between the axis and the summary is worse than
        one that says an uncomfortable thing plainly.
      */}
      <SummaryMetric
        metricKey="totalGap"
        label={t('summary.totalGap')}
        metric={summary.executionGapR}
        style="r"
        prominent
      />
      <SummaryMetric
        metricKey="averageGap"
        label={t('summary.averageGap')}
        metric={summary.averageExecutionGapR}
        style="r"
      />
      {/*
        System Edge Captured is a NUMBER, never a progress bar or a gauge.
        `137%` and `-22%` are both canonical results, and every bar or radial
        meter would have to clamp them — turning a real "captured more than
        the System offered" into a full bar indistinguishable from exactly
        100%. A clamped chart of an unclamped metric is a lie.
      */}
      <SummaryMetric
        metricKey="systemEdgeCaptured"
        label={t('summary.systemEdgeCaptured')}
        metric={summary.systemEdgeCaptured}
        style="percent"
        forceNeutral
      />
      <div data-execution-gap-metric="pairedTrades" className="flex min-w-0 flex-col gap-0.5">
        <dt>
          <MetricLabel variant="plain">{t('summary.pairedTrades')}</MetricLabel>
        </dt>
        <dd className="numeric text-xl leading-7 font-semibold tracking-tight">
          {summary.comparableCount}
        </dd>
      </div>
    </dl>
  );
}

function SummaryMetric({
  metricKey,
  label,
  metric,
  style,
  prominent = false,
  forceNeutral = false,
}: {
  metricKey: string;
  label: string;
  metric: Parameters<typeof formatAnalyticsMetric>[0];
  style: AnalyticsDisplayStyle;
  prominent?: boolean;
  forceNeutral?: boolean;
}) {
  const t = useTranslations('dashboard.executionGap');
  const tReal = useTranslations('dashboard.real');
  const formatted = formatAnalyticsMetric(metric, style);

  return (
    <div
      data-execution-gap-metric={metricKey}
      data-metric-status={formatted.status}
      {...(formatted.status === 'unavailable' ? { 'data-metric-reason': formatted.reason } : {})}
      className="flex min-w-0 flex-col gap-0.5"
    >
      <dt>
        <MetricLabel variant="plain" className="break-words">
          {label}
        </MetricLabel>
      </dt>
      <dd className="min-w-0">
        {formatted.status === 'available' ? (
          <span
            className={cn(
              'numeric font-semibold tracking-tight break-words',
              prominent ? 'text-2xl leading-8' : 'text-xl leading-7',
              forceNeutral ? 'text-foreground' : TONE_CLASS[formatted.tone],
            )}
          >
            {formatted.text}
          </span>
        ) : (
          // The reason is words, not an empty cell — "No positive paired
          // System edge" is a different fact from "no data", and only one of
          // them is the reader's to act on.
          <span className="text-muted-foreground text-sm leading-snug">
            {formatted.status === 'error'
              ? tReal('unavailable.data_integrity_error')
              : tReal(`unavailable.${formatted.reason as AnalyticsUnavailableReason}`)}
          </span>
        )}
      </dd>
      {metricKey === 'totalGap' ? (
        <p className="text-muted-foreground text-xs leading-4">{t('summary.totalGapHint')}</p>
      ) : null}
    </div>
  );
}
