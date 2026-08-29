import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The one tooltip shell every Dashboard chart renders into.
 *
 * Three charts had grown three near-identical tooltips, each spelling its own
 * surface, border, radius, spacing and row typography. They looked the same
 * only for as long as nobody edited one of them.
 *
 * ANATOMY, FIXED: a small header (the date or category), a rule, then labelled
 * rows whose values are right-aligned on a shared edge so a column of R
 * figures reads down rather than ragged. `numeric` gives them tabular
 * numerals, so the values do not shift horizontally as the pointer moves
 * between points — the specific jitter that makes a hovering tooltip feel
 * cheap.
 *
 * THEME TOKENS ONLY. `--popover` is the light card in light mode and the
 * raised dark surface in dark mode; a hardcoded `#181818` here would render a
 * black box on a white page (§36).
 *
 * SIZE IS CAPPED. `max-w-60` and a small type scale keep it a readout, not a
 * panel that covers the data it describes.
 */
export function ChartTooltip({
  title,
  rows,
  footnote,
}: {
  /** The hovered category — typically a localised date. */
  title: string;
  rows: readonly ChartTooltipRow[];
  /** One quiet line under a rule, e.g. how many Trades the point covers. */
  footnote?: string;
}) {
  return (
    <div
      data-slot="chart-tooltip"
      className="bg-popover text-popover-foreground border-border shadow-popover max-w-60 min-w-[9rem] rounded-lg border px-2.5 py-2"
    >
      <p className="text-foreground border-border/70 mb-1.5 border-b pb-1.5 text-xs font-semibold">
        {title}
      </p>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 text-xs">
            {/*
              The swatch repeats the series' own stroke so a reader hovering
              two lines can tell which row is which without reading back up to
              the legend. It is never the ONLY channel: the label beside it
              names the series in words.
            */}
            {row.swatchClassName === undefined ? null : (
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-[2px]', row.swatchClassName)}
              />
            )}
            <span className="text-muted-foreground min-w-0 truncate">{row.label}</span>
            <span className={cn('numeric ml-auto font-semibold', row.className)}>{row.value}</span>
          </li>
        ))}
      </ul>
      {footnote === undefined ? null : (
        <p className="text-muted-foreground border-border/70 mt-1.5 border-t pt-1.5 text-[11px] leading-4">
          {footnote}
        </p>
      )}
    </div>
  );
}

export interface ChartTooltipRow {
  readonly key: string;
  readonly label: ReactNode;
  /** Already formatted by the canonical presentation layer — never a raw number. */
  readonly value: ReactNode;
  /** Tailwind background for the series swatch, or omitted for no swatch. */
  readonly swatchClassName?: string;
  /** Tone override for the value, where the figure is genuinely signed. */
  readonly className?: string;
}
