import type { DemoMistake, DemoSeverity } from '@/lib/demo';
import { cn } from '@/lib/utils';
import { MistakeCostChart, MistakeCostTable } from '@/components/charts/mistake-cost-chart';
import { ChartContainer } from '@/components/product/chart-container';

const SEVERITY_CLASS: Record<DemoSeverity, string> = {
  minor: 'border-border bg-muted text-muted-foreground',
  moderate: 'border-warning/30 bg-warning/10 text-warning',
  severe: 'border-negative/30 bg-negative/10 text-negative',
};

/**
 * Mistakes, ranked by what they cost.
 *
 * The list beside the chart is not redundant with it. The chart shows the
 * shape of the ranking; the list carries the frequency, which is the number
 * that makes the point — "chased entry" happens more often than "revenge
 * trade" and costs half as much, so a frequency-ordered list would send the
 * trader to fix the wrong habit.
 */
export function MistakeSummary({
  mistakes,
  edgeLeakageR,
  className,
}: {
  mistakes: readonly DemoMistake[];
  edgeLeakageR: string;
  className?: string;
}) {
  return (
    <ChartContainer
      title="What your mistakes cost"
      description="Ranked by cost in R, not by how often they happen."
      caption={`Demo data. These costs account for the full ${edgeLeakageR}R of edge leakage over the period.`}
      tableFallback={<MistakeCostTable mistakes={mistakes} />}
      className={className}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <MistakeCostChart mistakes={mistakes} className="h-56 w-full sm:h-64" />

        <ul className="flex flex-col gap-2">
          {mistakes.map((mistake) => (
            <li
              key={mistake.id}
              className="border-border flex items-center gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-foreground text-sm font-medium">{mistake.label}</span>
                <span className="text-muted-foreground text-xs">
                  {mistake.occurrences} {mistake.occurrences === 1 ? 'time' : 'times'}
                </span>
              </div>

              <span
                className={cn(
                  'ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize',
                  SEVERITY_CLASS[mistake.severity],
                )}
              >
                {mistake.severity}
              </span>

              <span className="numeric text-foreground w-14 text-right text-sm font-semibold">
                −{mistake.costR}R
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartContainer>
  );
}
