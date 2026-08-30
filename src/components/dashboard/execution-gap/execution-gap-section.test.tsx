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
    expect(within(strip).getByText('61.45%')).toBeVisible();
    // The independent Population A/B totals must not appear here.
    expect(strip.textContent).not.toContain('36.25');
    expect(strip.textContent).not.toContain('23.10');
    expect(strip.textContent).not.toContain('68');
    expect(strip.textContent).not.toContain('66');
  });

  /**
   * The Dashboard content budget for this section: EXACTLY two headline
   * figures, and these two. Average Execution Gap and the paired Trade count
   * are still composed and still on the payload — asserted below — they are
   * simply not headlines any more.
   */
  it('renders exactly two headline metrics and neither retired figure', () => {
    const { container } = renderSection();
    const strip = section(container).querySelector('[data-execution-gap-summary]') as HTMLElement;
    const keys = [...strip.querySelectorAll('[data-execution-gap-metric]')].map((node) =>
      node.getAttribute('data-execution-gap-metric'),
    );
    expect(keys).toEqual(['totalGap', 'systemEdgeCaptured']);
    expect(within(strip).getByText('Execution Gap')).toBeVisible();
    expect(within(strip).getByText('System Edge Captured')).toBeVisible();
    // The average (-0.22R) and the paired count (64) are gone from the strip.
    expect(strip.textContent).not.toContain('-0.22R');
    expect(strip.textContent).not.toContain('Average');
    expect(strip.textContent).not.toContain('Paired');
    expect(strip.textContent).not.toContain('64');
  });

  /**
   * §8 — the Gap is the answer and outranks the ratio that qualifies it. Two
   * equal figures would read as another KPI row.
   */
  it('gives the Gap a stronger type step than System Edge Captured', () => {
    const { container } = renderSection();
    const strip = section(container).querySelector('[data-execution-gap-summary]') as HTMLElement;
    const gap = strip.querySelector('[data-execution-gap-metric="totalGap"] dd span');
    const ratio = strip.querySelector('[data-execution-gap-metric="systemEdgeCaptured"] dd span');
    // 24px on a phone, 30px from `sm` up — see the component for why the
    // headline steps down at 320. Either way it outranks the ratio.
    expect(gap?.className).toContain('text-2xl');
    expect(gap?.className).toContain('sm:text-3xl');
    expect(ratio?.className).toContain('text-xl');
    expect(ratio?.className).not.toContain('text-2xl');
    expect(ratio?.className).not.toContain('text-3xl');
  });

  /**
   * §18 — System Edge Captured is unbounded, so it carries no meter of any
   * kind. A clamped bar would make 137% indistinguishable from 100%.
   */
  it('renders System Edge Captured as a number with no progress visual', () => {
    const { container } = renderSection();
    const cell = section(container).querySelector(
      '[data-execution-gap-metric="systemEdgeCaptured"]',
    ) as HTMLElement;
    expect(cell.querySelector('svg')).toBeNull();
    expect(cell.querySelector('progress')).toBeNull();
    expect(cell.querySelector('[role="progressbar"]')).toBeNull();
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

  it('renders exactly one plot, with an accessible label rather than bare SVG', () => {
    const { container } = renderSection();
    const panel = section(container);
    expect(
      within(panel).getByRole('img', { name: /Cumulative paired System R/i }),
    ).toBeInTheDocument();
    // §15/§16 — the daily strip and the distribution bar are no longer
    // mounted on the Dashboard. One visualisation, which answers the one
    // question a chart answers better than a number: when did the two curves
    // diverge?
    expect(within(panel).queryByRole('img', { name: /Execution Gap per day/i })).toBeNull();
    expect(panel.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(panel.querySelector('[data-execution-gap-distribution]')).toBeNull();
  });

  /**
   * §29 — no permanent explanatory prose survives on this card. The chart's
   * own `figcaption` and the fallback table stay, but both are screen-reader
   * only, so they are asserted as PRESENT rather than counted as visible copy.
   */
  it('carries no visible explanatory paragraph while keeping its accessible text', () => {
    const { container } = renderSection();
    const panel = section(container);
    const visibleProse = [...panel.querySelectorAll('p, figcaption')].filter(
      (node) => !node.classList.contains('sr-only') && !node.closest('.sr-only'),
    );
    expect(visibleProse).toHaveLength(0);
    // Still there for assistive technology.
    expect(panel.querySelector('figcaption.sr-only')).not.toBeNull();
    expect(panel.querySelector('table')).not.toBeNull();
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
  /**
   * §16 — the distribution leaves the DASHBOARD presentation only. Its data is
   * still composed and still handed to this component; `gap-distribution.tsx`
   * still exists and still renders it. Nothing about the population changed.
   */
  it('no longer renders the distribution while its data is still supplied', () => {
    const model = comparison();
    const { container } = renderSection(model);
    expect(section(container).querySelector('[data-execution-gap-distribution]')).toBeNull();
    for (const label of ['Underperformed System', 'Matched System', 'Outperformed System']) {
      expect(section(container).textContent).not.toContain(label);
    }
    // The payload the Dashboard stopped rendering is unchanged.
    expect(model.status === 'available' && model.distribution).toMatchObject({
      underperformedCount: 45,
      matchedCount: 2,
      outperformedCount: 17,
    });
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
    // Both headline metrics state the same canonical reason rather than
    // falling back to 0R / 0% / n/a (§20).
    const strip = panel.querySelector('[data-execution-gap-summary]') as HTMLElement;
    expect(strip.querySelectorAll('[data-metric-status="unavailable"]')).toHaveLength(2);
    expect(strip.textContent).not.toMatch(/Infinity|NaN|0\.00R|100%/);
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
