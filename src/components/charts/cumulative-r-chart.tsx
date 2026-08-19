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

import type { DemoEquityPoint } from '@/lib/demo';
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

import { ChartTooltip } from './chart-tooltip';

/**
 * Cumulative R — what the strategy offered against what the trader captured.
 *
 * The single most important picture in the product: two lines starting
 * together and diverging, where the growing gap IS the Execution Gap. A
 * trader looking at a rising actual line alone would conclude things are
 * going well.
 *
 * Form choice: a line chart because the job is trend over time with two
 * series that must be told apart — the categorical case. One shared y-axis in
 * R, never a second scale; both series are already normalised to R, which is
 * exactly what makes them comparable when position sizes differed.
 *
 * Encoding is deliberately redundant. The system line is DASHED because it is
 * hypothetical, the actual line is SOLID because it happened. That reads in
 * greyscale, in print, and under any colour vision, so the chart never
 * depends on the cyan/blue distinction alone.
 *
 * Number conversion: fixtures store R as strings (the production
 * `NUMERIC(12,4)` contract). SVG geometry requires JS numbers, so the
 * conversion happens here, once, at the plotting boundary — on values that
 * are already rounded for display and are never read back into a calculation.
 */

export function CumulativeRChart({
  points,
  className,
}: {
  points: readonly DemoEquityPoint[];
  className?: string;
}) {
  const t = useTranslations('common');
  const prefersReducedMotion = usePrefersReducedMotion();
  const nameFor = { system: t('system'), actual: t('actual') };

  const data = points.map((point) => ({
    label: point.label,
    system: Number(point.systemR),
    actual: Number(point.actualR),
  }));

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />

          <XAxis
            dataKey="label"
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            // Thin the labels on narrow viewports rather than rotating them:
            // rotated ticks cost height and are harder to read than fewer.
            interval="preserveStartEnd"
            minTickGap={24}
          />

          <YAxis
            stroke="var(--border)"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={(value: number) => `${value}R`}
          />

          {/* Zero is the meaningful baseline for cumulative R, so it is drawn
              rather than left to a grid line the reader has to find. The axis
              is never truncated to exaggerate the gap. */}
          <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} />

          <Tooltip
            content={<ChartTooltip nameFor={nameFor} unit="R" decimals={1} />}
            cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
          />

          <Line
            type="monotone"
            dataKey="system"
            stroke="var(--chart-1)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={!prefersReducedMotion}
          />

          <Line
            type="monotone"
            dataKey="actual"
            stroke="var(--chart-2)"
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
