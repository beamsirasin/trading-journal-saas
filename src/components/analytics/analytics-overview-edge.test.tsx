import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  DimensionAxisSummary,
  FrameworkPerformanceAnalyticsModel,
  SetupAdherenceAnalyticsModel,
  SetupPerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';
import type { AnalyticsSetupOption, AnalyticsStrategyOption } from '@/server/dal/analytics';

import en from '../../../messages/en.json';
import { EdgeZone } from './analytics-overview-edge';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable: AnalyticsMetric = { status: 'unavailable', reason: 'no_trades' };

function dimAxis(tradeCount: number, averageR: string | null): DimensionAxisSummary {
  return {
    tradeCount,
    averageR: averageR === null ? unavailable : available(averageR),
    winRate: unavailable,
  };
}

function adherence(
  overrides: Partial<SetupAdherenceAnalyticsModel> = {},
): SetupAdherenceAnalyticsModel {
  return {
    sampleCount: 20,
    averageAdherence: available('0.8200'),
    conditionsMetRate: available('0.9000'),
    buckets: [],
    ...overrides,
  };
}

const emptyStrategyPerformance: FrameworkPerformanceAnalyticsModel = {
  strategies: [],
  classifiedTraderCount: 0,
  unclassifiedTraderCount: 0,
  classifiedSystemCount: 0,
  unclassifiedSystemCount: 0,
};

const emptySetupPerformance: SetupPerformanceAnalyticsModel = {
  setups: [],
  classifiedTraderCount: 0,
  unclassifiedTraderCount: 0,
  classifiedSystemCount: 0,
  unclassifiedSystemCount: 0,
};

function renderZone(props: Partial<React.ComponentProps<typeof EdgeZone>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <EdgeZone
        setupAdherence={adherence()}
        strategyPerformance={emptyStrategyPerformance}
        setupPerformance={emptySetupPerformance}
        strategyOptions={[]}
        setupOptions={[]}
        exploreHref="/app/analytics?view=edge&range=90d"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe('EdgeZone', () => {
  it('leads with Setup Adherence as the hero, with its existing factual sample support', () => {
    renderZone();
    expect(screen.getByText('82.00%')).toBeVisible();
    expect(screen.getByText('Average Setup Adherence')).toBeVisible();
    expect(screen.getByText('20 Trades with recorded, applicable Setup Conditions')).toBeVisible();
  });

  it('shows a calm empty state when no Setup Checklist data was recorded at entry', () => {
    renderZone({
      setupAdherence: adherence({
        sampleCount: 0,
        averageAdherence: { status: 'unavailable', reason: 'no_conditions_applicable' },
      }),
    });
    expect(screen.getByText('No Setup Checklist data recorded at entry')).toBeVisible();
  });

  it('links Explore to the Edge URL view while preserving filters', () => {
    renderZone();
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/en/app/analytics?view=edge&range=90d',
    );
  });

  it('shows the best observed Strategy with its label, resolved from filter options, and an Archived badge where applicable', () => {
    const strategyPerformance: FrameworkPerformanceAnalyticsModel = {
      strategies: [
        { strategyId: 'strategy-a', trader: dimAxis(24, '1.4800'), system: dimAxis(20, '2.1000') },
      ],
      classifiedTraderCount: 24,
      unclassifiedTraderCount: 3,
      classifiedSystemCount: 20,
      unclassifiedSystemCount: 2,
    };
    const strategyOptions: readonly AnalyticsStrategyOption[] = [
      { strategyId: 'strategy-a', label: 'Elliott Wave + RSI', isArchived: true },
    ];
    renderZone({ strategyPerformance, strategyOptions });
    expect(screen.getByText('Best observed Strategy')).toBeVisible();
    expect(screen.getByText('Elliott Wave + RSI')).toBeVisible();
    expect(screen.getByText('+1.48R Avg')).toBeVisible();
    expect(screen.getByText('24 Trades')).toBeVisible();
    expect(screen.getByText('Archived')).toBeVisible();
  });

  it('shows a calm "no classification yet" state when no Strategy has Trader data', () => {
    renderZone();
    expect(screen.getByText('No Strategy classification yet')).toBeVisible();
    expect(screen.queryByText('Best observed Strategy')).not.toBeInTheDocument();
  });

  it('shows the best observed Setup with its label', () => {
    const setupPerformance: SetupPerformanceAnalyticsModel = {
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
    };
    const setupOptions: readonly AnalyticsSetupOption[] = [
      {
        setupId: 'setup-a',
        strategyId: 'strategy-a',
        label: 'Wave 3 Continuation',
        isArchived: false,
      },
    ];
    renderZone({ setupPerformance, setupOptions });
    expect(screen.getByText('Best observed Setup')).toBeVisible();
    expect(screen.getByText('Wave 3 Continuation')).toBeVisible();
    expect(screen.getByText('+1.92R Avg')).toBeVisible();
    expect(screen.getByText('18 Trades')).toBeVisible();
  });

  it('never invents a Strategy/Setup ranking placeholder such as "Coming soon"', () => {
    renderZone();
    expect(screen.queryByText(/Coming soon/i)).not.toBeInTheDocument();
  });

  it('never claims a System-only Strategy (zero Trader Trades) is the "best observed"', () => {
    const strategyPerformance: FrameworkPerformanceAnalyticsModel = {
      strategies: [
        {
          strategyId: 'strategy-system-only',
          trader: dimAxis(0, null),
          system: dimAxis(4, '1.0000'),
        },
      ],
      classifiedTraderCount: 0,
      unclassifiedTraderCount: 0,
      classifiedSystemCount: 4,
      unclassifiedSystemCount: 0,
    };
    renderZone({ strategyPerformance });
    expect(screen.getByText('No Strategy classification yet')).toBeVisible();
  });
});
