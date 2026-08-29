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
  micro,
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
   * The optional micro-visual, rendered on the FIGURE'S OWN ROW, right-aligned.
   *
   * WHY BESIDE THE FIGURE AND NOT UNDER IT. A full-width band under the hero
   * was the first thing tried and it was wrong twice over: it added a row to
   * a card this product has twice worked to shorten, and at 355px wide and
   * full saturation it out-shouted the number it belongs to — inverting the
   * hierarchy §7 sets, where the figure leads. Right-aligned on the figure's
   * baseline it costs no height at all and fills the horizontal emptiness
   * that was the actual complaint about these cards.
   *
   * Omitted — not blanked — on the two metrics whose data cannot support one
   * (see `BasicKpiMicroVisual`). Because the slot it would occupy is empty
   * space to the right rather than a reserved row, a card without one reads
   * as quiet rather than as broken, and the row still scans as one system:
   * label, figure and context line all sit on shared baselines regardless.
   */
  micro?: ReactNode;
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
        // `@container/kpi` so the micro-visual can ask how wide THIS card is.
        // The viewport cannot answer that: the row is five columns at `lg`,
        // three at `md` and two below, so a 1024px desktop gives each card
        // LESS room than a 768px tablet does.
        'bg-card border-border @container/kpi flex min-w-0 flex-col rounded-lg border px-4 py-3 transition-colors',
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
        <div className="flex min-h-8 min-w-0 flex-1 items-end gap-3">
          <div className="min-w-0 flex-1">{value}</div>
          {micro === undefined ? null : (
            /*
              SIZED AND GATED BY THE CARD'S OWN WIDTH, AND THAT IS A
              CORRECTNESS RULE RATHER THAN A PREFERENCE.

              The figure and the bar share one row, so the bar must never be
              wider than what the figure leaves. Measured against the widest
              real figure on the row (a six-character percentage, ~108px at
              this type scale): under 11rem of content box there is no room
              at all and the bar is not rendered; from there it is 48px; and
              only past 15rem — where a card has ~240px of content — does it
              take its full 80px.

              Without this the bar overlapped the numeral outright at a 320px
              phone (106px of content) and, less obviously, at a 1024px
              desktop, where the row is five columns and each card is NARROWER
              than on a 768px tablet. That is also why this is a container
              query and not a breakpoint.

              Nothing is lost when it hides: the counts it pictures are
              printed in words on the line directly below, on every card, at
              every width.

              `mb-1.5` sits the bar on the figure's optical baseline rather
              than its box's, so a 30px numeral and a 6px bar look aligned.
            */
            <div className="mb-1.5 hidden w-12 shrink-0 @[11rem]/kpi:block @[15rem]/kpi:w-20">
              {micro}
            </div>
          )}
        </div>
        <div className="text-muted-foreground mt-1 min-h-4 min-w-0 text-xs leading-4">
          {context}
        </div>
      </dd>
    </div>
  );
}
