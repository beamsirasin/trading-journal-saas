import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

import { SeriesSwatch } from './comparison-metric';

export interface ChartLegendItem {
  readonly series: 'system' | 'trader';
  readonly label: string;
  /** Named so the legend explains the line style, not just the colour. */
  readonly lineStyle?: 'solid' | 'dashed';
}

/**
 * The frame every chart renders inside.
 *
 * Three jobs, all of which are easy to forget per-chart and so are structural
 * here instead:
 *
 * 1. **A real `<figure>` with a `<figcaption>`.** The caption states what the
 *    chart shows in words, so the meaning survives without the graphics.
 * 2. **A data table alternative.** `tableFallback` is visually hidden but
 *    fully available to a screen reader and to keyboard users, which is the
 *    honest answer to "charts must be accessible" — an SVG with ARIA labels
 *    bolted on is not navigable, a table is.
 * 3. **A legend that does not depend on colour.** Each entry pairs a swatch
 *    with its name, and line charts also name the stroke style, so the two
 *    series remain separable in greyscale, in print, and under CVD.
 *
 * The plot area has a fixed aspect/height rather than sizing to content:
 * Recharts' ResponsiveContainer measures its parent, and a parent that sizes
 * to its child collapses to zero.
 */
export function ChartContainer({
  title,
  titleId,
  description,
  caption,
  legend,
  toolbar,
  tableFallback,
  children,
  className,
  plotClassName,
}: {
  title: string;
  /** Set when the enclosing region labels itself from this heading. */
  titleId?: string | undefined;
  description?: string | undefined;
  /** Stated below the plot. Says what the reader should take from it. */
  caption: string;
  legend?: readonly ChartLegendItem[] | undefined;
  toolbar?: ReactNode;
  /** A `<table>` carrying the same numbers. Visually hidden, not removed. */
  tableFallback: ReactNode;
  children: ReactNode;
  // `| undefined` throughout: with exactOptionalPropertyTypes a caller
  // forwarding its own optional prop passes an explicit `undefined`, which an
  // `?: string` alone rejects.
  className?: string | undefined;
  plotClassName?: string | undefined;
}) {
  return (
    <figure
      className={cn(
        'bg-card border-border flex flex-col gap-4 rounded-lg border p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 {...(titleId === undefined ? {} : { id: titleId })} className="text-card-title">
            {title}
          </h3>
          {description === undefined ? null : (
            <p className="text-muted-foreground text-sm leading-relaxed">{description}</p>
          )}
        </div>
        {toolbar}
      </div>

      {legend === undefined ? null : (
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {legend.map((item) => (
            <li key={item.label} className="text-muted-foreground flex items-center gap-2 text-xs">
              <SeriesSwatch series={item.series} />
              <span>{item.label}</span>
              {item.lineStyle === undefined ? null : (
                <span className="text-muted-foreground/70">({item.lineStyle} line)</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/*
        `min-w-0` matters: a flex child defaults to min-width:auto, which lets
        the SVG refuse to shrink and pushes the page into horizontal overflow
        on small screens.
      */}
      <div className={cn('min-w-0', plotClassName)}>{children}</div>

      <figcaption className="text-muted-foreground text-xs leading-relaxed">{caption}</figcaption>

      <div className="sr-only">{tableFallback}</div>
    </figure>
  );
}
