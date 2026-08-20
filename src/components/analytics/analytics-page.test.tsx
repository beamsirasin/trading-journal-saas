import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsMetric,
  AnalyticsSnapshot,
  DimensionAxisSummary,
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
    systemPendingCount: 0,
    trader: axis(3, '-1.0000'),
    comparison: {
      comparableCount: 2,
      pairedSystemTotalR: available('3.0000'),
      pairedActualTotalR: available('-1.0000'),
      executionGapR: available('-4.0000'),
      averageExecutionGapR: available('-2.0000'),
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
    setupAdherence: {
      sampleCount: 2,
      averageAdherence: available('0.7000'),
      conditionsMetRate: available('0.8333'),
      buckets: [
        { bucket: '0-24', trader: emptyDimAxis(), system: emptyDimAxis() },
        { bucket: '25-49', trader: emptyDimAxis(), system: emptyDimAxis() },
        { bucket: '50-74', trader: dimAxis(1, '1.0000', '1.0000'), system: emptyDimAxis() },
        { bucket: '75-99', trader: emptyDimAxis(), system: emptyDimAxis() },
        {
          bucket: '100',
          trader: dimAxis(1, '2.0000', '1.0000'),
          system: dimAxis(3, '5.0000', '0.6667'),
        },
      ],
    },
    conditions: [
      {
        setupId: 'setup-a',
        conditionKey: 'condition-a',
        label: 'Above the 200 EMA',
        trader: {
          met: dimAxis(2, '2.0000', '1.0000'),
          notMet: dimAxis(1, '-1.0000', '0.0000'),
        },
        system: { met: dimAxis(4, '6.0000', '0.7500'), notMet: emptyDimAxis() },
      },
    ],
    confidence: {
      sampleCount: 2,
      averageConfidence: available('0.6250'),
      levels: [0, 25, 50, 75, 100].map((level) => ({
        level: level as 0 | 25 | 50 | 75 | 100,
        trader: level === 75 ? dimAxis(2, '1.5000', '0.5000') : emptyDimAxis(),
        system: level === 75 ? dimAxis(5, '2.2500', '0.8000') : emptyDimAxis(),
      })),
    },
    emotions: [
      {
        key: 'fearful',
        label: 'Fearful',
        trader: dimAxis(2, '-1.0000', '0.0000'),
        system: dimAxis(3, '4.0000', '1.0000'),
      },
    ],
    ...overrides,
  };
}

function dimAxis(tradeCount: number, averageR: string, winRate: string): DimensionAxisSummary {
  return { tradeCount, averageR: available(averageR), winRate: available(winRate) };
}

function emptyDimAxis(): DimensionAxisSummary {
  return { tradeCount: 0, averageR: unavailableNoTrades(), winRate: unavailableNoTrades() };
}

function unavailableNoTrades(): AnalyticsMetric {
  return { status: 'unavailable', reason: 'no_trades' };
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
    expect(within(comparison).getByText('-2.00R')).toBeVisible();
    expect(within(comparison).getByText('-4.00R')).toBeVisible();
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

  it('shows Average Setup Adherence distinct from Conditions Met Rate, and independent per-bucket Trader/System performance', () => {
    renderPage();
    const panel = document.querySelector('[data-analytics-panel="setup-adherence"]') as HTMLElement;
    expect(within(panel).getByText('Average Setup Adherence')).toBeVisible();
    expect(within(panel).getByText('70.00%')).toBeVisible();
    expect(within(panel).getByText('Conditions Met Rate')).toBeVisible();
    expect(within(panel).getByText('83.33%')).toBeVisible();
    expect(within(panel).getByText('100%')).toBeVisible();
    // The '100' bucket: Trader shows 1 Trade/+2.00R, System independently shows 3 Trades/+5.00R.
    expect(within(panel).getAllByText('Trader').length).toBeGreaterThan(0);
    expect(within(panel).getAllByText('System').length).toBeGreaterThan(0);
    expect(within(panel).getByText('+2.00R')).toBeVisible();
    expect(within(panel).getByText('+5.00R')).toBeVisible();
    expect(within(panel).getByText('3 Trades')).toBeVisible();
  });

  it('shows Condition performance grouped by Met vs Not Met with independent Trader/System sample counts', () => {
    renderPage();
    const panel = document.querySelector('[data-analytics-panel="conditions"]') as HTMLElement;
    expect(within(panel).getByText('Above the 200 EMA')).toBeVisible();
    expect(within(panel).getByText('Met')).toBeVisible();
    expect(within(panel).getByText('Not Met')).toBeVisible();
    // Trader met = 2 Trades/+2.00R; System met = 4 Trades/+6.00R — independent counts and values.
    expect(within(panel).getByText('2 Trades')).toBeVisible();
    expect(within(panel).getByText('4 Trades')).toBeVisible();
    expect(within(panel).getByText('+2.00R')).toBeVisible();
    expect(within(panel).getByText('+6.00R')).toBeVisible();
  });

  it('shows Average Confidence and independent per-level Trader/System performance, never converting NULL to 0', () => {
    renderPage();
    const panel = document.querySelector('[data-analytics-panel="confidence"]') as HTMLElement;
    expect(within(panel).getByText('Average Confidence')).toBeVisible();
    expect(within(panel).getByText('62.50%')).toBeVisible();
    expect(within(panel).getByText('75%')).toBeVisible();
    // Level 75: Trader 2 Trades/+1.50R, System 5 Trades/+2.25R — independent samples.
    expect(within(panel).getByText('2 Trades')).toBeVisible();
    expect(within(panel).getByText('5 Trades')).toBeVisible();
    expect(within(panel).getByText('+1.50R')).toBeVisible();
    expect(within(panel).getByText('+2.25R')).toBeVisible();
  });

  it('shows Emotion groups with independent per-group Trader/System sample sizes, never a fake shared total', () => {
    renderPage();
    const panel = document.querySelector('[data-analytics-panel="emotions"]') as HTMLElement;
    expect(within(panel).getByText('Fearful')).toBeVisible();
    // Trader 2 Trades/-1.00R, System 3 Trades/+4.00R — different Trades, different values.
    expect(within(panel).getByText('2 Trades')).toBeVisible();
    expect(within(panel).getByText('3 Trades')).toBeVisible();
    expect(within(panel).getByText('-1.00R')).toBeVisible();
    expect(within(panel).getByText('+4.00R')).toBeVisible();
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
          executionGapR: { status: 'unavailable', reason: 'no_comparable_trades' },
          averageExecutionGapR: { status: 'unavailable', reason: 'no_comparable_trades' },
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
        setupAdherence: {
          sampleCount: 0,
          averageAdherence: { status: 'unavailable', reason: 'no_conditions_applicable' },
          conditionsMetRate: { status: 'unavailable', reason: 'no_conditions_applicable' },
          buckets: [],
        },
        conditions: [],
        confidence: {
          sampleCount: 0,
          averageConfidence: { status: 'unavailable', reason: 'no_confidence_recorded' },
          levels: [],
        },
        emotions: [],
      }),
    );
    expect(screen.getAllByText('No eligible Trades').length).toBeGreaterThan(0);
    expect(screen.getAllByText('No comparable Trades')).toHaveLength(5);
    expect(screen.getByText('No evaluated Rule checks')).toBeVisible();
    expect(screen.getByText('No mistakes recorded')).toBeVisible();
    expect(screen.getByText('No eligible Trader equity points in this scope.')).toBeVisible();
    expect(screen.getByText('No eligible System equity points in this scope.')).toBeVisible();
    expect(
      screen.getAllByText('No Trades with applicable Setup Conditions').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('No Setup Condition snapshots in this scope')).toBeVisible();
    expect(screen.getByText('No Trades with recorded Confidence')).toBeVisible();
    expect(screen.getByText('No Emotions recorded')).toBeVisible();
    // Never a fake 0% for an empty/unrecorded population.
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
  });
});
