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
 * Fixed anatomy, in this order and nothing else: a small label, an optional
 * definition affordance, one large primary value, one small context line. No
 * decorative header icon and no sparkline — these five cards stay visually
 * quiet so the System/Trader/Execution Gap widgets that follow can carry the
 * analytical weight.
 *
 * The three regions have their own minimum heights so that, across a row of
 * five, labels start on one line, values sit on one baseline, and the context
 * line occupies the same band even when a card has nothing to say there.
 *
 * THOSE BANDS ARE SIZED TO THEIR CONTENT, NOT ROUNDED UP. Through D4.5 the
 * card stood 138px tall to carry a 16px label, a 33px figure and a 16px
 * sentence — 49px of it was reserved air, five times across, at the very top
 * of the page. Each band is now the smallest height its own content can
 * occupy without moving: 28px for the label row (the definition button's own
 * 32px target less the 4px it already pulls into the padding above it), 32px
 * for the figure band, 16px for the context line. The type scale is
 * untouched, the definition affordance still clears WCAG 2.5.8's 24px
 * minimum, and the card is ~111px.
 */
export function KpiWidgetCard({
  layout,
  label,
  status,
  reason,
  info,
  value,
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
  context: ReactNode;
  className?: string;
}) {
  return (
    <div
      {...dashboardWidgetAttributes(layout)}
      data-kpi-status={status}
      data-kpi-reason={reason}
      className={cn(
        // One padding step at every width (D4.5). The old `sm:p-5` bought
        // 8px of card height back on desktop, which is precisely where a
        // five-across analytical row can least afford it. The vertical step
        // is now smaller than the horizontal one: the card is wide and short,
        // so its scarce dimension is the one that should pay less padding.
        'bg-card border-border flex min-w-0 flex-col rounded-lg border px-4 py-3 transition-colors',
        'hover:border-ring/40',
        kpiSpanClassName(layout),
        className,
      )}
    >
      <dt className="flex min-h-7 items-start justify-between gap-2">
        <MetricLabel variant="plain" className="min-w-0 pt-1 leading-snug break-words">
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
          Bottom-anchored inside a stretched grid row, so the value band and the
          context line below it stay aligned across all five cards even when a
          narrow viewport wraps one card's label onto a second line.
        */}
        <div className="flex min-h-8 min-w-0 flex-1 items-end">{value}</div>
        <div className="text-muted-foreground mt-1 min-h-4 min-w-0 text-xs leading-4">
          {context}
        </div>
      </dd>
    </div>
  );
}
