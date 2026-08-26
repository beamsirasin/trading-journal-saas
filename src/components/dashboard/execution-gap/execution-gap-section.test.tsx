import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import type {
  DashboardExecutionComparison,
  ExecutionComparisonDailyPoint,
} from '@/lib/dashboard/execution-comparison';

import en from '../../../../messages/en.json';
import { ExecutionGapSection } from './execution-gap-section';

/**
 * Recharts measures its parent with ResizeObserver, which jsdom does not
 * implement — without this every plot renders at zero size and no SVG at all.
 * Stubbing the observer keeps these tests about the section's contract rather
 * than about layout measurement.
 */
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const available = (value: string) => ({ status: 'available' as const, value });
const unavailable = (
  reason: 'no_trades' | 'no_losses' | 'no_comparable_trades' | 'system_has_no_edge',
) => ({ status: 'unavailable' as const, reason });

function daily(
  date: string,
  systemR: string,
  actualR: string,
  gapR: string,
  cumSystem: string,
  cumActual: string,
  cumGap: string,
  pairedTradeCount = 1,
): ExecutionComparisonDailyPoint {
  return {
    date,
    pairedTradeCount,
    systemR,
    actualR,
    executionGapR: gapR,
    cumulativeSystemR: cumSystem,
    cumulativeActualR: cumActual,
    cumulativeExecutionGapR: cumGap,
  };
}

/**
 * A miniature of the deterministic fixture's shape: paired totals that end
 * DELIBERATELY away from any independent Population A/B figure, so a test can
 * tell the two apart.
 */
const DAILY: readonly ExecutionComparisonDailyPoint[] = [
  daily('2026-05-27', '-0.9000', '2.2000', '3.1000', '-0.9000', '2.2000', '3.1000'),
  daily('2026-06-02', '4.0000', '1.0000', '-3.0000', '3.1000', '3.2000', '0.1000', 2),
  daily('2026-08-16', '32.7000', '18.8000', '-13.9000', '35.8000', '22.0000', '-13.8000'),
];

function comparison(
  overrides: Partial<Extract<DashboardExecutionComparison, { status: 'available' }>> = {},
): DashboardExecutionComparison {
  return {
    status: 'available',
    summary: {
      comparableCount: 64,
      pairedSystemTotalR: available('35.8000'),
      pairedActualTotalR: available('22.0000'),
      executionGapR: available('-13.8000'),
      averageExecutionGapR: available('-0.2156'),
      systemEdgeCaptured: available('0.6145'),
    },
    tradeSeries: [],
    dailySeries: DAILY,
    distribution: {
      underperformedCount: 45,
      matchedCount: 2,
      outperformedCount: 17,
      minimumExecutionGapR: available('-3.6500'),
      maximumExecutionGapR: available('3.3500'),
    },
    ...overrides,
  };
}

function renderSection(model: DashboardExecutionComparison = comparison()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ExecutionGapSection comparison={model} dateLocale="en-GB" />
    </NextIntlClientProvider>,
  );
}

function section(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-dashboard-panel="execution-gap"]') as HTMLElement;
}

describe('ExecutionGapSection — widget identity', () => {
  it('renders as the registered execution.gap widget in its full-width section', () => {
    const { container } = renderSection();
    const widget = container.querySelector('[data-dashboard-widget="execution.gap"]');
    expect(widget).not.toBeNull();
    expect(widget).toHaveAttribute('data-dashboard-section', 'execution-gap');
    expect(widget).toHaveAttribute('data-dashboard-section-columns', '1');
    expect(widget).toHaveAttribute('data-dashboard-desktop-span', '1');
    expect(widget).toHaveAttribute('data-execution-gap-status', 'available');
  });

  it('names itself with a real heading the section is labelled by', () => {
    const { container } = renderSection();
    const heading = screen.getByRole('heading', { name: 'Execution Gap' });
    const widget = container.querySelector('[data-dashboard-widget="execution.gap"]');
    expect(widget).toHaveAttribute('aria-labelledby', heading.id);
  });
});

describe('ExecutionGapSection — summary strip', () => {
  it('shows the paired totals, never D4 independent totals', () => {
    const { container } = renderSection();
    const strip = section(container).querySelector('[data-execution-gap-summary]') as HTMLElement;
    // The paired figures.
    expect(within(strip).getByText('-13.80R')).toBeVisible();
    expect(within(strip).getByText('-0.22R')).toBeVisible();
    expect(within(strip).getByText('61.45%')).toBeVisible();
    expect(within(strip).getByText('64')).toBeVisible();
    // The independent Population A/B totals must not appear here.
    expect(strip.textContent).not.toContain('36.25');
    expect(strip.textContent).not.toContain('23.10');
    expect(strip.textContent).not.toContain('68');
    expect(strip.textContent).not.toContain('66');
  });

  it('keeps the Total Gap sign and its negative tone', () => {
    const { container } = renderSection();
    const metric = section(container).querySelector(
      '[data-execution-gap-metric="totalGap"]',
    ) as HTMLElement;
    const value = within(metric).getByText('-13.80R');
    expect(value.className).toContain('text-negative');
  });

  it('keeps a positive Total Gap positive rather than reversing the formula', () => {
    const { container } = renderSection(
      comparison({
        summary: { ...comparison().summary, executionGapR: available('4.2000') },
      } as never),
    );
    const metric = section(container).querySelector(
      '[data-execution-gap-metric="totalGap"]',
    ) as HTMLElement;
    const value = within(metric).getByText('+4.20R');
    expect(value.className).toContain('text-positive');
  });

  it('renders an exactly matched aggregate as a neutral signed zero', () => {
    const { container } = renderSection(
      comparison({
        summary: { ...comparison().summary, executionGapR: available('0.0000') },
      } as never),
    );
    const metric = section(container).querySelector(
      '[data-execution-gap-metric="totalGap"]',
    ) as HTMLElement;
    const value = within(metric).getByText('0.00R');
    expect(value.className).toContain('text-foreground');
  });

  /**
   * §7. Captured is a NUMBER, never a bar or a gauge — every meter would have
   * to clamp, and a clamped 137% is indistinguishable from exactly 100%.
   */
  it('renders System Edge Captured above 100% literally, with no clamped meter', () => {
    const { container } = renderSection(
      comparison({
        summary: { ...comparison().summary, systemEdgeCaptured: available('1.3700') },
      } as never),
    );
    const metric = section(container).querySelector(
      '[data-execution-gap-metric="systemEdgeCaptured"]',
    ) as HTMLElement;
    expect(within(metric).getByText('137.00%')).toBeVisible();
    expect(metric.querySelector('[role="progressbar"]')).toBeNull();
    expect(metric.querySelector('[style*="width"]')).toBeNull();
  });

  it('renders a negative System Edge Captured literally', () => {
    const { container } = renderSection(
      comparison({
        summary: { ...comparison().summary, systemEdgeCaptured: available('-0.2200') },
      } as never),
    );
    const metric = section(container).querySelector(
      '[data-execution-gap-metric="systemEdgeCaptured"]',
    ) as HTMLElement;
    expect(within(metric).getByText('-22.00%')).toBeVisible();
  });
});

describe('ExecutionGapSection — charts', () => {
  it('plots the canonical cumulative values and ends on the paired totals', () => {
    const { container } = renderSection();
    const table = section(container).querySelector('table') as HTMLTableElement;
    const lastRow = table.querySelectorAll('tbody tr')[DAILY.length - 1] as HTMLElement;
    const cells = [...lastRow.querySelectorAll('th, td')].map((cell) => cell.textContent);
    // date, paired count, cum System, cum Actual, cum Gap, that day's Gap.
    expect(cells).toEqual(['16 Aug', '1', '+35.80R', '+22.00R', '-13.80R', '-13.90R']);
  });

  it('reconciles the final chart point with the summary Total Gap', () => {
    const { container } = renderSection();
    const strip = section(container).querySelector('[data-execution-gap-summary]') as HTMLElement;
    const table = section(container).querySelector('table') as HTMLTableElement;
    const lastRow = table.querySelectorAll('tbody tr')[DAILY.length - 1] as HTMLElement;
    const cumulativeGap = lastRow.querySelectorAll('td')[3]?.textContent;
    expect(cumulativeGap).toBe('-13.80R');
    expect(within(strip).getByText('-13.80R')).toBeVisible();
  });

  it('renders both plots with accessible labels rather than bare SVG', () => {
    const { container } = renderSection();
    expect(
      within(section(container)).getByRole('img', { name: /Cumulative paired System R/i }),
    ).toBeInTheDocument();
    expect(
      within(section(container)).getByRole('img', { name: /Execution Gap per day/i }),
    ).toBeInTheDocument();
  });

  it('names both series in text so identity is never colour alone', () => {
    const { container } = renderSection();
    const legend = section(container).querySelector('ul') as HTMLElement;
    expect(within(legend).getByText('System')).toBeVisible();
    expect(within(legend).getByText('Actual')).toBeVisible();
    // The stroke style is named too, so the pair survives greyscale and CVD.
    expect(legend.textContent).toContain('dashed');
    expect(legend.textContent).toContain('solid');
  });

  it('carries the daily Gap sign into the accessible table', () => {
    const { container } = renderSection();
    const table = section(container).querySelector('table') as HTMLTableElement;
    const dailyGaps = [...table.querySelectorAll('tbody tr')].map(
      (row) => row.querySelectorAll('td')[4]?.textContent,
    );
    expect(dailyGaps).toEqual(['+3.10R', '-3.00R', '-13.90R']);
  });

  it('never emits NaN or Infinity into the rendered output', () => {
    const { container } = renderSection();
    const markup = container.innerHTML;
    expect(markup).not.toContain('NaN');
    expect(markup).not.toContain('Infinity');
  });
});

describe('ExecutionGapSection — distribution', () => {
  it('shows the three relative counts without grading the trader', () => {
    const { container } = renderSection();
    const distribution = section(container).querySelector(
      '[data-execution-gap-distribution]',
    ) as HTMLElement;
    expect(within(distribution).getByText('Underperformed System')).toBeVisible();
    expect(within(distribution).getByText('45')).toBeVisible();
    expect(within(distribution).getByText('Matched System')).toBeVisible();
    expect(within(distribution).getByText('2')).toBeVisible();
    expect(within(distribution).getByText('Outperformed System')).toBeVisible();
    expect(within(distribution).getByText('17')).toBeVisible();
    for (const forbidden of ['Bad', 'Good', 'Grade', 'Score']) {
      expect(distribution.textContent).not.toContain(forbidden);
    }
  });
});

describe('ExecutionGapSection — availability', () => {
  /**
   * §17. Only the ratio is undefined. Losing the chart, the Gap and the
   * distribution because one metric cannot be expressed would throw away the
   * answer to the question this section exists to ask.
   */
  it('keeps the charts when System Edge Captured is unavailable', () => {
    const { container } = renderSection(
      comparison({
        summary: {
          ...comparison().summary,
          pairedSystemTotalR: available('-1.0000'),
          systemEdgeCaptured: unavailable('system_has_no_edge'),
        },
      } as never),
    );
    const panel = section(container);
    expect(panel).toHaveAttribute('data-dashboard-panel', 'execution-gap');
    expect(within(panel).getByText('No positive paired System edge')).toBeVisible();
    // Everything else survives.
    expect(within(panel).getByRole('img', { name: /Cumulative paired System R/i })).toBeVisible();
    const strip = panel.querySelector('[data-execution-gap-summary]') as HTMLElement;
    expect(within(strip).getByText('-13.80R')).toBeVisible();
    expect(within(panel).getByText('45')).toBeVisible();
    expect(panel.querySelector('[data-execution-gap-state="empty"]')).toBeNull();
  });

  it('shows a deliberate empty state with no chart axes when nothing is paired', () => {
    const { container } = renderSection({
      status: 'empty',
      reason: 'no_comparable_trades',
      summary: {
        comparableCount: 0,
        pairedSystemTotalR: unavailable('no_comparable_trades'),
        pairedActualTotalR: unavailable('no_comparable_trades'),
        executionGapR: unavailable('no_comparable_trades'),
        averageExecutionGapR: unavailable('no_comparable_trades'),
        systemEdgeCaptured: unavailable('no_comparable_trades'),
      },
    });
    const panel = section(container);
    const emptyState = panel.querySelector('[data-execution-gap-state="empty"]') as HTMLElement;
    expect(emptyState).not.toBeNull();
    // The phrase appears twice by design: as this state's title, and as the
    // canonical unavailable reason on each summary metric above it.
    expect(within(emptyState).getByText('No comparable Trades')).toBeVisible();
    expect(
      within(panel).getByText(/completed Actual outcome and a resolved System outcome/i),
    ).toBeVisible();
    // No plot frame, no axes, no legend — an empty chart still reads as a chart.
    expect(panel.querySelector('[role="img"]')).toBeNull();
    expect(panel.querySelector('table')).toBeNull();
    expect(within(panel).getByText('0')).toBeVisible();
  });

  it('distinguishes an integrity error from an empty population', () => {
    const { container } = renderSection({
      status: 'error',
      reason: 'data_integrity_error',
      summary: {
        comparableCount: 2,
        pairedSystemTotalR: { status: 'error', reason: 'data_integrity_error' },
        pairedActualTotalR: { status: 'error', reason: 'data_integrity_error' },
        executionGapR: { status: 'error', reason: 'data_integrity_error' },
        averageExecutionGapR: { status: 'error', reason: 'data_integrity_error' },
        systemEdgeCaptured: { status: 'error', reason: 'data_integrity_error' },
      },
    });
    const panel = section(container);
    expect(panel.querySelector('[data-execution-gap-state="error"]')).not.toBeNull();
    expect(within(panel).getByRole('alert')).toBeVisible();
    // Never "no Trades yet" — more Trades cannot fix a stored-data problem.
    expect(panel.textContent).not.toContain('No comparable Trades');
    expect(panel.querySelector('[role="img"]')).toBeNull();
  });
});
