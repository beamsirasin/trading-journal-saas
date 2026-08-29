import type { ReactNode } from 'react';

import { dashboardWidgetAttributes, type DashboardLayoutItem } from '@/lib/dashboard/widgets';
import { cn } from '@/lib/utils';
import { MetricLabel } from '@/components/product/metric';

import { MetricInfo } from './metric-info';

/**
 * Tailwind needs literal class names, so the D2 span metadata is mapped
 * through these lookups rather than interpolated. The layout still comes from
 * `DEFAULT_DASHBOARD_LAYOUT` — this is only its typography-safe spelling.
 */
const MOBILE_SPAN_CLASS = {
  1: 'col-span-1',
  2: 'col-span-2',
} as const satisfies Record<DashboardLayoutItem['mobileSpan'], string>;

const DESKTOP_SPAN_CLASS = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  // D6B widened the span union for the twelve-column Recent/Calendar section.
  // Those two widgets spell their own placement in their own section's grid,
  // so these classes exist only to keep the map exhaustive rather than to be
  // used — a partial map would hand `undefined` to `cn` at runtime.
  7: 'lg:col-span-7',
  12: 'lg:col-span-12',
} as const satisfies Record<DashboardLayoutItem['desktopSpan'], string>;

/**
 * The grid placement for one widget, spelled from its D2 layout metadata.
 * Exported so the Dashboard skeleton reserves exactly the geometry the real
 * row will occupy and cannot drift from it.
 */
export function kpiSpanClassName(layout: DashboardLayoutItem): string {
  return cn(MOBILE_SPAN_CLASS[layout.mobileSpan], DESKTOP_SPAN_CLASS[layout.desktopSpan]);
}

/** The one grid the Basic KPI row and its skeleton both use. */
export const BASIC_KPI_GRID_CLASS =
  'grid min-w-0 grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5';

/**
 * One Basic KPI card.
 *
 * Fixed anatomy, in this order and nothing else: a small label with its
 * definition affordance, one large primary figure with its optional
 * indicator beside it, and one small context line that only Net P&L now
 * fills. Every card shares that skeleton; the variety lives inside the
 * indicator slot, never in the structure.
 *
 * THE FIGURE IS THE CARD. It carries its own type role (`text-kpi`, and
 * `text-kpi-hero` for the row's lead) rather than the shared `text-metric`,
 * because these five are the page's headline and needed a step up without
 * dragging every other figure in the product up with them.
 *
 * THE CARD DID NOT GET TALLER TO PAY FOR IT. The larger figure was funded
 * from the space around it: the definition button shrank to a 28px target
 * (still past WCAG 2.5.8's 24px minimum) so the label band could drop from
 * 28px to 24px, the vertical padding lost 2px a side, and four of the five
 * cards gave up their permanent supporting line entirely. Measured at 1440
 * the row is the same height it was before the figure grew by a third.
 *
 * The three bands keep their own minimum heights so that, across a row of
 * five, labels start on one line, figures sit on one baseline, and the
 * context band occupies the same space even on the four cards with nothing
 * to say there.
 */
export function KpiWidgetCard({
  layout,
  label,
  status,
  reason,
  info,
  value,
  indicator,
  context,
  className,
}: {
  /** Carries the widget id, its section, and its placement inside it. */
  layout: DashboardLayoutItem;
  label: string;
  /** Mirrors the view model so tests and E2E can distinguish the states. */
  status: 'available' | 'empty' | 'unavailable' | 'error';
  reason?: string;
  info?: { readonly triggerLabel: string; readonly description: string };
  value: ReactNode;
  /**
   * The optional indicator, sharing the FIGURE'S OWN ROW.
   *
   * WHY BESIDE THE FIGURE AND NOT UNDER IT. A full-width band under the hero
   * was tried first and was wrong twice over: it added a row to a card this
   * product has repeatedly worked to shorten, and at full width it out-shouted
   * the number it belongs to — inverting the hierarchy where the figure leads.
   * Beside the figure it costs no height at all and fills the horizontal
   * emptiness that was the actual complaint about these cards.
   *
   * IT WRAPS RATHER THAN HIDES WHEN THE CARD IS NARROW. The figure holds a
   * minimum width, so on a 320px phone — where a card has ~106px of content
   * and a ring plus a percentage cannot share a line — the indicator falls to
   * its own line instead of disappearing. Losing the visual on the smallest
   * screens was the previous behaviour and it made mobile the one place the
   * row said least; a few pixels of height is the cheaper trade.
   */
  indicator?: ReactNode;
  context: ReactNode;
  className?: string;
}) {
  return (
    <div
      {...dashboardWidgetAttributes(layout)}
      data-kpi-status={status}
      data-kpi-reason={reason}
      className={cn(
        // One padding step at every width. The vertical step is smaller than
        // the horizontal one: the card is wide and short, so its scarce
        // dimension is the one that should pay less padding.
        // `@container/kpi` so the figure and the indicator can both size
        // themselves against THIS card. The viewport cannot answer that: five
        // columns at `lg`, three at `md`, two below, so a 1024px desktop
        // gives each card less room than a 768px tablet does.
        'bg-card border-border @container/kpi flex min-w-0 flex-col rounded-lg border px-4 py-2.5 transition-colors',
        'hover:border-ring/40',
        kpiSpanClassName(layout),
        className,
      )}
    >
      <dt className="flex min-h-6 items-start justify-between gap-2">
        <MetricLabel variant="plain" className="min-w-0 pt-0.5 leading-snug break-words">
          {label}
        </MetricLabel>
        {info === undefined ? null : (
          <MetricInfo
            triggerLabel={info.triggerLabel}
            title={label}
            description={info.description}
          />
        )}
      </dt>
      <dd className="mt-1 flex min-w-0 flex-1 flex-col">
        {/*
          Bottom-anchored inside a stretched grid row, so the figure band and
          the context line below it stay aligned across all five cards even
          when a narrow viewport wraps one card's label onto a second line.

          `flex-wrap` with a minimum on the figure is what makes the indicator
          fall to its own line instead of colliding with the numeral — no
          breakpoint decides it, because the row is five columns at `lg`,
          three at `md` and two below, so a 1024px desktop gives each card
          LESS room than a 768px tablet does. Only the card's own width can
          answer that, and flex wrapping reads it directly.
        */}
        <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">{value}</div>
          {indicator === undefined ? null : <div className="shrink-0">{indicator}</div>}
        </div>
        <div className="text-muted-foreground mt-0.5 min-h-4 min-w-0 text-xs leading-4">
          {context}
        </div>
      </dd>
    </div>
  );
}
