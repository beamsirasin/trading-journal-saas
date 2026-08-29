'use client';

import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import {
  CHART_CURSOR_FILL,
  CHART_MARGIN,
  CHART_X_AXIS_HIDDEN,
  CHART_Y_AXIS,
  CHART_ZERO_LINE,
  formatAxisR,
} from '@/components/dashboard/charts/chart-theme';
import { ChartTooltip } from '@/components/dashboard/charts/chart-tooltip';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

import type { ExecutionComparisonChartPoint } from './cumulative-comparison-chart';

interface DailyPlotDatum {
  readonly dateLabel: string;
  readonly gapCoordinate: number;
  readonly gapSource: string;
  readonly systemSource: string;
  readonly actualSource: string;
  readonly pairedTradeCount: number;
}

interface DailyTooltipEntry {
  readonly payload?: DailyPlotDatum | undefined;
}

function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: readonly DailyTooltipEntry[] | undefined;
}) {
  const t = useTranslations('dashboard.executionGap');
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (point === undefined) return null;

  const cell = (value: string) => {
    const formatted = formatAnalyticsMetric({ status: 'available', value }, 'r');
    return formatted.status === 'available' ? formatted.text : t('notAvailableShort');
  };

  return (
    <ChartTooltip
      title={point.dateLabel}
      footnote={t('tooltip.pairedOnDate', { count: point.pairedTradeCount })}
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
        { key: 'gap', label: t('daily.gapRow'), value: cell(point.gapSource) },
      ]}
    />
  );
}

/**
 * Per-day Execution Gap, zero-centred.
 *
 * The companion to the cumulative plot rather than a rival to it: the
 * cumulative lines answer "where did the difference end up", this answers
 * "which days moved it". They share an x-axis of the same local dates from
 * the same `dailySeries`, so a reader can put one above the other and follow a
 * single day down the page — which is why this is a short strip inside the
 * same section and not a second full-height card.
 *
 * SIGN IS THE DATA, NOT A JUDGEMENT. A bar's direction and colour come
 * straight from D5A's `executionGapR` for that day. Nothing is recomputed
 * here: `actualR - systemR` is never evaluated in React.
 *
 * Colour is never the only channel — the bar's direction relative to the zero
 * line already says the sign, and the tooltip and the sr-only table say it in
 * words with an explicit `+`/`-`.
 */
export function DailyGapChart({ points }: { points: readonly ExecutionComparisonChartPoint[] }) {
  const t = useTranslations('dashboard.executionGap');
  const prefersReducedMotion = usePrefersReducedMotion();

  const data: DailyPlotDatum[] = points.flatMap((point) => {
    const gapCoordinate = Number(point.executionGapR);
    if (!Number.isFinite(gapCoordinate)) return [];
    return [
      {
        dateLabel: point.dateLabel,
        gapCoordinate,
        gapSource: point.executionGapR,
        systemSource: point.systemR,
        actualSource: point.actualR,
        pairedTradeCount: point.pairedTradeCount,
      },
    ];
  });

  return (
    <div
      // R2C §14 — a STRIP, at 56/64px rather than 96/112px. It sits directly
      // beneath the cumulative plot, whose taller frame it was competing with
      // at the old height while saying strictly less.
      className="h-14 w-full min-w-0 sm:h-16"
      role="img"
      aria-label={t('chart.dailyAriaLabel')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={CHART_MARGIN}>
          {/*
            THE X AXIS IS HIDDEN, NOT ABSENT. It is the same categories, in the
            same order, as the chart directly above — printing the dates twice
            spent ~24px on a duplicate and made the pair read as two unrelated
            charts. Recharts still needs the axis for its scale. Alignment is
            what makes this safe: both charts share `CHART_MARGIN` and the
            fixed `CHART_Y_AXIS` width, so a bar sits exactly under the day it
            belongs to and the reader follows one column straight up.
          */}
          <XAxis dataKey="dateLabel" {...CHART_X_AXIS_HIDDEN} />
          {/*
            Three ticks, not Recharts' default five: on a 56px strip the
            intermediate labels overlap each other, and the magnitude a reader
            needs is the extreme rather than the interval.
          */}
          <YAxis {...CHART_Y_AXIS} tickCount={3} tickFormatter={formatAxisR} />
          {/* Zero is the axis this chart is about, so it is drawn rather than
              inferred from where the bars happen to meet. */}
          <ReferenceLine y={0} {...CHART_ZERO_LINE} />
          <Tooltip content={<DailyTooltip />} cursor={CHART_CURSOR_FILL} />
          <Bar
            dataKey="gapCoordinate"
            radius={[2, 2, 2, 2]}
            maxBarSize={10}
            isAnimationActive={!prefersReducedMotion}
          >
            {data.map((point) => (
              <Cell
                key={point.dateLabel}
                fill={
                  point.gapCoordinate < 0
                    ? 'var(--negative)'
                    : point.gapCoordinate > 0
                      ? 'var(--positive)'
                      : 'var(--muted-foreground)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
