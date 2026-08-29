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

/** One raised metric cell. A surface step, deliberately not a border (§23). */
const SUMMARY_CELL = 'bg-muted/50 flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2';

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
 *
 * R2C §11/§22 — FOUR RAISED CELLS, NOT FOUR FLOATING TEXT BLOCKS. Spread
 * across a full-width section these were four label/value pairs adrift in
 * roughly 1300px of card, ~340px apart, with nothing but whitespace saying
 * they belonged together. Each now sits on `--muted`, one surface step off
 * the card, which groups them into a readable band and uses the horizontal
 * space the section actually has. A step in SURFACE, never a border: outlining
 * four cells inside a bordered card is precisely the nested-box treatment §23
 * rules out.
 *
 * The `totalGapHint` line is gone from this layer. It restated the definition
 * — "Actual R minus System R across paired Trades" — that the section's own
 * info popover already gives more completely and more carefully, and it was
 * the one thing making the first cell taller than the other three.
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
      className={cn('grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-4', className)}
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
      <div data-execution-gap-metric="pairedTrades" className={SUMMARY_CELL}>
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
  const tReal = useTranslations('dashboard.real');
  const formatted = formatAnalyticsMetric(metric, style);

  return (
    <div
      data-execution-gap-metric={metricKey}
      data-metric-status={formatted.status}
      {...(formatted.status === 'unavailable' ? { 'data-metric-reason': formatted.reason } : {})}
      className={SUMMARY_CELL}
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
    </div>
  );
}
