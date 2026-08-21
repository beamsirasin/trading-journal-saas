import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type {
  AnalyticsMetric,
  ComparisonAnalyticsModel,
  PerformanceAnalyticsModel,
} from '@/lib/analytics/metrics';

import en from '../../../messages/en.json';
import { ResultsZone } from './analytics-overview-results';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });
const unavailable: AnalyticsMetric = { status: 'unavailable', reason: 'no_trades' };

function axis(overrides: Partial<PerformanceAnalyticsModel> = {}): PerformanceAnalyticsModel {
  return {
    sampleCount: 3,
    totalR: available('12.4000'),
    winRate: available('0.5800'),
    averageR: available('4.1333'),
    expectancyR: available('4.1333'),
    profitFactor: available('5.0000'),
    maximumDrawdownR: available('1.2500'),
    averageWinR: available('2.5000'),
    averageLossR: available('-1.0000'),
    payoffRatio: available('2.5000'),
    equityCurve: { status: 'available', value: [] },
    ...overrides,
  };
}

function comparison(overrides: Partial<ComparisonAnalyticsModel> = {}): ComparisonAnalyticsModel {
  return {
    comparableCount: 0,
    pairedSystemTotalR: unavailable,
    pairedActualTotalR: unavailable,
    executionGapR: unavailable,
    averageExecutionGapR: unavailable,
    executionEfficiency: unavailable,
    ...overrides,
  };
}

function renderZone(props: Partial<React.ComponentProps<typeof ResultsZone>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ResultsZone
        trader={axis()}
        system={axis({ totalR: available('26.8000'), winRate: available('0.6700') })}
        systemPendingCount={0}
        comparison={comparison()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe('ResultsZone', () => {
  it('leads with Trader and System Total R as the two hero answers', () => {
    renderZone();
    expect(screen.getByText('+12.40R')).toBeVisible();
    expect(screen.getByText('+26.80R')).toBeVisible();
    expect(screen.getByText('58.00% Win Rate')).toBeVisible();
    expect(screen.getByText('67.00% Win Rate')).toBeVisible();
  });

  it('does not show every Performance metric on Overview — Profit Factor/Drawdown stay in Explore', () => {
    renderZone();
    expect(screen.queryByText('Profit Factor')).not.toBeInTheDocument();
    expect(screen.queryByText('Maximum Drawdown R')).not.toBeInTheDocument();
  });

  it('shows a calm empty state for Trader with zero finalized Trades, not an error', () => {
    renderZone({ trader: axis({ sampleCount: 0, totalR: unavailable }) });
    expect(screen.getByText('No completed Trades yet')).toBeVisible();
  });

  it('shows a calm empty state for System with zero resolved outcomes and none pending', () => {
    renderZone({ system: axis({ sampleCount: 0, totalR: unavailable }), systemPendingCount: 0 });
    expect(screen.getByText('No System Outcomes resolved yet')).toBeVisible();
  });

  it('surfaces a pending System readiness action, never implying it belongs to the selected period', () => {
    renderZone({ systemPendingCount: 5 });
    expect(screen.getByText('5 pending System outcomes')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review pending' })).toHaveAttribute(
      'href',
      '/app/trades',
    );
    expect(screen.queryByText(/pending this.*period/i)).not.toBeInTheDocument();
  });

  it('shows the paired-only comparison insight when a truthful paired sample exists', () => {
    renderZone({
      comparison: comparison({ comparableCount: 8, averageExecutionGapR: available('-0.5000') }),
    });
    expect(
      screen.getByText('Your actual execution has captured less than the System on paired Trades.'),
    ).toBeVisible();
    expect(screen.getByText('8 comparable Trades')).toBeVisible();
  });

  it('never fabricates a comparison insight from unrelated global totals when no paired sample exists', () => {
    renderZone({ comparison: comparison({ comparableCount: 0 }) });
    expect(screen.getByText('Trader and System results are tracked independently.')).toBeVisible();
    expect(screen.queryByText(/captured less than the System/)).not.toBeInTheDocument();
  });

  it('links Explore to the existing detailed Performance section, not a new route', () => {
    renderZone();
    const link = screen.getByRole('link', { name: 'Explore' });
    expect(link).toHaveAttribute('href', '#analytics-performance-heading');
  });
});
