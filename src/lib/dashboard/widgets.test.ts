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
   * A SWAP IS NOT A SUM, WHICH IS WHY THE TEST ABOVE MISSED ONE.
   *
   * `recent-and-calendar` carried 7 + 5 for a long stretch while the page
   * rendered 5 + 7. Every structural assertion passed throughout, because
   * every one of them is symmetric: both orderings are two members, both
   * stay within twelve columns, and both sum to exactly twelve. Nothing
   * caught it, and nothing in the page could, because for these two widgets
   * `desktopSpan` is metadata that no grid is built from.
   *
   * So the direction of the inequality is asserted directly. It is the part
   * that carries the design decision — a day cell needs width to stay
   * legible, a three-field Trade row stops using it at about 500px — and it
   * is the only part a symmetric check cannot see.
   */
  it('gives the Calendar the wider half of the record section', () => {
    const recent = dashboardLayoutItem('trades.recent');
    const calendar = dashboardLayoutItem('calendar.performance');

    expect(recent.desktopSpan).toBe(5);
    expect(calendar.desktopSpan).toBe(7);
    expect(calendar.desktopSpan).toBeGreaterThan(recent.desktopSpan);
    expect(recent.desktopSpan + calendar.desktopSpan).toBe(
      dashboardSection('recent-and-calendar').desktopColumns,
    );
  });

  /**
   * THE TWO BASELINE WIDGETS ARE RETIRED, AND SO IS THEIR SECTION.
   *
   * `system.performance` and `trader.performance` were equal halves of a
   * two-column `performance` section. They and the Execution Gap section
   * were merged into one System vs Trader card, so both ids and the section
   * are gone rather than left as slots nothing fills. This asserts the
   * absence directly: a retired id that quietly comes back would otherwise
   * only be caught by a type error in whichever file re-added it.
   */
  it('no longer carries the retired System and Trader baseline widgets', () => {
    const ids: readonly string[] = DASHBOARD_WIDGET_IDS;
    expect(ids).not.toContain('system.performance');
    expect(ids).not.toContain('trader.performance');
    const sections: readonly string[] = DASHBOARD_SECTIONS.map((section) => section.id);
    expect(sections).not.toContain('performance');
    expect(
      DEFAULT_DASHBOARD_LAYOUT.some((item) => (item.section as string) === 'performance'),
    ).toBe(false);
  });

  /**
   * The merged System vs Trader card is a full-width analytical section at
   * every width — it owns its section rather than borrowing a column from
   * the KPI band, and it spans that section completely. It kept the
   * `execution.gap` id when it absorbed the two baselines: same capability,
   * same Population C model, so a new id would have implied a new thing
   * rather than an absorbed one.
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
    // It moved into the slot the two baselines vacated, so it now sits
    // between Needs Attention and the insight pillars that explain it.
    expect(gap.order).toBeGreaterThan(dashboardLayoutItem('review.needs-attention').order);
    expect(gap.order).toBeLessThan(dashboardLayoutItem('strategy.performance').order);
  });

  /**
   * D8B. The three pillars are exactly three peer widgets in one
   * three-column section — no sub-metric ever earns a widget ID, because a
   * widget ID is a layout slot and Emotion, Confidence, the checklist and
   * mistakes do not own one. D8A's provisional holding section is retired
   * along with the last `implementation: 'later'` widget on the page.
   */
  it('builds the three insight pillars as equal peers of one section', () => {
    expect(DASHBOARD_WIDGET_REGISTRY.filter((widget) => widget.implementation === 'later')).toEqual(
      [],
    );
    expect(DASHBOARD_SECTION_IDS).not.toContain('reserved');

    const pillars = DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.section === 'insight-pillars');
    expect(pillars.map((item) => item.widgetId)).toEqual([
      'strategy.performance',
      'psychology.performance',
      'discipline.performance',
    ]);
    const section = dashboardSection('insight-pillars');
    expect(section.desktopColumns).toBe(3);
    // Equal peers: identical spans that exactly fill the row.
    expect(new Set(pillars.map((item) => item.desktopSpan))).toEqual(new Set([1]));
    expect(pillars.reduce((total, item) => total + item.desktopSpan, 0)).toBe(
      section.desktopColumns,
    );
    // Full width on mobile — three columns at 390px would be unreadable.
    expect(new Set(pillars.map((item) => item.mobileSpan))).toEqual(new Set([2]));
  });

  /**
   * §2 — reading order, not an append. The pillars ask where the Execution
   * Gap came from, so they follow it and precede the record list; Risk
   * Performance still closes the page.
   */
  it('places the pillars after the Execution Gap and before the record list', () => {
    const gap = dashboardLayoutItem('execution.gap').order;
    const recent = dashboardLayoutItem('trades.recent').order;
    const risk = dashboardLayoutItem('account.balance').order;
    for (const id of [
      'strategy.performance',
      'psychology.performance',
      'discipline.performance',
    ] as const) {
      const pillar = dashboardLayoutItem(id).order;
      expect(pillar).toBeGreaterThan(gap);
      expect(pillar).toBeLessThan(recent);
      expect(pillar).toBeLessThan(risk);
    }
    // The Execution Gap moved 90 -> 70 when it absorbed the two baseline
    // widgets and took the slot they vacated; the record list and Risk
    // Performance are untouched, and 80 and 90 are now free, which is what
    // decade numbering is for.
    expect([gap, recent, risk]).toEqual([70, 100, 120]);
  });

  /**
   * D7B §24. The two reserved IDs are mapped truthfully onto ONE shared
   * presentation section rather than either being collapsed into a single ID
   * or being invented as some third arbitrary widget. The section is unequal
   * on purpose: the balance carries the hero figures and the curve, the
   * drawdown carries two readings and the peak they are measured from.
   */
  it('maps both Risk Performance IDs onto one shared unequal section', () => {
    const balance = dashboardLayoutItem('account.balance');
    const drawdown = dashboardLayoutItem('risk.drawdown');
    expect(balance.section).toBe('risk-performance');
    expect(drawdown.section).toBe('risk-performance');
    const section = dashboardSection('risk-performance');
    expect(section.desktopColumns).toBe(12);
    expect(balance.desktopSpan).toBe(7);
    expect(drawdown.desktopSpan).toBe(5);
    expect(balance.desktopSpan + drawdown.desktopSpan).toBe(section.desktopColumns);
    expect(balance.order).toBeLessThan(drawdown.order);
    // Both stack full width on mobile — a five-of-twelve drawdown column at
    // 320px would be a pair of clipped currency figures.
    expect(balance.mobileSpan).toBe(2);
    expect(drawdown.mobileSpan).toBe(2);
    // Nothing else shares the section, so "one Risk Performance section"
    // cannot quietly become a widget shelf later.
    expect(
      DEFAULT_DASHBOARD_LAYOUT.filter((item) => item.section === 'risk-performance'),
    ).toHaveLength(2);
  });

  it('publishes the section and its column count alongside the span', () => {
    expect(dashboardWidgetAttributes(dashboardLayoutItem('execution.gap'))).toEqual({
      'data-dashboard-widget': 'execution.gap',
      'data-dashboard-section': 'execution-gap',
      'data-dashboard-section-columns': 1,
      'data-dashboard-desktop-span': 1,
      'data-dashboard-mobile-span': 2,
      'data-dashboard-order': 70,
    });
  });
});
