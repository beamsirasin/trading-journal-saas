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

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import { formatAnalyticsMetric } from '@/lib/analytics/presentation';
import { ChartContainer } from '@/components/product/chart-container';
import { Card, CardContent } from '@/components/ui/card';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

export interface AnalyticsEquityDisplayPoint {
  readonly tradeId: string;
  readonly occurredAt: string;
  readonly occurredAtDisplay: string;
  readonly cumulativeR: string;
}

interface EquityTooltipEntry {
  readonly payload?: { readonly cumulativeRSource?: string } | undefined;
}

function EquityTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean | undefined;
  payload?: readonly EquityTooltipEntry[] | undefined;
  label?: string | number | undefined;
}) {
  const t = useTranslations('analytics.real');
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const source = payload[0]?.payload?.cumulativeRSource;
  const formatted =
    source === undefined
      ? null
      : formatAnalyticsMetric({ status: 'available', value: source }, 'r');

  return (
    <div className="bg-popover text-popover-foreground border-border shadow-popover rounded-md border px-3 py-2">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">{String(label ?? '')}</p>
      <p className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">{t('equity.cumulativeR')}</span>
        <span className="numeric text-foreground ml-auto font-semibold">
          {formatted?.status === 'available' ? formatted.text : t('notAvailableShort')}
        </span>
      </p>
    </div>
  );
}

function EquityFallbackTable({
  points,
  series,
}: {
  points: readonly AnalyticsEquityDisplayPoint[];
  series: 'system' | 'trader';
}) {
  const t = useTranslations('analytics.real');
  return (
    <table>
      <caption>{t(`equity.${series}.tableCaption`)}</caption>
      <thead>
        <tr>
          <th scope="col">{t('equity.date')}</th>
          <th scope="col">{t('equity.cumulativeR')}</th>
        </tr>
      </thead>
      <tbody>
        {points.map((point) => {
          const value = formatAnalyticsMetric(
            { status: 'available', value: point.cumulativeR },
            'r',
          );
          return (
            <tr key={point.tradeId}>
              <th scope="row">{point.occurredAtDisplay}</th>
              <td>{value.status === 'available' ? value.text : t('notAvailableShort')}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EquityPlot({ points }: { points: readonly AnalyticsEquityDisplayPoint[] }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // Recharts requires numeric geometry. Canonical strings remain alongside
  // these coordinates and are used for tooltip/table presentation.
  const data = points.map((point) => ({
    ...point,
    cumulativeRCoordinate: Number(point.cumulativeR),
    cumulativeRSource: point.cumulativeR,
  }));

  return (
    <div className="h-72 w-full min-w-0 sm:h-80">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="occurredAtDisplay"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(value: number) => `${value}R`}
          />
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />
          <Tooltip
            content={<EquityTooltip />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />
          <Line
            type="linear"
            dataKey="cumulativeRCoordinate"
            stroke="var(--chart-1)"
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

export function EquityChart({
  series,
  metric,
  points,
}: {
  series: 'system' | 'trader';
  metric: AnalyticsMetric<unknown>;
  points: readonly AnalyticsEquityDisplayPoint[];
}) {
  const t = useTranslations('analytics.real');

  if (metric.status !== 'available' || points.length === 0) {
    return (
      <Card data-equity-chart={series}>
        <CardContent className="flex min-h-56 flex-col justify-center gap-2 pt-5 sm:pt-6">
          <h3 className="text-card-title">{t(`equity.${series}.title`)}</h3>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {metric.status === 'error'
              ? t('unavailable.data_integrity_error')
              : t(`equity.${series}.empty`)}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <ChartContainer
      title={t(`equity.${series}.title`)}
      description={t(`equity.${series}.description`)}
      caption={t(`equity.${series}.caption`)}
      tableFallback={<EquityFallbackTable points={points} series={series} />}
      plotClassName="overflow-hidden"
      className="min-w-0"
    >
      <EquityPlot points={points} />
    </ChartContainer>
  );
}
