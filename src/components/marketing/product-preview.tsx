import { demoBundle } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { DemoBadge } from '@/components/product/demo-badge';
import { MetricLabel } from '@/components/product/metric';

/**
 * The interface preview in the hero.
 *
 * Deliberately NOT the real Recharts dashboard. This sits above the fold on
 * the first page a visitor loads, and pulling a charting library into that
 * bundle to draw twenty-five points is a poor trade. The sparkline below is a
 * plain SVG polyline built on the server from the same fixtures the real
 * dashboard uses, so the two cannot disagree.
 *
 * It is a static composition, not a screenshot: a screenshot goes stale the
 * moment the design system changes and cannot follow the reader's theme.
 */

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 96;

function toPolyline(values: readonly string[], min: number, max: number): string {
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * VIEW_WIDTH;
      const y = VIEW_HEIGHT - ((Number(value) - min) / span) * VIEW_HEIGHT;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function ProductPreview({ className }: { className?: string }) {
  const bundle = demoBundle('all');
  const { attribution, equityCurve } = bundle;

  const systemValues = equityCurve.map((point) => point.systemR);
  const actualValues = equityCurve.map((point) => point.actualR);

  // A shared scale across both series — two sparklines on independent scales
  // would make the gap between them meaningless, which is the one thing this
  // graphic exists to show.
  const all = [...systemValues, ...actualValues].map(Number);
  const min = Math.min(...all, 0);
  const max = Math.max(...all);

  return (
    <div
      className={cn(
        'bg-card border-border overflow-hidden rounded-xl border',
        'shadow-[0_2px_4px_rgba(0,0,0,0.04),0_24px_48px_-24px_rgba(0,0,0,0.4)]',
        className,
      )}
    >
      <div className="border-border bg-surface flex items-center gap-2 border-b px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
          <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
          <span className="bg-muted-foreground/30 size-2.5 rounded-full" />
        </span>
        <p className="text-muted-foreground ml-1 text-xs font-medium">Attribution overview</p>
        <DemoBadge className="ml-auto" />
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <PreviewStat label="System total R" value={attribution.systemTotalR} suffix="R" />
          <PreviewStat label="Actual total R" value={attribution.actualTotalR} suffix="R" />
          <PreviewStat
            label="Edge leakage"
            value={attribution.edgeLeakageR}
            suffix="R"
            tone="warning"
            className="col-span-2 sm:col-span-1"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <MetricLabel>Cumulative R</MetricLabel>
            <span className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="bg-system size-2 rounded-[2px]" aria-hidden="true" />
                System
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-trader size-2 rounded-[2px]" aria-hidden="true" />
                Actual
              </span>
            </span>
          </div>

          <svg
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            className="h-24 w-full"
            role="img"
            aria-label={`Cumulative R over time. The system reaches ${attribution.systemTotalR}R while actual execution reaches ${attribution.actualTotalR}R, a gap of ${attribution.edgeLeakageR}R.`}
          >
            {/* Dashed for the system line because it is hypothetical, solid
                for what actually happened — the same encoding as the real
                chart, so the legend means one thing across the product. */}
            <polyline
              points={toPolyline(systemValues, min, max)}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="2"
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
            <polyline
              points={toPolyline(actualValues, min, max)}
              fill="none"
              stroke="var(--chart-2)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        <div className="border-border bg-surface flex flex-col gap-1 rounded-lg border p-3">
          <p className="text-foreground text-sm font-medium">
            The strategy earned {attribution.systemTotalR}R. You kept {attribution.actualTotalR}R.
          </p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Discipline score {attribution.disciplineScore} · execution efficiency{' '}
            {attribution.executionEfficiencyPct}%
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewStat({
  label,
  value,
  suffix,
  tone = 'neutral',
  className,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: 'neutral' | 'warning';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border bg-surface flex flex-col gap-1 rounded-lg border p-3',
        className,
      )}
    >
      <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
        {label}
      </span>
      <span
        className={cn(
          'numeric text-lg font-semibold',
          tone === 'warning' ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
        {suffix === undefined ? null : (
          <span className="text-muted-foreground ml-0.5 text-xs">{suffix}</span>
        )}
      </span>
    </div>
  );
}
