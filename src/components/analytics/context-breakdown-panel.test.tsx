import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type {
  AnalyticsMetric,
  ContextBreakdownModel,
  DimensionAxisSummary,
} from '@/lib/analytics/metrics';

import en from '../../../messages/en.json';
import { ContextBreakdownPanel } from './context-breakdown-panel';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

function dimAxis(tradeCount: number, averageR: string): DimensionAxisSummary {
  return { tradeCount, averageR: available(averageR), winRate: available('0.5800') };
}

function renderPanel(breakdown: ContextBreakdownModel, formatValue?: (value: string) => string) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ContextBreakdownPanel
        title="By Symbol"
        breakdown={breakdown}
        emptyLabel="No data recorded for this dimension"
        {...(formatValue === undefined ? {} : { formatValue })}
      />
    </NextIntlClientProvider>,
  );
}

describe('ContextBreakdownPanel', () => {
  it('renders each group with Avg R, Win Rate, and Trade count', () => {
    renderPanel({
      groups: [
        { value: 'XAUUSD', trader: dimAxis(58, '1.2000') },
        { value: 'BTCUSD', trader: dimAxis(21, '0.4000') },
      ],
      recordedCount: 79,
      missingCount: 0,
    });
    expect(screen.getByText('XAUUSD')).toBeVisible();
    expect(screen.getByText('+1.20R')).toBeVisible();
    expect(screen.getByText('58 Trades')).toBeVisible();
    expect(screen.getByText('BTCUSD')).toBeVisible();
    expect(screen.getByText('+0.40R')).toBeVisible();
  });

  it('discloses missing coverage only when it exists', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ContextBreakdownPanel
          title="By Session"
          breakdown={{
            groups: [{ value: 'London', trader: dimAxis(40, '1.0000') }],
            recordedCount: 40,
            missingCount: 39,
          }}
          emptyLabel="No data recorded for this dimension"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/40 recorded/)).toBeVisible();
    expect(screen.getByText(/39 missing/)).toBeVisible();

    rerender(
      <NextIntlClientProvider locale="en" messages={en}>
        <ContextBreakdownPanel
          title="By Session"
          breakdown={{
            groups: [{ value: 'London', trader: dimAxis(40, '1.0000') }],
            recordedCount: 40,
            missingCount: 0,
          }}
          emptyLabel="No data recorded for this dimension"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(/missing/)).not.toBeInTheDocument();
  });

  it('formats a raw stored value via the provided formatter (e.g. Direction translation)', () => {
    renderPanel(
      {
        groups: [{ value: 'long', trader: dimAxis(50, '1.1000') }],
        recordedCount: 50,
        missingCount: 0,
      },
      (value) => (value === 'long' ? 'Long' : 'Short'),
    );
    expect(screen.getByText('Long')).toBeVisible();
    expect(screen.queryByText('long')).not.toBeInTheDocument();
  });

  it('shows a calm empty state and never fabricates a "best market" verdict', () => {
    renderPanel({ groups: [], recordedCount: 0, missingCount: 0 });
    expect(screen.getByText('No data recorded for this dimension')).toBeVisible();
    expect(screen.queryByText(/best market|best symbol/i)).not.toBeInTheDocument();
  });
});
