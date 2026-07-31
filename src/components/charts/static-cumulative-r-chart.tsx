import type { DemoEquityPoint } from '@/lib/demo';

const WIDTH = 720;
const HEIGHT = 300;
const PADDING = { top: 16, right: 16, bottom: 28, left: 52 } as const;

/**
 * Server-rendered cumulative-R chart for the static marketing page.
 *
 * The interactive demo keeps Recharts; the landing page does not need a
 * client charting runtime for literal fixtures. `ChartContainer` still
 * supplies the equivalent data table, caption, and redundant line legend.
 */
export function StaticCumulativeRChart({
  points,
  className,
}: {
  points: readonly DemoEquityPoint[];
  className?: string;
}) {
  const values = points.flatMap((point) => [Number(point.systemR), Number(point.actualR), 0]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (index: number) =>
    PADDING.left + (index / Math.max(1, points.length - 1)) * plotWidth;
  const yFor = (value: number) => PADDING.top + ((maximum - value) / span) * plotHeight;
  const polyline = (key: 'systemR' | 'actualR') =>
    points
      .map((point, index) => `${xFor(index).toFixed(1)},${yFor(Number(point[key])).toFixed(1)}`)
      .join(' ');
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - (span * index) / 4);

  return (
    <svg
      data-static-cumulative-r
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {ticks.map((tick) => {
        const y = yFor(tick);
        return (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={PADDING.left - 8}
              y={y + 4}
              textAnchor="end"
              fill="var(--muted-foreground)"
              fontSize="11"
            >
              {tick.toFixed(0)}R
            </text>
          </g>
        );
      })}

      <line
        x1={PADDING.left}
        x2={WIDTH - PADDING.right}
        y1={yFor(0)}
        y2={yFor(0)}
        stroke="var(--muted-foreground)"
        vectorEffect="non-scaling-stroke"
      />

      <polyline
        points={polyline('systemR')}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="2"
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={polyline('actualR')}
        fill="none"
        stroke="var(--chart-2)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />

      {points.length === 0 ? null : (
        <>
          <text x={PADDING.left} y={HEIGHT - 6} fill="var(--muted-foreground)" fontSize="11">
            {points[0]?.label}
          </text>
          <text
            x={WIDTH - PADDING.right}
            y={HEIGHT - 6}
            textAnchor="end"
            fill="var(--muted-foreground)"
            fontSize="11"
          >
            {points.at(-1)?.label}
          </text>
        </>
      )}
    </svg>
  );
}
