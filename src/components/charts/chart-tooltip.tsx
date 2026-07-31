'use client';

import { cn } from '@/lib/utils';

/**
 * Recharts injects these at render time; they are typed structurally rather
 * than imported because Recharts' own tooltip payload generic changes shape
 * between chart types and pins the component to one of them.
 */
export interface TooltipEntry {
  readonly dataKey?: string | number | undefined;
  readonly name?: string | number | undefined;
  readonly value?: number | string | undefined;
  readonly color?: string | undefined;
}

export interface ChartTooltipProps {
  readonly active?: boolean | undefined;
  readonly payload?: readonly TooltipEntry[] | undefined;
  readonly label?: string | number | undefined;
  /** Maps a dataKey to the wording shown, so series names stay in one place. */
  readonly nameFor?: Record<string, string>;
  readonly unit?: string;
  readonly decimals?: number;
}

/**
 * Shared tooltip surface.
 *
 * Uses the popover tokens rather than Recharts' default white box, which is
 * unreadable in dark mode and ignores the theme entirely. Values are rendered
 * with `numeric` so the figures do not reflow as the pointer moves along the
 * series.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  nameFor,
  unit = '',
  decimals = 1,
}: ChartTooltipProps) {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'bg-popover text-popover-foreground border-border rounded-md border px-3 py-2',
        'shadow-[0_8px_24px_-12px_rgba(0,0,0,0.45)]',
      )}
    >
      {label === undefined ? null : (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">{String(label)}</p>
      )}
      <ul className="flex flex-col gap-1">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? entry.name ?? '');
          const value =
            typeof entry.value === 'number' ? entry.value.toFixed(decimals) : entry.value;

          return (
            <li key={key} className="flex items-center gap-2 text-xs">
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{nameFor?.[key] ?? key}</span>
              <span className="numeric text-foreground ml-auto font-semibold">
                {value}
                {unit}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
