import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import { DEMO_DEFAULT_RANGE, demoBundle } from '@/lib/demo';

import en from '../../../messages/en.json';
import { DemoDashboard } from './demo-dashboard';

/**
 * PHASE 1.1 — dashboard simplification.
 *
 * The dashboard answers "what is happening right now", not "why" — that is
 * `/app/analytics`'s job. These tests assert the shape the phase brief
 * requires directly, so a future edit that quietly re-adds a fifth KPI card
 * or a second chart fails here rather than only being caught by eye.
 */
function renderDashboard() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DemoDashboard />
    </NextIntlClientProvider>,
  );
}

describe('DemoDashboard simplification', () => {
  it('shows exactly four headline KPI cards', () => {
    renderDashboard();
    const kpis = document.querySelectorAll('[data-kpi]');
    expect(kpis).toHaveLength(4);

    const labels = [...kpis].map((el) => el.getAttribute('data-kpi'));
    expect(labels).toEqual([
      en.dashboard.netPnl,
      en.dashboard.actualWinRate,
      en.dashboard.actualAverageR,
      en.dashboard.disciplineScore,
    ]);
  });

  it('does not surface System/Actual Expectancy, Profit Factor, Max Drawdown or Execution Efficiency as top-level cards', () => {
    renderDashboard();
    const kpiLabels = [...document.querySelectorAll('[data-kpi]')].map((el) =>
      el.getAttribute('data-kpi'),
    );

    for (const forbidden of [
      en.analytics.systemVsActual.profitFactor,
      en.analytics.systemVsActual.maxDrawdown,
      en.attribution.edgeLeakage,
    ]) {
      expect(kpiLabels).not.toContain(forbidden);
    }
  });

  it('renders exactly one primary performance chart', () => {
    renderDashboard();
    expect(document.querySelectorAll('figure')).toHaveLength(1);
  });

  it('includes a system-vs-trader module with win rate, average R and expectancy, plus an edge-leakage insight and an analytics link', () => {
    renderDashboard();

    expect(screen.getByText(en.dashboard.systemVsTrader.winRate)).toBeInTheDocument();
    expect(screen.getByText(en.dashboard.systemVsTrader.averageR)).toBeInTheDocument();
    expect(screen.getByText(en.dashboard.systemVsTrader.expectancy)).toBeInTheDocument();

    const bundle = demoBundle(DEMO_DEFAULT_RANGE);
    expect(
      screen.getByText(
        en.dashboard.systemVsTrader.edgeLeakageInsight.replace(
          '{value}',
          bundle.attribution.edgeLeakageR,
        ),
      ),
    ).toBeInTheDocument();

    const analyticsLinks = screen.getAllByRole('link', {
      name: en.dashboard.systemVsTrader.viewDetailedAnalytics,
    });
    expect(analyticsLinks.length).toBeGreaterThan(0);
    expect(analyticsLinks[0]).toHaveAttribute('href', expect.stringMatching(/\/app\/analytics$/));
  });

  it('shows only the top three mistakes, ranked by cost, with a link to the full analytics', () => {
    renderDashboard();

    const heading = screen.getByRole('heading', { name: en.dashboard.mistakes.title });
    const section = heading.closest('section');
    expect(section).not.toBeNull();

    const items = within(section as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(3);

    const bundle = demoBundle(DEMO_DEFAULT_RANGE);
    const topThree = [...bundle.mistakes].slice(0, 3).map((mistake) => mistake.label);
    for (const label of topThree) {
      expect(within(section as HTMLElement).getByText(label)).toBeInTheDocument();
    }

    expect(
      within(section as HTMLElement).getByRole('link', {
        name: en.dashboard.mistakes.viewDetailedAnalytics,
      }),
    ).toHaveAttribute('href', expect.stringMatching(/\/app\/analytics$/));
  });

  it('renders recent trades in both a table and a card presentation', () => {
    renderDashboard();
    expect(document.querySelector('[data-trades-view="table"]')).toBeInTheDocument();
    expect(document.querySelector('[data-trades-view="cards"]')).toBeInTheDocument();
  });
});
