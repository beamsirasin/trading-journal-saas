import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import type { NetPnlAvailability } from '@/lib/calc/net-pnl';
import type { DashboardPageData, DashboardPerformanceData } from '@/lib/dashboard/page-data';
import { DASHBOARD_WIDGET_IDS } from '@/lib/dashboard/widgets';

import en from '../../../../messages/en.json';
import th from '../../../../messages/th.json';
import { BasicKpiRow } from './basic-kpi-row';

const available = (value: string): AnalyticsMetric => ({ status: 'available', value });

const AXIS: DashboardPerformanceData = {
  sampleCount: 31,
  outcomeCounts: { wins: 17, breakEvens: 3, losses: 11 },
  totalR: available('9.0000'),
  winRate: available('0.5484'),
  averageR: available('0.2903'),
  expectancyR: available('0.2903'),
  profitFactor: available('3.6400'),
  maximumDrawdownR: available('2.0000'),
};

interface Overrides {
  readonly traderEmpty?: boolean;
  readonly netPnl?: NetPnlAvailability;
  readonly profitFactor?: AnalyticsMetric;
  readonly dayWinRate?: DashboardPageData['basic']['dayWinRate'];
  readonly averageWinLoss?: Partial<DashboardPageData['basic']['averageWinLoss']>;
}

function data(overrides: Overrides = {}): DashboardPageData {
  return {
    availability: {
      trader: overrides.traderEmpty === true ? 'empty' : 'available',
      system: 'available',
      comparison: 'available',
    },
    coverage: {
      traderTradeCount: 31,
      systemTradeCount: 31,
      pairedTradeCount: 31,
      monetaryResultCount: 31,
    },
    basic: {
      netPnl: overrides.netPnl ?? { status: 'available', currency: 'USD', totalMinor: '124350' },
      tradeWin: {
        rate: available('0.5484'),
        tradeCount: 31,
        wins: 17,
        breakEvens: 3,
        losses: 11,
      },
      profitFactor: overrides.profitFactor ?? available('3.6400'),
      dayWinRate: overrides.dayWinRate ?? {
        status: 'available',
        value: {
          eligibleDayCount: 12,
          winningDayCount: 7,
          breakEvenDayCount: 1,
          losingDayCount: 4,
          rate: '0.5833',
        },
      },
      averageWinLoss: {
        averageWinR: available('2.1200'),
        averageLossR: available('-0.9000'),
        payoffRatio: available('2.3556'),
        ...overrides.averageWinLoss,
      },
    },
    system: AXIS,
    trader: AXIS,
  } as unknown as DashboardPageData;
}

function renderRow(overrides: Overrides = {}, locale: 'en' | 'th' = 'en') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'th' ? th : en}>
      <BasicKpiRow data={data(overrides)} />
    </NextIntlClientProvider>,
  );
}

function widget(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector(`[data-dashboard-widget="${id}"]`);
  if (element === null) throw new Error(`missing widget ${id}`);
  return element as HTMLElement;
}

const BASIC_IDS = [
  'basic.net-pnl',
  'basic.trade-win-rate',
  'basic.profit-factor',
  'basic.day-win-rate',
  'basic.avg-win-loss',
] as const;

describe('BasicKpiRow', () => {
  it('renders all five registered Basic widget IDs exactly once', () => {
    const { container } = renderRow();
    for (const id of BASIC_IDS) {
      expect(container.querySelectorAll(`[data-dashboard-widget="${id}"]`)).toHaveLength(1);
      expect(DASHBOARD_WIDGET_IDS).toContain(id);
    }
    expect(container.querySelectorAll('[data-dashboard-widget]')).toHaveLength(5);
  });

  it('composes five equal desktop columns and a two-column mobile grid', () => {
    const { container } = renderRow();
    const grid = container.querySelector('dl');
    expect(grid?.className).toContain('lg:grid-cols-5');
    expect(grid?.className).toContain('grid-cols-2');

    for (const id of BASIC_IDS) {
      // Every card is one of the five desktop columns.
      expect(widget(container, id)).toHaveAttribute('data-dashboard-desktop-span', '1');
      expect(widget(container, id).className).toContain('lg:col-span-1');
    }

    // The fifth card fills the narrow grid so mobile never dangles a half row.
    expect(widget(container, 'basic.avg-win-loss')).toHaveAttribute(
      'data-dashboard-mobile-span',
      '2',
    );
    expect(widget(container, 'basic.avg-win-loss').className).toContain('col-span-2');
    expect(widget(container, 'basic.net-pnl')).toHaveAttribute('data-dashboard-mobile-span', '1');
  });

  it('orders the cards by the D2 default layout', () => {
    const { container } = renderRow();
    const ordered = [...container.querySelectorAll('[data-dashboard-widget]')].map((node) =>
      node.getAttribute('data-dashboard-widget'),
    );
    expect(ordered).toEqual([...BASIC_IDS]);
  });

  it('shows each metric in its native unit, ignoring the global unit mode', () => {
    const { container } = renderRow();
    expect(within(widget(container, 'basic.net-pnl')).getByText('+$1,243.50')).toBeVisible();
    expect(within(widget(container, 'basic.trade-win-rate')).getByText('54.84%')).toBeVisible();
    expect(within(widget(container, 'basic.profit-factor')).getByText('3.64')).toBeVisible();
    expect(within(widget(container, 'basic.day-win-rate')).getByText('58.33%')).toBeVisible();
    expect(within(widget(container, 'basic.avg-win-loss')).getByText('2.36x')).toBeVisible();
  });

  it('colours only Net P&L by sign and keeps the other four neutral', () => {
    const { container } = renderRow();
    expect(within(widget(container, 'basic.net-pnl')).getByText('+$1,243.50')).toHaveClass(
      'text-positive',
    );
    for (const [id, text] of [
      ['basic.trade-win-rate', '54.84%'],
      ['basic.profit-factor', '3.64'],
      ['basic.day-win-rate', '58.33%'],
      ['basic.avg-win-loss', '2.36x'],
    ] as const) {
      const value = within(widget(container, id)).getByText(text);
      expect(value).toHaveClass('text-foreground');
      expect(value).not.toHaveClass('text-positive');
      expect(value).not.toHaveClass('text-negative');
    }
  });

  it('renders a negative Net P&L with the negative tone and no partial fallback', () => {
    const { container } = renderRow({
      netPnl: { status: 'available', currency: 'USD', totalMinor: '-45000' },
    });
    expect(within(widget(container, 'basic.net-pnl')).getByText('-$450.00')).toHaveClass(
      'text-negative',
    );
  });

  it('keeps a zero Net P&L neutral', () => {
    const { container } = renderRow({
      netPnl: { status: 'available', currency: 'USD', totalMinor: '0' },
    });
    const value = within(widget(container, 'basic.net-pnl')).getByText('$0.00');
    expect(value).toHaveClass('text-foreground');
  });

  it('exposes the Trade Win and Day Win composition as secondary context', () => {
    const { container } = renderRow();
    expect(
      within(widget(container, 'basic.trade-win-rate')).getByText('17W · 3BE · 11L'),
    ).toBeVisible();
    expect(
      within(widget(container, 'basic.day-win-rate')).getByText('7W · 1BE · 4L days'),
    ).toBeVisible();
  });

  it('labels Profit Factor as R-derived and shows both payoff averages', () => {
    const { container } = renderRow();
    expect(
      within(widget(container, 'basic.profit-factor')).getByText('Calculated from R'),
    ).toBeVisible();
    expect(
      within(widget(container, 'basic.avg-win-loss')).getByText('+2.12R / -0.90R'),
    ).toBeVisible();
  });

  it.each([
    [
      'no losing Trades',
      { profitFactor: { status: 'unavailable', reason: 'no_losses' } as AnalyticsMetric },
      'basic.profit-factor',
      'No losing Trades',
      'no_losses',
    ],
    [
      'no eligible trading days',
      {
        dayWinRate: {
          status: 'unavailable',
          reason: 'no_trading_days',
        } as DashboardPageData['basic']['dayWinRate'],
      },
      'basic.day-win-rate',
      'No eligible trading days',
      'no_trading_days',
    ],
    [
      'incomplete monetary results',
      { netPnl: { status: 'unavailable', reason: 'incomplete' } as NetPnlAvailability },
      'basic.net-pnl',
      'Incomplete monetary results',
      'incomplete',
    ],
    [
      'mixed account currencies',
      { netPnl: { status: 'unavailable', reason: 'mixed_currency' } as NetPnlAvailability },
      'basic.net-pnl',
      'Mixed account currencies',
      'mixed_currency',
    ],
    [
      'an unsupported currency scale',
      {
        netPnl: {
          status: 'unavailable',
          reason: 'unsupported_currency_scale',
        } as NetPnlAvailability,
      },
      'basic.net-pnl',
      'Unsupported account currency',
      'unsupported_currency_scale',
    ],
  ])('states %s in words, not as a bare dash', (_name, overrides, id, copy, reason) => {
    const { container } = renderRow(overrides as Overrides);
    const card = widget(container, id as string);
    expect(within(card).getByText(copy as string)).toBeVisible();
    expect(card).toHaveAttribute('data-kpi-status', 'unavailable');
    expect(card).toHaveAttribute('data-kpi-reason', reason as string);
    expect(within(card).queryByText('—')).toBeNull();
  });

  it('never renders Infinity for a no-loss Profit Factor', () => {
    const { container } = renderRow({
      profitFactor: { status: 'unavailable', reason: 'no_losses' },
    });
    expect(container.textContent).not.toMatch(/Infinity|NaN/);
  });

  it.each([
    [
      'no wins',
      {
        averageWinR: { status: 'unavailable', reason: 'no_wins' } as AnalyticsMetric,
        payoffRatio: { status: 'unavailable', reason: 'no_wins' } as AnalyticsMetric,
      },
      'No winning Trades',
    ],
    [
      'no losses',
      {
        averageLossR: { status: 'unavailable', reason: 'no_losses' } as AnalyticsMetric,
        payoffRatio: { status: 'unavailable', reason: 'no_losses' } as AnalyticsMetric,
      },
      'No losing Trades',
    ],
  ])(
    'shows Avg Win/Loss as unavailable with %s rather than a misleading number',
    (_name, averageWinLoss, copy) => {
      const { container } = renderRow({ averageWinLoss });
      const card = widget(container, 'basic.avg-win-loss');
      expect(within(card).getByText(copy as string)).toBeVisible();
      expect(within(card).queryByText(/x$/)).toBeNull();
    },
  );

  it('distinguishes an empty population from an unavailable metric', () => {
    const { container } = renderRow({ traderEmpty: true, netPnl: { status: 'empty' } });
    for (const id of BASIC_IDS) {
      const card = widget(container, id);
      expect(card).toHaveAttribute('data-kpi-status', 'empty');
      expect(within(card).getByText('No Trades yet')).toBeVisible();
    }
    expect(container.textContent).not.toContain('No eligible Trades');
  });

  it('names every metric as a definition term so values are announced with them', () => {
    const { container } = renderRow();
    const terms = [...container.querySelectorAll('dt')].map((node) => node.textContent);
    expect(terms.some((term) => term?.includes('Net P&L'))).toBe(true);
    expect(terms.some((term) => term?.includes('Trade Win %'))).toBe(true);
    expect(terms.some((term) => term?.includes('Day Win %'))).toBe(true);
    expect(container.querySelectorAll('dd')).toHaveLength(5);
    expect(screen.getByRole('region', { name: 'Key trading figures' })).toBeInTheDocument();
  });

  it('opens a metric definition from the keyboard, not hover alone', async () => {
    const user = userEvent.setup();
    renderRow();
    const trigger = screen.getByRole('button', { name: 'About Profit Factor' });

    await user.tab();
    for (let guard = 0; guard < 10 && document.activeElement !== trigger; guard += 1) {
      await user.tab();
    }
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(
        screen.getByText(/Positive Actual R divided by absolute negative Actual R/),
      ).toBeVisible();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(
        screen.queryByText(/Positive Actual R divided by absolute negative Actual R/),
      ).toBeNull();
    });
  });

  it('gives every metric its own named definition affordance', async () => {
    const user = userEvent.setup();
    renderRow();
    for (const name of [
      'About Net P&L',
      'About Trade Win %',
      'About Profit Factor',
      'About Day Win %',
      'About Avg Win/Loss Trade',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'About Day Win %' }));
    await waitFor(() => {
      expect(screen.getByText(/trading account's configured timezone/)).toBeVisible();
    });
  });

  it('renders Thai copy for labels, context and definitions', () => {
    const { container } = renderRow({}, 'th');
    const tradeWin = widget(container, 'basic.trade-win-rate');
    expect(within(tradeWin).getByText('% เทรดที่ชนะ')).toBeVisible();
    expect(within(tradeWin).getByText('ชนะ 17 · เสมอ 3 · แพ้ 11')).toBeVisible();
    expect(screen.getByRole('button', { name: 'เกี่ยวกับ % เทรดที่ชนะ' })).toBeInTheDocument();
  });

  it('reads only the supplied payload — no card triggers a fetch of its own', () => {
    const fetchSpy = globalThis.fetch;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      throw new Error('Basic KPI widgets must not fetch analytics');
    }) as typeof fetch;
    try {
      renderRow();
    } finally {
      globalThis.fetch = fetchSpy;
    }
    expect(called).toBe(false);
  });
});
