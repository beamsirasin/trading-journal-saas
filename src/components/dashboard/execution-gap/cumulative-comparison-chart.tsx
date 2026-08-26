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
  const rows = [
    { key: 'system', label: t('series.system'), value: point.systemSource },
    { key: 'actual', label: t('series.actual'), value: point.actualSource },
    { key: 'gap', label: t('summary.totalGap'), value: point.gapSource },
  ] as const;

  return (
    <div className="bg-popover text-popover-foreground border-border shadow-popover max-w-56 rounded-md border px-3 py-2">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">{point.dateLabel}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const formatted = formatAnalyticsMetric({ status: 'available', value: row.value }, 'r');
          return (
            <li key={row.key} className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="numeric text-foreground ml-auto font-semibold">
                {formatted.status === 'available' ? formatted.text : t('notAvailableShort')}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground border-border mt-1.5 border-t pt-1.5 text-xs">
        {t('tooltip.pairedThroughDate', { count: point.pairedTradeCount })}
      </p>
    </div>
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
      className="h-64 w-full min-w-0 sm:h-72 lg:h-80"
      role="img"
      aria-label={t('chart.cumulativeAriaLabel')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="dateLabel"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            // Thin the labels at narrow widths rather than shrinking or
            // rotating them: fewer readable dates beat many unreadable ones,
            // and neither costs the reader a horizontal pan.
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
            // No `domain` override: the axis is never cropped to positives,
            // so a cumulative line that goes below zero stays visible and the
            // gap between the two lines is never visually exaggerated.
            tickFormatter={(value: number) => `${value}R`}
          />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
          <Tooltip
            content={<CumulativeTooltip />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          {/* Dashed because the System line is counterfactual — what the rules
              would have produced. Solid because the Actual line happened. That
              reads in greyscale and under any colour vision. */}
          <Line
            type="linear"
            dataKey="systemCoordinate"
            stroke={SYSTEM_STROKE}
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />
          <Line
            type="linear"
            dataKey="actualCoordinate"
            stroke={ACTUAL_STROKE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
