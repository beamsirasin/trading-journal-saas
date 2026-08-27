import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_SECTIONS,
  DASHBOARD_WIDGET_IDS,
  DASHBOARD_WIDGET_REGISTRY,
  dashboardLayoutItem,
  dashboardSection,
  dashboardWidgetAttributes,
  DEFAULT_DASHBOARD_LAYOUT,
} from './widgets';

describe('static Dashboard widget foundation', () => {
  it('has unique stable widget IDs and exactly one registry entry per ID', () => {
    expect(new Set(DASHBOARD_WIDGET_IDS).size).toBe(DASHBOARD_WIDGET_IDS.length);
    expect(new Set(DASHBOARD_WIDGET_REGISTRY.map((widget) => widget.id)).size).toBe(
      DASHBOARD_WIDGET_REGISTRY.length,
    );
    expect(DASHBOARD_WIDGET_REGISTRY.map((widget) => widget.id).sort()).toEqual(
      [...DASHBOARD_WIDGET_IDS].sort(),
    );
  });

  it('references only registered widgets exactly once in the default layout', () => {
    const registered = new Set(DASHBOARD_WIDGET_IDS);
    const layoutIds = DEFAULT_DASHBOARD_LAYOUT.map((item) => item.widgetId);
    expect(layoutIds.every((id) => registered.has(id))).toBe(true);
    expect(new Set(layoutIds).size).toBe(layoutIds.length);
    expect([...layoutIds].sort()).toEqual([...DASHBOARD_WIDGET_IDS].sort());
  });

  it('defines deterministic valid desktop and two-column-mobile metadata', () => {
    expect(new Set(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.order)).size).toBe(
      DEFAULT_DASHBOARD_LAYOUT.length,
    );
    expect(new Set(DEFAULT_DASHBOARD_LAYOUT.map((item) => item.mobileOrder)).size).toBe(
      DEFAULT_DASHBOARD_LAYOUT.length,
    );
    for (const item of DEFAULT_DASHBOARD_LAYOUT) {
      expect(item.desktopSpan).toBeGreaterThanOrEqual(1);
      // A span is read against ITS OWN section's grid, never a page-wide one
      // (D4.5). D6B's twelve-column Recent/Calendar section is why this is
      // section-aware rather than a fixed ceiling of five.
      expect(item.desktopSpan).toBeLessThanOrEqual(dashboardSection(item.section).desktopColumns);
      expect(item.mobileSpan === 1 || item.mobileSpan === 2).toBe(true);
      expect(dashboardLayoutItem(item.widgetId)).toBe(item);
    }
  });

  it('gives the five Basic KPI widgets a single desktop column each', () => {
    const basic = DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.widgetId.startsWith('basic.'));
    expect(basic).toHaveLength(5);
    expect(basic.every((item) => item.section === 'basic-kpi')).toBe(true);
    expect(basic.every((item) => item.desktopSpan === 1)).toBe(true);
    expect(basic.map((item) => item.order)).toEqual([10, 20, 30, 40, 50]);
    // The five spans total the section's own grid width, so the row balances.
    expect(basic.reduce((total, item) => total + item.desktopSpan, 0)).toBe(
      dashboardSection('basic-kpi').desktopColumns,
    );
  });

  it('spans the last Basic KPI across the two-column mobile grid', () => {
    // Four one-column cards fill two mobile rows; a fifth one-column card
    // would dangle beside an empty cell, so it spans instead.
    const narrow = DEFAULT_DASHBOARD_LAYOUT.filter(
      (item) => item.widgetId.startsWith('basic.') && item.mobileSpan === 1,
    );
    expect(narrow).toHaveLength(4);
    expect(dashboardLayoutItem('basic.avg-win-loss').mobileSpan).toBe(2);
  });

  it('marks every Basic KPI widget as implemented', () => {
    const basic = DASHBOARD_WIDGET_REGISTRY.filter((widget) => widget.capability === 'basic');
    expect(basic).toHaveLength(5);
    expect(basic.every((widget) => widget.implementation === 'current')).toBe(true);
  });
});

describe('section-aware Dashboard layout metadata', () => {
  it('defines every section exactly once and places every widget in a real one', () => {
    expect(new Set(DASHBOARD_SECTIONS.map((section) => section.id)).size).toBe(
      DASHBOARD_SECTIONS.length,
    );
    expect(DASHBOARD_SECTIONS.map((section) => section.id).sort()).toEqual(
      [...DASHBOARD_SECTION_IDS].sort(),
    );
    for (const item of DEFAULT_DASHBOARD_LAYOUT) {
      expect(dashboardSection(item.section).id).toBe(item.section);
    }
  });

  it('never lets a widget span more columns than its own section has', () => {
    for (const item of DEFAULT_DASHBOARD_LAYOUT) {
      expect(item.desktopSpan).toBeLessThanOrEqual(dashboardSection(item.section).desktopColumns);
    }
  });

  it('fills every section it defines with whole rows', () => {
    for (const section of DASHBOARD_SECTIONS) {
      const members = DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.section === section.id);
      expect(members.length).toBeGreaterThan(0);
      const spanned = members.reduce((total, item) => total + item.desktopSpan, 0);
      expect(spanned % section.desktopColumns).toBe(0);
    }
  });

  /**
   * The D4.5 §7 reconciliation itself. D2 recorded 2 and 3 of an implied
   * five-column page grid — a 40/60 split D4 already refused to render. The
   * pair is now a section of its own with one column each, so the metadata
   * and the rendered page finally agree, and the retired split cannot come
   * back without failing here.
   */
  it('makes System and Trader equal halves of one two-column section', () => {
    const system = dashboardLayoutItem('system.performance');
    const trader = dashboardLayoutItem('trader.performance');
    expect(system.section).toBe('performance');
    expect(trader.section).toBe('performance');
    expect(dashboardSection('performance').desktopColumns).toBe(2);
    expect(system.desktopSpan).toBe(trader.desktopSpan);
    expect(system.desktopSpan).toBe(1);
    expect(system.order).toBeLessThan(trader.order);
  });

  /**
   * D5A §18. The Execution Gap is a full-width analytical section at every
   * width — it owns its section rather than borrowing a column from the KPI
   * band or the performance pair, and it spans that section completely. D5B
   * builds the visual on top of this metadata; nothing here anticipates what
   * that visual looks like.
   */
  it('keeps the Execution Gap a full-width section of its own', () => {
    const gap = dashboardLayoutItem('execution.gap');
    expect(gap.section).toBe('execution-gap');
    const section = dashboardSection('execution-gap');
    expect(section.desktopColumns).toBe(1);
    expect(gap.desktopSpan).toBe(section.desktopColumns);
    expect(gap.mobileSpan).toBe(2);
    // Nothing else shares the section, so "full width" cannot quietly become
    // "half of a two-widget row" later.
    expect(
      DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.section === 'execution-gap'),
    ).toHaveLength(1);
    // It follows the System/Trader pair it explains.
    expect(gap.order).toBeGreaterThan(dashboardLayoutItem('trader.performance').order);
  });

  it('parks every unbuilt widget in the reserved section rather than guessing one', () => {
    const later = DASHBOARD_WIDGET_REGISTRY.filter(
      (widget) => widget.implementation === 'later',
    ).map((widget) => widget.id);
    expect(later.length).toBeGreaterThan(0);
    for (const id of later) {
      expect(dashboardLayoutItem(id).section).toBe('reserved');
    }
  });

  it('publishes the section and its column count alongside the span', () => {
    expect(dashboardWidgetAttributes(dashboardLayoutItem('trader.performance'))).toEqual({
      'data-dashboard-widget': 'trader.performance',
      'data-dashboard-section': 'performance',
      'data-dashboard-section-columns': 2,
      'data-dashboard-desktop-span': 1,
      'data-dashboard-mobile-span': 2,
      'data-dashboard-order': 80,
    });
  });
});
