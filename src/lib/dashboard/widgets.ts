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
  | 'drawdown';

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
  { id: 'account.balance', capability: 'account_balance', implementation: 'later' },
  { id: 'risk.drawdown', capability: 'drawdown', implementation: 'later' },
];

export const DASHBOARD_SECTION_IDS = [
  'basic-kpi',
  'attention',
  'performance',
  'execution-gap',
  'recent-and-calendar',
  'reserved',
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number];

export interface DashboardSectionDefinition {
  readonly id: DashboardSectionId;
  /**
   * How many desktop columns THIS section's own grid has. A widget's
   * `desktopSpan` is read against this number and nothing else.
   */
  readonly desktopColumns: 1 | 2 | 5 | 12;
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
    Recent Trades is a list that wants horizontal room for symbol, Strategy
    and three R figures; the Calendar is a seven-column grid that stops being
    readable well before it stops fitting. Twelve columns is the smallest
    integer grid that expresses 7 + 5 honestly — halves would starve the
    Calendar's squares, and thirds would starve the Trade rows.

    This is still not a layout engine: no persistence, no editor, no
    drag/drop, no resize, and no runtime that turns these numbers into a grid.
    The section's component spells its own `lg:grid-cols-12` and these numbers
    record what it spells.
  */
  { id: 'recent-and-calendar', desktopColumns: 12 },
  // Widgets whose own section is genuinely undecided because they are not
  // built yet. Full width is the honest placeholder, not a prediction.
  { id: 'reserved', desktopColumns: 1 },
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
  // D6B — one section, twelve columns, 7 + 5. The two widgets are read
  // together (which Trades happened, and when they happened), so they share a
  // row rather than stacking into two full-width bands. Both go full width on
  // mobile: a five-of-twelve calendar at 390px is unreadable.
  {
    widgetId: 'trades.recent',
    section: 'recent-and-calendar',
    order: 100,
    desktopSpan: 7,
    mobileSpan: 2,
    mobileOrder: 100,
  },
  {
    widgetId: 'calendar.performance',
    section: 'recent-and-calendar',
    order: 110,
    desktopSpan: 5,
    mobileSpan: 2,
    mobileOrder: 110,
  },
  {
    widgetId: 'account.balance',
    section: 'reserved',
    order: 120,
    desktopSpan: 1,
    mobileSpan: 2,
    mobileOrder: 120,
  },
  {
    widgetId: 'risk.drawdown',
    section: 'reserved',
    order: 130,
    desktopSpan: 1,
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
