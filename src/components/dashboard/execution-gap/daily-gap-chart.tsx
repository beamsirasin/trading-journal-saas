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

  const rows = [
    { key: 'system', label: t('series.system'), value: point.systemSource },
    { key: 'actual', label: t('series.actual'), value: point.actualSource },
    { key: 'gap', label: t('daily.gapRow'), value: point.gapSource },
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
        {t('tooltip.pairedOnDate', { count: point.pairedTradeCount })}
      </p>
    </div>
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
    <div className="h-28 w-full min-w-0 sm:h-32" role="img" aria-label={t('chart.dailyAriaLabel')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
          <XAxis
            dataKey="dateLabel"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={46}
            tickFormatter={(value: number) => `${value}R`}
          />
          {/* Zero is the axis this chart is about, so it is drawn rather than
              inferred from where the bars happen to meet. */}
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
          <Tooltip content={<DailyTooltip />} cursor={{ fill: 'var(--muted)', fillOpacity: 0.4 }} />
          <Bar
            dataKey="gapCoordinate"
            radius={[2, 2, 2, 2]}
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
