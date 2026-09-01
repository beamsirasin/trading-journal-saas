import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { NetPnlAvailability } from '@/lib/calc/net-pnl';
import type { DashboardPageData } from '@/lib/dashboard/page-data';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { TradesSummaryRow } from './trades-summary-row';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

interface Overrides {
  readonly traderEmpty?: boolean;
  readonly netPnl?: NetPnlAvailability;
  readonly traderTradeCount?: number;
}

function data(overrides: Overrides = {}): DashboardPageData {
  return {
    availability: {
      trader: overrides.traderEmpty === true ? 'empty' : 'available',
      system: 'available',
      comparison: 'available',
    },
    coverage: {
      traderTradeCount: overrides.traderTradeCount ?? 66,
      systemTradeCount: 66,
      pairedTradeCount: 60,
      monetaryResultCount: 66,
    },
    basic: {
      netPnl: overrides.netPnl ?? { status: 'available', currency: 'USD', totalMinor: '231000' },
      tradeWin: { rate: available('0.4091'), tradeCount: 66, wins: 27, breakEvens: 5, losses: 34 },
    },
    trader: { totalR: available('23.1000') },
  } as unknown as DashboardPageData;
}

function renderRow(overrides: Overrides = {}, locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <TradesSummaryRow data={data(overrides)} />
    </NextIntlClientProvider>,
  );
}

function card(container: HTMLElement, key: string): HTMLElement {
  const element = container.querySelector(`[data-trades-summary="${key}"]`);
  if (element === null) throw new Error(`missing summary card ${key}`);
  return element as HTMLElement;
}

describe('TradesSummaryRow', () => {
  it('renders exactly four cards, in order', () => {
    const { container } = renderRow();
    const keys = [...container.querySelectorAll('[data-trades-summary]')].map((node) =>
      node.getAttribute('data-trades-summary'),
    );
    expect(keys).toEqual(['tradeCount', 'netPnl', 'totalR', 'winRate']);
  });

  it('labels them in plain product language', () => {
    renderRow();
    for (const label of ['Trades', 'Net P&L', 'Total R', 'Win Rate']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('prints the canonical figures', () => {
    const { container } = renderRow();
    expect(card(container, 'tradeCount')).toHaveTextContent('66');
    expect(card(container, 'netPnl')).toHaveTextContent('+$2,310.00');
    expect(card(container, 'totalR')).toHaveTextContent('+23.10R');
    expect(card(container, 'winRate')).toHaveTextContent('40.91%');
  });

  it('is a 2 x 2 grid on a phone and one row from md up', () => {
    const { container } = renderRow();
    const grid = container.querySelector('dl');
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).toContain('md:grid-cols-4');
  });

  it('reads lighter than the Dashboard headline row', () => {
    // Same card language, ordinary figure size — the table below is the
    // content here, not this strip.
    const { container } = renderRow();
    const figure = card(container, 'totalR').querySelector('.text-metric');
    expect(figure).not.toBeNull();
    expect(card(container, 'totalR').querySelector('.text-kpi-hero')).toBeNull();
  });

  it('says there is nothing in scope rather than printing zeroes', () => {
    const { container } = renderRow({ traderEmpty: true, traderTradeCount: 0 });
    expect(card(container, 'netPnl')).toHaveTextContent('No Trades in scope');
    expect(card(container, 'totalR')).toHaveTextContent('No Trades in scope');
    expect(card(container, 'winRate')).toHaveTextContent('No Trades in scope');
    // A count of nothing is a truthful zero.
    expect(card(container, 'tradeCount')).toHaveTextContent('0');
  });

  it('names a monetary availability reason instead of a total', () => {
    const { container } = renderRow({
      netPnl: { status: 'unavailable', reason: 'mixed_currency' },
    });
    expect(card(container, 'netPnl')).toHaveAttribute('data-trades-summary-status', 'unavailable');
    expect(card(container, 'netPnl')).not.toHaveTextContent('$');
  });

  it('translates', () => {
    renderRow({}, 'th');
    expect(screen.getByText('อัตราชนะ')).toBeInTheDocument();
    expect(screen.getByText('R รวม')).toBeInTheDocument();
  });
});
