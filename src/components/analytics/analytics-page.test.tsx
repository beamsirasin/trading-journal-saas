import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsMetric,
  AnalyticsSnapshot,
  PerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import type { AnalyticsFilterOptions } from '@/server/dal/analytics';

import en from '../../../messages/en.json';
import { RealAnalyticsPage } from './analytics-page';

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const equity = (
  points: readonly { tradeId: string; occurredAt: string; cumulativeR: string }[],
) => ({
  status: 'available' as const,
  value: points,
});

function axis(sampleCount: number, total = '4.0000'): PerformanceAnalyticsModel {
  return {
    sampleCount,
    totalR: available(total),
    averageR: available('1.3333'),
    expectancyR: available('1.3333'),
    winRate: available('0.6667'),
    profitFactor: available('5.0000'),
    maximumDrawdownR: available('1.2500'),
    averageWinR: available('2.5000'),
    averageLossR: available('-1.0000'),
    payoffRatio: available('2.5000'),
    equityCurve: equity([
      {
        tradeId: `${sampleCount}-1`,
        occurredAt: '2026-08-01T10:00:00.000Z',
        cumulativeR: '1.0000',
      },
      { tradeId: `${sampleCount}-2`, occurredAt: '2026-08-02T10:00:00.000Z', cumulativeR: total },
    ]),
  };
}

const options: AnalyticsFilterOptions = {
  accounts: [{ tradingAccountId: 'account-a', name: 'Primary', isArchived: false }],
  strategies: [{ strategyId: 'strategy-a', label: 'Momentum', isArchived: false }],
  setups: [{ setupId: 'setup-a', strategyId: 'strategy-a', label: 'Retest', isArchived: false }],
  strategyVersions: [
    {
      strategyVersionId: 'version-a',
      strategyId: 'strategy-a',
      versionNumber: 1,
      strategyName: 'Momentum',
    },
  ],
};

function snapshot(overrides: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot {
  return {
    scope: {
      datePreset: '90d',
      dateBounds: {
        kind: 'bounded',
        start: '2026-05-12T00:00:00.000Z',
        endExclusive: '2026-08-10T00:00:00.000Z',
      },
      accountScope: { kind: 'account', accountId: 'account-a', source: 'active' },
      strategyId: null,
      setupId: null,
      strategyVersionId: null,
      timezone: 'Asia/Bangkok',
    },
    system: axis(2, '4.0000'),
    trader: axis(3, '-1.0000'),
    comparison: {
      comparableCount: 2,
      pairedSystemTotalR: available('3.0000'),
      pairedActualTotalR: available('-1.0000'),
      edgeLeakageR: available('4.0000'),
      executionEfficiency: available('-0.3333'),
    },
    rules: {
      followedCount: 3,
      violatedCount: 1,
      notCheckedCount: 2,
      notApplicableCount: 4,
      evaluatedCount: 4,
      adherenceRate: available('0.7500'),
    },
    mistakes: [
      { mistakeTypeId: 'm1', key: 'a', label: 'Chased entry', tradeCount: 3 },
      { mistakeTypeId: 'm2', key: 'b', label: 'Moved stop', tradeCount: 2 },
    ],
    ...overrides,
  };
}

function renderPage(model = snapshot()) {
  const display = (
    model.trader.equityCurve.status === 'available' ? model.trader.equityCurve.value : []
  ).map((point) => ({
    ...point,
    occurredAtDisplay: point.tradeId.endsWith('1') ? '01 Aug 2026' : '02 Aug 2026',
  }));
  const systemDisplay = (
    model.system.equityCurve.status === 'available' ? model.system.equityCurve.value : []
  ).map((point) => ({
    ...point,
    occurredAtDisplay: point.tradeId.endsWith('1') ? '01 Aug 2026' : '02 Aug 2026',
  }));
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RealAnalyticsPage
        snapshot={model}
        filterOptions={options}
        selection={{ range: '90d', account: null, strategy: null, setup: null, version: null }}
        equity={{ trader: display, system: systemDisplay }}
      />
    </NextIntlClientProvider>,
  );
}

describe('RealAnalyticsPage', () => {
  it('renders complete independent System and Trader metric families without Average R duplication', () => {
    const { container } = renderPage();
    const system = container.querySelector('[data-analytics-panel="system"]') as HTMLElement;
    const trader = container.querySelector('[data-analytics-panel="trader"]') as HTMLElement;
    expect(within(system).getByText('2 Trades')).toBeVisible();
    expect(within(trader).getByText('3 Trades')).toBeVisible();
    for (const label of [
      'Total R',
      'Expectancy (Average R)',
      'Win Rate',
      'Profit Factor',
      'Maximum Drawdown R',
      'Average Win R',
      'Average Loss R',
      'Payoff Ratio',
    ]) {
      expect(within(system).getByText(label)).toBeVisible();
      expect(within(trader).getByText(label)).toBeVisible();
    }
    expect(within(system).getByText('-1.00R')).toBeVisible();
    expect(screen.queryByText('Average R', { exact: true })).not.toBeInTheDocument();
  });

  it('uses paired totals and preserves negative efficiency without a verdict', () => {
    renderPage();
    const comparison = screen
      .getByText('System vs Trader Comparison')
      .closest('section') as HTMLElement;
    expect(within(comparison).getByText('+3.00R')).toBeVisible();
    expect(within(comparison).getByText('-1.00R')).toBeVisible();
    expect(within(comparison).getByText('+4.00R')).toBeVisible();
    expect(within(comparison).getByText('-33.33%')).toBeVisible();
    expect(
      screen.queryByText(/Strong Edge|Execution Grade|Confidence level/i),
    ).not.toBeInTheDocument();
  });

  it('renders independently ordered equity curves with accessible high-precision fallback values', () => {
    renderPage();
    expect(screen.getByText('Trader Equity Curve')).toBeVisible();
    expect(screen.getByText('System Equity Curve')).toBeVisible();
    expect(screen.getByText('Trader cumulative R values by exit date')).toBeInTheDocument();
    expect(screen.getByText('System cumulative R values by exit date')).toBeInTheDocument();
    expect(screen.getAllByText('+1.00R').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Edge Leakage.*curve|line gap/i)).not.toBeInTheDocument();
  });

  it('shows Rule statuses distinctly and count-only canonical Mistake ranking', () => {
    renderPage();
    const rules = screen.getByText('Rule Analytics').closest('section') as HTMLElement;
    expect(within(rules).getByText('75.00%')).toBeVisible();
    expect(within(rules).getByText('Not Checked')).toBeVisible();
    expect(within(rules).getByText('Not Applicable')).toBeVisible();
    const mistakes = screen.getByText('Most Frequent Mistakes').closest('section') as HTMLElement;
    expect(within(mistakes).getByText('Chased entry')).toBeVisible();
    expect(within(mistakes).getByText('3 Trades')).toBeVisible();
    expect(within(mistakes).getByText('Moved stop')).toBeVisible();
    expect(
      screen.queryByText(/Discipline Score|Costliest|Lost R|Mistake Cost/i),
    ).not.toBeInTheDocument();
  });

  it('keeps sections present when System, Trader, comparison, Rules, and Mistakes are empty', () => {
    const unavailable = { status: 'unavailable' as const, reason: 'no_trades' as const };
    const emptyAxis = { ...axis(0), sampleCount: 0, totalR: unavailable, equityCurve: unavailable };
    renderPage(
      snapshot({
        system: emptyAxis,
        trader: emptyAxis,
        comparison: {
          comparableCount: 0,
          pairedSystemTotalR: { status: 'unavailable', reason: 'no_comparable_trades' },
          pairedActualTotalR: { status: 'unavailable', reason: 'no_comparable_trades' },
          edgeLeakageR: { status: 'unavailable', reason: 'no_comparable_trades' },
          executionEfficiency: { status: 'unavailable', reason: 'no_comparable_trades' },
        },
        rules: {
          followedCount: 0,
          violatedCount: 0,
          notCheckedCount: 0,
          notApplicableCount: 0,
          evaluatedCount: 0,
          adherenceRate: { status: 'unavailable', reason: 'no_rule_checks' },
        },
        mistakes: [],
      }),
    );
    expect(screen.getAllByText('No eligible Trades').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No comparable Trades')).toHaveLength(4);
    expect(screen.getByText('No evaluated Rule checks')).toBeVisible();
    expect(screen.getByText('No mistakes recorded')).toBeVisible();
    expect(screen.getByText('No eligible Trader equity points in this scope.')).toBeVisible();
    expect(screen.getByText('No eligible System equity points in this scope.')).toBeVisible();
  });
});
