'use client';

import { useTranslations } from 'next-intl';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import type { ExecutionComparisonDailyPoint } from '@/lib/dashboard/execution-comparison';
import {
  CHART_CURSOR_LINE,
  CHART_GRID,
  CHART_MARGIN,
  CHART_X_AXIS,
  CHART_Y_AXIS,
  CHART_ZERO_LINE,
  formatAxisR,
} from '@/components/dashboard/charts/chart-theme';
import { ChartTooltip } from '@/components/dashboard/charts/chart-tooltip';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

/**
 * A daily point with its axis label already resolved.
 *
 * The label is attached on the SERVER, not derived here: these charts are
 * client components, and a function prop cannot cross that boundary at all.
 * Formatting the date where the timezone was resolved also keeps the axis
 * from drifting away from the figures above it in a different locale.
 */
export interface ExecutionComparisonChartPoint extends ExecutionComparisonDailyPoint {
  readonly dateLabel: string;
}

/**
 * SERIES IDENTITY IS NOT A VERDICT.
 *
 * System is the product's interaction blue; Actual is the neutral foreground —
 * near-white on the dark canvas, graphite on the light one. Deliberately NOT
 * green-versus-red, and deliberately not the System/Trader hues either: a
 * green System beside a red Actual would assert that following the rules is
 * virtue and executing is failure, which is exactly the reading CLAUDE.md §1
 * forbids. The two lines are told apart by hue, by stroke style, and by name.
 *
 * The dataviz palette validator reports these two as separated far beyond the
 * threshold that matters — CVD ΔE 41.2 dark / 35.9 light against a target of
 * 8, normal-vision ΔE 45.1 / 35.7 against a floor of 15, and both clear 3:1
 * against their surface. It also flags the Actual slot as achromatic, which
 * is the point rather than a defect: the neutral is chosen, so the redundant
 * encoding below carries identity for anyone the hue does not reach.
 */
const SYSTEM_STROKE = 'var(--primary)';
const ACTUAL_STROKE = 'var(--foreground)';

interface CumulativePlotDatum {
  readonly date: string;
  readonly dateLabel: string;
  readonly systemCoordinate: number;
  readonly actualCoordinate: number;
  readonly systemSource: string;
  readonly actualSource: string;
  readonly gapSource: string;
  readonly pairedTradeCount: number;
}

interface CumulativeTooltipEntry {
  readonly payload?: CumulativePlotDatum | undefined;
}

function CumulativeTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: readonly CumulativeTooltipEntry[] | undefined;
}) {
  const t = useTranslations('dashboard.executionGap');
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (point === undefined) return null;

  // Every figure here is a CANONICAL string from D5A, formatted once at this
  // boundary. The numeric coordinates the SVG needs never reach the reader,
  // so no 12-decimal internal value can leak into a tooltip.
  const cell = (value: string) => {
    const formatted = formatAnalyticsMetric({ status: 'available', value }, 'r');
    return formatted.status === 'available' ? formatted.text : t('notAvailableShort');
  };

  return (
    <ChartTooltip
      title={point.dateLabel}
      footnote={t('tooltip.pairedThroughDate', { count: point.pairedTradeCount })}
      rows={[
        {
          key: 'system',
          label: t('series.system'),
          value: cell(point.systemSource),
          swatchClassName: 'bg-primary',
        },
        {
          key: 'actual',
          label: t('series.actual'),
          value: cell(point.actualSource),
          swatchClassName: 'bg-foreground',
        },
        // The Gap is the only genuinely signed figure of the three — the two
        // cumulative totals are positions, not outcomes — so it is the only
        // one that earns a tone (§28).
        { key: 'gap', label: t('summary.totalGap'), value: cell(point.gapSource) },
      ]}
    />
  );
}

/**
 * Cumulative paired System against cumulative paired Actual.
 *
 * ONE AXIS, ONE POPULATION. Both lines are in R and both are drawn from the
 * SAME Population C rollup, so the vertical distance between them at any
 * point IS the cumulative Execution Gap. Plotting D4's independent Population
 * A and B totals here would put two different Trade universes on one pair of
 * axes and the visible distance would mean nothing.
 *
 * NOTHING IS COMPUTED HERE. D5A supplies `cumulativeSystemR`,
 * `cumulativeActualR` and `cumulativeExecutionGapR` already accumulated and
 * already rounded once; this component converts them to SVG coordinates and
 * formats them for display, and does no arithmetic of its own.
 *
 * `type="linear"`, never `monotone`: a spline through cumulative equity draws
 * values the account never held, which on a chart whose whole subject is the
 * distance between two lines is not a cosmetic difference.
 */
export function CumulativeComparisonChart({
  points,
}: {
  points: readonly ExecutionComparisonChartPoint[];
}) {
  const t = useTranslations('dashboard.executionGap');
  const prefersReducedMotion = usePrefersReducedMotion();

  // Recharts needs numbers. D5A guarantees canonical decimal strings, so the
  // finite check is a guard against a future contract change reaching an SVG
  // as NaN rather than an expected branch.
  const data: CumulativePlotDatum[] = points.flatMap((point) => {
    const systemCoordinate = Number(point.cumulativeSystemR);
    const actualCoordinate = Number(point.cumulativeActualR);
    if (!Number.isFinite(systemCoordinate) || !Number.isFinite(actualCoordinate)) return [];
    return [
      {
        date: point.date,
        dateLabel: point.dateLabel,
        systemCoordinate,
        actualCoordinate,
        systemSource: point.cumulativeSystemR,
        actualSource: point.cumulativeActualR,
        gapSource: point.cumulativeExecutionGapR,
        pairedTradeCount: point.pairedTradeCount,
      },
    ];
  });

  return (
    <div
      // R2C §13 — down from `h-56/64/72`. The old height made this one chart
      // taller than the entire System-vs-Trader section above it, which is
      // not the rank it holds: it explains a difference the four summary
      // figures have already stated. 176/192/224px is still ample to read the
      // divergence between two lines, which is the only thing being read here.
      className="h-44 w-full min-w-0 sm:h-48 lg:h-56"
      role="img"
      aria-label={t('chart.cumulativeAriaLabel')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid {...CHART_GRID} />
          {/*
            Thinned rather than shrunk or rotated: fewer readable dates beat
            many unreadable ones, and neither costs the reader a horizontal
            pan. `CHART_X_AXIS` raises the gap from 40px to 64px — at 1792px
            the old value permitted a wall of ~40 date labels.
          */}
          <XAxis dataKey="dateLabel" {...CHART_X_AXIS} />
          <YAxis
            {...CHART_Y_AXIS}
            // No `domain` override: the axis is never cropped to positives,
            // so a cumulative line that goes below zero stays visible and the
            // gap between the two lines is never visually exaggerated.
            tickFormatter={formatAxisR}
          />
          <ReferenceLine y={0} {...CHART_ZERO_LINE} />
          <Tooltip content={<CumulativeTooltip />} cursor={CHART_CURSOR_LINE} />
          {/* Dashed because the System line is counterfactual — what the rules
              would have produced. Solid because the Actual line happened. That
              reads in greyscale and under any colour vision. */}
          {/*
            THE TWO LINES ARE NOT EQUALLY LOUD, AND WHICH ONE IS LOUDER IS A
            DECISION (§12). A dash pattern already attracts the eye, so the
            counterfactual System line at the same 2px weight was reading as
            the subject of the chart; it is now the thinner of the two, on a
            tighter dash. The Actual line — what the trader's execution
            actually did — is the solid, heavier, brightest mark. `dot={false}`
            keeps a 60-point series calm; identity arrives on hover instead
            (§27), and the ring is the card colour so the point reads as
            lifted off the plot rather than drawn on it.
          */}
          <Line
            type="linear"
            dataKey="systemCoordinate"
            stroke={SYSTEM_STROKE}
            strokeWidth={1.75}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />
          <Line
            type="linear"
            dataKey="actualCoordinate"
            stroke={ACTUAL_STROKE}
            strokeWidth={2.25}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
