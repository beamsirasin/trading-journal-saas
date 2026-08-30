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
 * One raised metric cell. A surface step, deliberately not a border (§23).
 *
 * `sm:w-52` fixes the pair's footprint so neither cell grows with the card:
 * the Gap's widest real value is a signed four-character R and the ratio's is
 * a signed percentage, both of which fit comfortably, and an unavailable
 * state's sentence wraps inside the same box rather than reflowing the row.
 */
const SUMMARY_CELL =
  'bg-muted/50 flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2 sm:w-52 sm:shrink-0';

/**
 * The two figures that answer the section's question in text, before any
 * chart is read.
 *
 * They exist as much for accessibility as for scanning: a chart must never be
 * the sole carrier of critical information, and these are the critical
 * information. Both are canonical D5A metrics formatted once here — no ratio
 * is divided and no total is summed in React.
 *
 * TWO, DOWN FROM FOUR, BY EXPLICIT PRODUCT DECISION. Average Execution Gap
 * and the paired Trade count left the first layer. The Dashboard is the
 * DETECT surface and this section answers exactly two questions — how much R
 * the execution gave up or gained against the paired System, and how much of
 * that System's edge it captured. Both retired figures remain computed and
 * remain on `DashboardExecutionComparison`; `averageExecutionGapR` in
 * particular is untouched as a diagnostic, and the paired count is still
 * carried by the chart's own tooltip and by its screen-reader table, so
 * sample size never becomes unknowable — it simply stops being a third
 * headline (§17).
 *
 * WHICH R FIGURE IS THE HEADLINE IS A RECORDED DECISION, NOT A DEFAULT.
 * `CLAUDE.md` §6 and the Phase 13H freeze name `averageExecutionGapR` the
 * primary ANALYTICAL aggregate. For the Dashboard's headline the product
 * decision is the summed `executionGapR`: "you captured 13.80R less than the
 * paired System offered" is the magnitude a trader acts on, where a -0.22R
 * per-Trade average reads as noise at a glance. The average is not
 * demoted anywhere else and no formula changed.
 *
 * HIERARCHY IS TWO STEPS, NOT TWO EQUAL BOXES (§8). The Gap is the answer and
 * is set a full step above System Edge Captured, which qualifies it. Two
 * equal cells stretched across a full-width card would read as a second KPI
 * row, which is precisely what this section is not.
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
      // Content-sized, never stretched. With four cells this was a
      // `flex-1 sm:grid-cols-4` band that used the card's whole width; two
      // cells given the same treatment would each be ~640px of surface
      // holding one number. Fixed minimums keep them a readable PAIR and let
      // the header keep the width it no longer has to compete for.
      className={cn('grid min-w-0 grid-cols-2 gap-1.5 sm:flex sm:flex-none', className)}
    >
      {/*
        The Gap keeps its signed tone: negative means the Trader captured less
        R than the paired System, positive means more. The formula is never
        reversed to make a negative read as a friendly positive — a chart
        whose sign flips between the axis and the summary is worse than one
        that says an uncomfortable thing plainly.
      */}
      <SummaryMetric
        metricKey="totalGap"
        label={t('summary.totalGap')}
        metric={summary.executionGapR}
        style="r"
        prominent
      />
      {/*
        System Edge Captured is a NUMBER, never a progress bar or a gauge.
        `137%` and `-22%` are both canonical results, and every bar or radial
        meter would have to clamp them — turning a real "captured more than
        the System offered" into a full bar indistinguishable from exactly
        100%. A clamped chart of an unclamped metric is a lie, which is why
        this metric has no visual indicator at all.
      */}
      <SummaryMetric
        metricKey="systemEdgeCaptured"
        label={t('summary.systemEdgeCaptured')}
        metric={summary.systemEdgeCaptured}
        style="percent"
        forceNeutral
      />
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
              // A full step, not a nudge: the Gap is the section's answer and
              // System Edge Captured qualifies it. At `text-2xl` against
              // `text-xl` the two read as siblings, which is the "second KPI
              // row" reading §8 rules out.
              //
              // 24px below `sm`, though. At 320 the two cells share 256px of
              // card, leaving ~101px of content each, and `-13.80R` set at
              // 30px in the tabular mono stack needs ~109px — it broke mid
              // numeral, onto a second line ending in a lone "R". A figure
              // that wraps is worse than a figure one step smaller, and the
              // step against `text-xl` survives either way.
              prominent ? 'text-2xl leading-8 sm:text-3xl sm:leading-9' : 'text-xl leading-7',
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
