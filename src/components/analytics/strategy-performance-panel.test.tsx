import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  DimensionAxisSummary,
  FrameworkPerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import type { AnalyticsStrategyOption } from '@/server/dal/analytics';

import en from '../../../messages/en.json';
import { StrategyPerformancePanel } from './strategy-performance-panel';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

function dimAxis(tradeCount: number, averageR: string): DimensionAxisSummary {
  return { tradeCount, averageR: available(averageR), winRate: available('0.6000') };
}

function renderPanel(
  performance: FrameworkPerformanceAnalyticsModel,
  options: readonly AnalyticsStrategyOption[] = [],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <StrategyPerformancePanel performance={performance} options={options} />
    </NextIntlClientProvider>,
  );
}

describe('StrategyPerformancePanel', () => {
  it('resolves the Strategy label from options and shows independent Trader/System summaries', () => {
    renderPanel(
      {
        strategies: [
          {
            strategyId: 'strategy-a',
            trader: dimAxis(24, '1.4800'),
            system: dimAxis(20, '2.1000'),
          },
        ],
        classifiedTraderCount: 24,
        unclassifiedTraderCount: 3,
        classifiedSystemCount: 20,
        unclassifiedSystemCount: 2,
      },
      [{ strategyId: 'strategy-a', label: 'Elliott Wave + RSI', isArchived: false }],
    );
    expect(screen.getByText('Elliott Wave + RSI')).toBeVisible();
    expect(screen.getByText('+1.48R')).toBeVisible();
    expect(screen.getByText('+2.10R')).toBeVisible();
    expect(screen.getAllByText('Trader').length).toBeGreaterThan(0);
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
  });

  it('discloses classified/unclassified coverage for both axes', () => {
    renderPanel({
      strategies: [],
      classifiedTraderCount: 24,
      unclassifiedTraderCount: 3,
      classifiedSystemCount: 20,
      unclassifiedSystemCount: 2,
    });
    expect(screen.getByText(/24 classified/)).toBeVisible();
    expect(screen.getByText(/3 unclassified/)).toBeVisible();
    expect(screen.getByText(/20 classified/)).toBeVisible();
    expect(screen.getByText(/2 unclassified/)).toBeVisible();
  });

  it('shows a calm empty state when no Strategy has been classified', () => {
    renderPanel({
      strategies: [],
      classifiedTraderCount: 0,
      unclassifiedTraderCount: 5,
      classifiedSystemCount: 0,
      unclassifiedSystemCount: 4,
    });
    expect(screen.getByText('No Strategy classification yet')).toBeVisible();
  });

  it('shows a note, not an error, when only one Strategy is present in the filtered sample', () => {
    renderPanel(
      {
        strategies: [
          { strategyId: 'strategy-a', trader: dimAxis(5, '1.0000'), system: dimAxis(4, '1.0000') },
        ],
        classifiedTraderCount: 5,
        unclassifiedTraderCount: 0,
        classifiedSystemCount: 4,
        unclassifiedSystemCount: 0,
      },
      [{ strategyId: 'strategy-a', label: 'Only Strategy', isArchived: false }],
    );
    expect(screen.getByText('Only one classified Strategy in this filtered sample.')).toBeVisible();
  });

  it('discloses an archived Strategy without hiding its historical performance', () => {
    renderPanel(
      {
        strategies: [
          { strategyId: 'strategy-a', trader: dimAxis(5, '1.0000'), system: dimAxis(4, '3.0000') },
        ],
        classifiedTraderCount: 5,
        unclassifiedTraderCount: 0,
        classifiedSystemCount: 4,
        unclassifiedSystemCount: 0,
      },
      [{ strategyId: 'strategy-a', label: 'Retired Strategy', isArchived: true }],
    );
    expect(screen.getByText('Retired Strategy')).toBeVisible();
    expect(screen.getByText('Archived')).toBeVisible();
    expect(screen.getByText('+1.00R')).toBeVisible();
    expect(screen.getByText('+3.00R')).toBeVisible();
  });
});
