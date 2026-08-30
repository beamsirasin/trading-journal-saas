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
  payoffRatio: available('2.4000'),
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
    const netPnl = within(widget(container, 'basic.net-pnl')).getByText('+$1,243.50');
    expect(netPnl).toHaveClass('text-kpi-hero', 'text-positive');
    for (const [id, text] of [
      ['basic.trade-win-rate', '54.84%'],
      ['basic.profit-factor', '3.64'],
      ['basic.day-win-rate', '58.33%'],
      ['basic.avg-win-loss', '2.36x'],
    ] as const) {
      const value = within(widget(container, id)).getByText(text);
      expect(value).toHaveClass('text-kpi', 'text-foreground');
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

  it('prints no permanent breakdown or jargon under any figure but Net P&L', () => {
    const { container } = renderRow();
    // The four shorthand lines this pass removed, in the exact spelling they
    // used to carry.
    for (const removed of ['17W · 3BE · 11L', '7W · 1BE · 4L days', 'Calculated from R']) {
      expect(within(container).queryByText(removed)).toBeNull();
    }
    expect(container.textContent).not.toContain('+2.12R / -0.90R');
    // Net P&L keeps the one fact its figure cannot carry, and drops the
    // currency the account strip above already names.
    expect(within(widget(container, 'basic.net-pnl')).getByText('31 Trades')).toBeVisible();
    expect(widget(container, 'basic.net-pnl').textContent).not.toContain('USD');
  });

  it('gives four of the five cards a truthful indicator and Net P&L none', () => {
    const { container } = renderRow();
    const indicatorFor = (id: string) =>
      widget(container, id).querySelector('[data-kpi-indicator]');

    expect(indicatorFor('basic.net-pnl')).toBeNull();
    expect(indicatorFor('basic.trade-win-rate')).toHaveAttribute(
      'data-kpi-indicator',
      'outcomeSplit',
    );
    expect(indicatorFor('basic.profit-factor')).toHaveAttribute('data-kpi-indicator', 'ratioSplit');
    expect(indicatorFor('basic.day-win-rate')).toHaveAttribute(
      'data-kpi-indicator',
      'outcomeSplit',
    );
    expect(indicatorFor('basic.avg-win-loss')).toHaveAttribute(
      'data-kpi-indicator',
      'magnitudePair',
    );
  });

  it('draws each indicator from its own metric, not from a neighbour', () => {
    const { container } = renderRow();
    // A ring for Trades, a half arc for days: different shapes, and the day
    // arcs carry DAY counts (7/1/4), never the Trade counts (17/3/11).
    const tradeArcs = widget(container, 'basic.trade-win-rate').querySelectorAll(
      'circle[data-kpi-arc]',
    );
    const dayArcs = widget(container, 'basic.day-win-rate').querySelectorAll('path[data-kpi-arc]');
    expect(tradeArcs).toHaveLength(3);
    expect(dayArcs).toHaveLength(3);
    // 7 winning days of 12 -> 58.33 of the arc; 17 winning Trades of 31 ->
    // 54.84 of the ring. Same three signs, two different populations.
    expect(dayArcs[0]?.getAttribute('stroke-dasharray')).toMatch(/^58\.33/);
    expect(tradeArcs[0]?.getAttribute('stroke-dasharray')).toMatch(/^54\.83/);
  });

  it('names every indicator as an action and hides the drawing from assistive tech', () => {
    const { container } = renderRow();
    for (const name of [
      'Show Trade Win breakdown',
      'Show Profit Factor detail',
      'Show Day Win breakdown',
      'Show average win and loss',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it.each([
    ['Show Trade Win breakdown', ['Wins', '17', 'Break-even', '3', 'Losses', '11']],
    ['Show Day Win breakdown', ['Winning days', '7', 'Break-even days', '1', 'Losing days', '4']],
    ['Show average win and loss', ['Average win', '+2.12R', 'Average loss', '-0.90R']],
  ])('reveals %s in plain words on click, not on hover alone', async (name, expected) => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name }));
    for (const text of expected) {
      await waitFor(() => {
        expect(screen.getByText(text)).toBeVisible();
      });
    }
  });

  it('explains Profit Factor as a sentence rather than as a formula', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Show Profit Factor detail' }));
    await waitFor(() => {
      expect(
        screen.getByText('For every 1R lost, your winning Trades produced 3.64R.'),
      ).toBeVisible();
    });
  });

  it('opens an indicator from the keyboard and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderRow();
    const trigger = screen.getByRole('button', { name: 'Show Trade Win breakdown' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByText('Wins')).toBeVisible();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText('Wins')).toBeNull();
    });
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
      expect(screen.getByText(/for every 1R your losing Trades gave up/)).toBeVisible();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText(/for every 1R your losing Trades gave up/)).toBeNull();
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
      'About Avg Win / Loss',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'About Day Win %' }));
    await waitFor(() => {
      expect(screen.getByText(/Days follow your account's timezone/)).toBeVisible();
    });
  });

  it('explains every metric in everyday language, free of engine vocabulary', () => {
    // Read from the message file rather than the DOM: this is a claim about
    // the COPY, and every string here reaches a reader through one affordance
    // or another.
    const copy = Object.values(en.dashboard.basicKpi)
      .flatMap((entry) => (typeof entry === 'object' ? Object.values(entry) : [entry]))
      .filter((entry): entry is string => typeof entry === 'string')
      .join(' ')
      .toLowerCase();

    for (const jargon of [
      'eligible population',
      'eligible closed',
      'normalized',
      'gross',
      'canonical',
      'denominator',
      'absolute negative',
      'r-multiple',
      'population a',
    ]) {
      expect(copy).not.toContain(jargon);
    }
  });

  it('renders Thai copy for labels, definitions and revealed detail', async () => {
    const user = userEvent.setup();
    const { container } = renderRow({}, 'th');
    const tradeWin = widget(container, 'basic.trade-win-rate');
    expect(within(tradeWin).getByText('% เทรดที่ชนะ')).toBeVisible();
    expect(screen.getByRole('button', { name: 'เกี่ยวกับ % เทรดที่ชนะ' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ดูรายละเอียด % เทรดที่ชนะ' }));
    await waitFor(() => {
      expect(screen.getByText('ชนะ')).toBeVisible();
    });
    expect(screen.getByText('เสมอทุน')).toBeVisible();
    expect(screen.getByText('แพ้')).toBeVisible();
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
