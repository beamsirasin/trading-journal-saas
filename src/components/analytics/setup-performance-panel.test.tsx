import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  DimensionAxisSummary,
  SetupPerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import type { AnalyticsSetupOption, AnalyticsStrategyOption } from '@/server/dal/analytics';

import en from '../../../messages/en.json';
import { SetupPerformancePanel } from './setup-performance-panel';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

function dimAxis(tradeCount: number, averageR: string): DimensionAxisSummary {
  return { tradeCount, averageR: available(averageR), winRate: available('0.6700') };
}

function renderPanel(
  performance: SetupPerformanceAnalyticsModel,
  setupOptions: readonly AnalyticsSetupOption[] = [],
  strategyOptions: readonly AnalyticsStrategyOption[] = [],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <SetupPerformancePanel
        performance={performance}
        setupOptions={setupOptions}
        strategyOptions={strategyOptions}
      />
    </NextIntlClientProvider>,
  );
}

describe('SetupPerformancePanel', () => {
  it('resolves the Setup label and shows its owning Strategy as a breadcrumb', () => {
    renderPanel(
      {
        setups: [
          {
            setupId: 'setup-a',
            strategyId: 'strategy-a',
            trader: dimAxis(18, '1.9200'),
            system: dimAxis(15, '2.4000'),
          },
        ],
        classifiedTraderCount: 18,
        unclassifiedTraderCount: 9,
        classifiedSystemCount: 15,
        unclassifiedSystemCount: 7,
      },
      [
        {
          setupId: 'setup-a',
          strategyId: 'strategy-a',
          label: 'Wave 3 Continuation',
          isArchived: false,
        },
      ],
      [{ strategyId: 'strategy-a', label: 'Elliott Wave + RSI', isArchived: false }],
    );
    expect(screen.getByText('Wave 3 Continuation')).toBeVisible();
    expect(screen.getByText('Elliott Wave + RSI')).toBeVisible();
    expect(screen.getByText('+1.92R')).toBeVisible();
  });

  it('discloses classified/unclassified Setup coverage for both axes', () => {
    renderPanel({
      setups: [],
      classifiedTraderCount: 18,
      unclassifiedTraderCount: 9,
      classifiedSystemCount: 15,
      unclassifiedSystemCount: 7,
    });
    expect(screen.getByText(/18 classified/)).toBeVisible();
    expect(screen.getByText(/9 unclassified/)).toBeVisible();
  });

  it('shows a calm "No Setup data" empty state', () => {
    renderPanel({
      setups: [],
      classifiedTraderCount: 0,
      unclassifiedTraderCount: 5,
      classifiedSystemCount: 0,
      unclassifiedSystemCount: 4,
    });
    expect(screen.getByText('No Setup data')).toBeVisible();
  });
});
