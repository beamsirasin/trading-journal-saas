'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion';

import { AdminChartContainer } from './admin-chart-container';
import { adminCopy } from './admin-copy';

/** UTC-explicit formatting — the browser's local timezone must never leak into an operator chart labeled "UTC" (Phase 11's locked contract). */
const AXIS_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const FULL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function dayToUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatAxisLabel(day: string): string {
  return AXIS_DATE_FORMAT.format(dayToUtcDate(day));
}

function formatFullLabel(day: string): string {
  return FULL_DATE_FORMAT.format(dayToUtcDate(day));
}

interface ActivityTooltipEntry {
  readonly payload?: { readonly day?: string; readonly count?: number } | undefined;
}

function ActivityTooltip({
  active,
  payload,
}: {
  active?: boolean | undefined;
  payload?: readonly ActivityTooltipEntry[] | undefined;
}) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (point?.day === undefined || point.count === undefined) return null;

  return (
    <div className="bg-popover text-popover-foreground border-border shadow-popover rounded-md border px-3 py-2">
      <p className="text-muted-foreground mb-1.5 text-xs font-medium">
        {formatFullLabel(point.day)}
      </p>
      <p className="numeric text-foreground text-xs font-semibold">{point.count}</p>
    </div>
  );
}

function ActivityFallbackTable({
  data,
  dateColumnLabel,
  countColumnLabel,
  caption,
}: {
  data: readonly { readonly day: string; readonly count: number }[];
  dateColumnLabel: string;
  countColumnLabel: string;
  caption: string;
}) {
  return (
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{dateColumnLabel}</th>
          <th scope="col">{countColumnLabel}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((point) => (
          <tr key={point.day}>
            <th scope="row">{formatFullLabel(point.day)}</th>
            <td>{point.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One 30-UTC-day activity line chart with an accessible fallback table —
 * shared by both "New users" and "Trades logged" (Phase 11C's locked metric
 * catalogue). Server-computed counts only, no financial math, no per-trade
 * detail — `data` is exactly the DTO's `activity.newUsers30d`/`tradesLogged30d`
 * shape.
 */
export function AdminActivityChart({
  titleId,
  title,
  description,
  caption,
  data,
  color,
  dateColumnLabel,
  countColumnLabel,
}: {
  titleId: string;
  title: string;
  description: string;
  caption: string;
  data: readonly { readonly day: string; readonly count: number }[];
  color: string;
  dateColumnLabel: string;
  countColumnLabel: string;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const maxCount = data.reduce((max, point) => Math.max(max, point.count), 0);

  return (
    <AdminChartContainer
      title={title}
      titleId={titleId}
      description={description}
      caption={caption}
      tableFallback={
        <ActivityFallbackTable
          data={data}
          dateColumnLabel={dateColumnLabel}
          countColumnLabel={countColumnLabel}
          caption={caption}
        />
      }
    >
      <div className="h-56 w-full min-w-0 sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={formatAxisLabel}
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
              width={32}
              allowDecimals={false}
              domain={[0, maxCount === 0 ? 1 : 'auto']}
            />
            <Tooltip
              content={<ActivityTooltip />}
              cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
              isAnimationActive={!prefersReducedMotion}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {adminCopy.overview.activity.windowLabel}
      </p>
    </AdminChartContainer>
  );
}
