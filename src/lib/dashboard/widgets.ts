export const DASHBOARD_WIDGET_IDS = [
  'basic.net-pnl',
  'basic.trade-win-rate',
  'basic.profit-factor',
  'basic.day-win-rate',
  'basic.avg-win-loss',
  'review.needs-attention',
  'system.performance',
  'trader.performance',
  'execution.gap',
  'trades.recent',
  'calendar.performance',
  'account.balance',
  'risk.drawdown',
  'strategy.performance',
  'psychology.performance',
  'discipline.performance',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];
export type DashboardWidgetCapability =
  | 'basic'
  | 'attention'
  | 'system'
  | 'trader'
  | 'comparison'
  | 'recent_trades'
  | 'calendar'
  | 'account_balance'
  | 'drawdown'
  | 'strategy_insight'
  | 'psychology_insight'
  | 'discipline_insight';

export interface DashboardWidgetDefinition {
  readonly id: DashboardWidgetId;
  readonly capability: DashboardWidgetCapability;
  /** Reserved widgets have a stable identity/layout slot but no D2 component. */
  readonly implementation: 'current' | 'later';
}

export const DASHBOARD_WIDGET_REGISTRY: readonly DashboardWidgetDefinition[] = [
  { id: 'basic.net-pnl', capability: 'basic', implementation: 'current' },
  { id: 'basic.trade-win-rate', capability: 'basic', implementation: 'current' },
  { id: 'basic.profit-factor', capability: 'basic', implementation: 'current' },
  { id: 'basic.day-win-rate', capability: 'basic', implementation: 'current' },
  { id: 'basic.avg-win-loss', capability: 'basic', implementation: 'current' },
  { id: 'review.needs-attention', capability: 'attention', implementation: 'current' },
  { id: 'system.performance', capability: 'system', implementation: 'current' },
  { id: 'trader.performance', capability: 'trader', implementation: 'current' },
  { id: 'execution.gap', capability: 'comparison', implementation: 'current' },
  { id: 'trades.recent', capability: 'recent_trades', implementation: 'current' },
  { id: 'calendar.performance', capability: 'calendar', implementation: 'current' },
  // D7B — both now render, and both read the SAME `RiskPerformanceData`
  // payload. Two IDs rather than one because they remain two distinct
  // capabilities (a balance history and a drawdown reading); one section
  // rather than two cards because splitting them would ask the reader to
  // hold a balance in their head while looking at the distance below its
  // peak.
  { id: 'account.balance', capability: 'account_balance', implementation: 'current' },
  { id: 'risk.drawdown', capability: 'drawdown', implementation: 'current' },
  // D8B — the three compact insight pillars now render, from ONE shared
  // `DashboardInsightData` payload. Three IDs rather than one because they
  // are three product pillars a reader scans separately; sub-dimensions
  // (Emotion, Confidence, checklist, mistakes) deliberately receive none,
  // because a widget ID is a layout slot and none of them owns one.
  { id: 'strategy.performance', capability: 'strategy_insight', implementation: 'current' },
  { id: 'psychology.performance', capability: 'psychology_insight', implementation: 'current' },
  { id: 'discipline.performance', capability: 'discipline_insight', implementation: 'current' },
];

export const DASHBOARD_SECTION_IDS = [
  'basic-kpi',
  'attention',
  'performance',
  'execution-gap',
  'recent-and-calendar',
  'insight-pillars',
  'risk-performance',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export interface DashboardSectionDefinition {
  readonly id: DashboardSectionId;
  /**
   * How many desktop columns THIS section's own grid has. A widget's
   * `desktopSpan` is read against this number and nothing else.
   */
  readonly desktopColumns: 1 | 2 | 3 | 5 | 12;
}

/**
 * THE DASHBOARD IS A STACK OF SECTIONS, NOT ONE GLOBAL GRID.
 *
 * D2 recorded every widget's `desktopSpan` against an implied five-column
 * page grid, which made `system.performance: 2` + `trader.performance: 3`
 * the only way to fill a row — a 40/60 split the product contract has never
 * asked for. D4 shipped the two cards as equal halves anyway and recorded the
 * contradiction rather than faking parity inside a five-wide row (two equal
 * integer spans cannot fill five columns).
 *
 * D4.5 resolves it by making the metadata say what the page actually is: the
 * Basic KPI band is a five-column row, the System/Trader pair is its own
 * balanced two-column section, and the remaining sections are full width.
 * Each section owns its column count, so no section has to borrow another's.
 *
 * This is deliberately NOT a layout engine — there is no persistence, no
 * editor, no drag/drop, no resize, and no runtime that turns these numbers
 * into a grid. Components still spell their own Tailwind grids; this is the
 * record of what those grids are, so the DOM metadata and the rendered page
 * cannot disagree again.
 */
export const DASHBOARD_SECTIONS: readonly DashboardSectionDefinition[] = [
  { id: 'basic-kpi', desktopColumns: 5 },
  { id: 'attention', desktopColumns: 1 },
  { id: 'performance', desktopColumns: 2 },
  { id: 'execution-gap', desktopColumns: 1 },
  /*
    D6B: the one section on the page whose two widgets are genuinely UNEQUAL.
    Twelve columns is the smallest integer grid that expresses the split
    honestly — halves would starve the Calendar's squares, and thirds would
    starve the Trade rows.

    THE SPLIT IS 5 + 7, CALENDAR WIDER. It was recorded here as 7 + 5 with
    the reasoning that the Trade list wants horizontal room; measured, that
    was backwards. The row carries a date, a symbol and one R figure and
    reaches its natural width at about 500px, after which every pixel is
    padding. Width is the ONLY thing that makes a Calendar day cell legible,
    and at five of twelve its cells were dropping their secondary line
    through the card's own container queries. Wider goes to the widget that
    can spend it.

    THESE TWO NUMBERS WERE STALE. The page was reversed to 5 + 7 without this
    record following, and nothing caught it because — unlike the Basic KPI
    band, which builds its grid classes from `desktopSpan` — this section's
    component spells `lg:col-span-5` / `lg:col-span-7` literally. For these
    two widgets the field is pure metadata: it is emitted as
    `data-dashboard-desktop-span` and read by nothing that draws. That is
    exactly the failure mode this registry exists to prevent, so the record
    is corrected to match what the page has been rendering.

    This is still not a layout engine: no persistence, no editor, no
    drag/drop, no resize, and no runtime that turns these numbers into a grid.
    The section's component spells its own `lg:grid-cols-12` and these numbers
    record what it spells.
  */
  { id: 'recent-and-calendar', desktopColumns: 12 },
  /*
    D7B: the `reserved` holding section is retired — its two members are now
    built, and an empty section is a slot for a prediction rather than a
    record of the page. They share ONE section because they share one D7A
    payload: `account.balance` owns the balance figures and the curve,
    `risk.drawdown` owns the two drawdown readings and the high-water mark
    they are measured from. Twelve columns for the same reason D6B uses
    them — the split is deliberately unequal, and 7 + 5 says so exactly.
  */
  /*
    D8B: three EQUAL compact pillars, so three columns — the first section on
    this page whose grid is neither halves, twelfths, nor the KPI band's five.
    Equal because Strategy, Psychology and Discipline are peer product
    pillars; compact because the Dashboard detects and Analytics diagnoses,
    so none of them is allowed to grow into the D4/D5 analytical bands above.

    D8A's provisional `reserved` holding section is retired here: its three
    members are built, and an empty section would be a slot for a prediction
    rather than a record of the page.
  */
  { id: 'insight-pillars', desktopColumns: 3 },
  { id: 'risk-performance', desktopColumns: 12 },
];

export function dashboardSection(sectionId: DashboardSectionId): DashboardSectionDefinition {
  const section = DASHBOARD_SECTIONS.find((candidate) => candidate.id === sectionId);
  if (section === undefined) throw new Error(`Missing Dashboard section ${sectionId}`);
  return section;
}

export interface DashboardLayoutItem {
  readonly widgetId: DashboardWidgetId;
  readonly section: DashboardSectionId;
  readonly order: number;
  /** Columns occupied inside `section`'s own grid — never a page-wide grid. */
  readonly desktopSpan: 1 | 2 | 3 | 4 | 5 | 7 | 12;
  readonly mobileSpan: 1 | 2;
  readonly mobileOrder: number;
}

/**
 * Static future-facing layout only. `implementation: 'current'` widgets
 * render; the rest hold a stable identity/layout slot with no component.
 * There is no persistence, editor, drag/drop, or resize behavior.
 *
 * `basic.avg-win-loss` carries `mobileSpan: 2` (D3): five one-column cards in
 * a two-column mobile grid would leave the fifth dangling beside an empty
 * cell, so the last Basic KPI spans the narrow grid instead.
 */
export const DEFAULT_DASHBOARD_LAYOUT: readonly DashboardLayoutItem[] = [
  {
    widgetId: 'basic.net-pnl',
    section: 'basic-kpi',
    order: 10,
    desktopSpan: 1,
    mobileSpan: 1,
    mobileOrder: 10,
  },
  {
    widgetId: 'basic.trade-win-rate',
    section: 'basic-kpi',
    order: 20,
    desktopSpan: 1,
    mobileSpan: 1,
    mobileOrder: 20,
  },
  {
    widgetId: 'basic.profit-factor',
    section: 'basic-kpi',
    order: 30,
    desktopSpan: 1,
    mobileSpan: 1,
    mobileOrder: 30,
  },
  {
    widgetId: 'basic.day-win-rate',
    section: 'basic-kpi',
    order: 40,
    desktopSpan: 1,
    mobileSpan: 1,
    mobileOrder: 40,
  },
  {
    widgetId: 'basic.avg-win-loss',
    section: 'basic-kpi',
    order: 50,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 50,
  },
  {
    widgetId: 'review.needs-attention',
    section: 'attention',
    order: 60,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 60,
  },
  // Equal halves of their own section — the D2 2+3 split is retired.
  {
    widgetId: 'system.performance',
    section: 'performance',
    order: 70,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 70,
  },
  {
    widgetId: 'trader.performance',
    section: 'performance',
    order: 80,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 80,
  },
  {
    widgetId: 'execution.gap',
    section: 'execution-gap',
    order: 90,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 90,
  },
  /*
    D8B — the three insight pillars sit BETWEEN the Execution Gap and the
    record list, at 92/94/96 rather than after D7's 130.

    That is the product's reading order, not an append: the KPI band, the two
    baselines and the Execution Gap establish WHAT happened, the pillars ask
    WHERE it came from (the system, the trader's state, the trader's
    discipline), and only then does the page hand over to the records. D8A
    parked them at 140–160 in a holding section precisely so D8B could place
    them once the presentation was known.

    The existing D3–D7 orders are untouched — inserting into the gap the
    original decade numbering left is what that numbering was for.
  */
  {
    widgetId: 'strategy.performance',
    section: 'insight-pillars',
    order: 92,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 92,
  },
  {
    widgetId: 'psychology.performance',
    section: 'insight-pillars',
    order: 94,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 94,
  },
  {
    widgetId: 'discipline.performance',
    section: 'insight-pillars',
    order: 96,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 96,
  },
  // D6B — one section, twelve columns, 7 + 5. The two widgets are read
  // together (which Trades happened, and when they happened), so they share a
  // row rather than stacking into two full-width bands. Both go full width on
  // mobile: a five-of-twelve calendar at 390px is unreadable.
  {
    widgetId: 'trades.recent',
    section: 'recent-and-calendar',
    order: 100,
    desktopSpan: 5,
    mobileSpan: 2,
    mobileOrder: 100,
  },
  {
    widgetId: 'calendar.performance',
    section: 'recent-and-calendar',
    order: 110,
    desktopSpan: 7,
    mobileSpan: 2,
    mobileOrder: 110,
  },
  /*
    D7B — 7 + 5 of one twelve-column section, in that order because the
    balance is the subject and the drawdown is the reading taken against it.
    Both go full width on mobile, where the priority is Modeled Balance,
    Period P&L, the two drawdowns, then the curve.
  */
  {
    widgetId: 'account.balance',
    section: 'risk-performance',
    order: 120,
    desktopSpan: 7,
    mobileSpan: 2,
    mobileOrder: 120,
  },
  {
    widgetId: 'risk.drawdown',
    section: 'risk-performance',
    order: 130,
    desktopSpan: 5,
    mobileSpan: 2,
    mobileOrder: 130,
  },
];

export function dashboardLayoutItem(widgetId: DashboardWidgetId): DashboardLayoutItem {
  const item = DEFAULT_DASHBOARD_LAYOUT.find((candidate) => candidate.widgetId === widgetId);
  if (item === undefined)
    throw new Error(`Missing default layout for Dashboard widget ${widgetId}`);
  return item;
}

/**
 * The layout record a widget's DOM node carries, spelled once.
 *
 * Three components render widget roots (`WidgetSlot`, `KpiWidgetCard`,
 * `PerformanceCard`) and all three must publish the same facts; deriving them
 * here is what stops a fourth widget from quietly emitting a different set.
 */
export function dashboardWidgetAttributes(
  layout: DashboardLayoutItem,
): Record<string, string | number> {
  return {
    'data-dashboard-widget': layout.widgetId,
    'data-dashboard-section': layout.section,
    'data-dashboard-section-columns': dashboardSection(layout.section).desktopColumns,
    'data-dashboard-desktop-span': layout.desktopSpan,
    'data-dashboard-mobile-span': layout.mobileSpan,
    'data-dashboard-order': layout.order,
  };
}
