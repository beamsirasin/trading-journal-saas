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
  equityCurve: {
    status: 'available',
    value: [
      { tradeId: 'a', occurredAt: '2026-08-01T10:00:00.000Z', cumulativeR: '1.0000' },
      { tradeId: 'b', occurredAt: '2026-08-02T10:00:00.000Z', cumulativeR: '-0.5000' },
      { tradeId: 'c', occurredAt: '2026-08-03T10:00:00.000Z', cumulativeR: '9.0000' },
    ],
  },
};

interface Overrides {
  readonly traderEmpty?: boolean;
  readonly netPnl?: NetPnlAvailability;
  readonly plannedRr?: Partial<DashboardPageData['basic']['plannedRr']>;
  readonly trader?: Partial<DashboardPerformanceData>;
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
      plannedRr: { average: available('3.2000'), tradeCount: 28, ...overrides.plannedRr },
      profitFactor: available('3.6400'),
      dayWinRate: {
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
      },
    },
    system: AXIS,
    trader: { ...AXIS, ...overrides.trader },
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
  'basic.total-r',
  'basic.trade-win-rate',
  'basic.avg-planned-rr',
  'basic.avg-r-per-trade',
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
    expect(widget(container, 'basic.avg-r-per-trade')).toHaveAttribute(
      'data-dashboard-mobile-span',
      '2',
    );
    expect(widget(container, 'basic.avg-r-per-trade').className).toContain('col-span-2');
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
    expect(within(widget(container, 'basic.total-r')).getByText('+9.00R')).toBeVisible();
    expect(within(widget(container, 'basic.trade-win-rate')).getByText('54.84%')).toBeVisible();
    expect(within(widget(container, 'basic.avg-planned-rr')).getByText('1 : 3.20')).toBeVisible();
    expect(within(widget(container, 'basic.avg-r-per-trade')).getByText('+0.29R')).toBeVisible();
  });

  /*
    COLOUR IS SPENT ON SIGNS, NOT ON LEVELS. Money, Total R and Avg R / Trade
    are signed outcomes and keep their direction; a win rate and a planned
    ratio are readings, and colouring them would make green mean nothing more
    specific than "a number".
  */
  it('colours the three signed outcomes and keeps the two levels neutral', () => {
    const { container } = renderRow();
    const netPnl = within(widget(container, 'basic.net-pnl')).getByText('+$1,243.50');
    expect(netPnl).toHaveClass('text-kpi-hero', 'text-positive');
    expect(within(widget(container, 'basic.total-r')).getByText('+9.00R')).toHaveClass(
      'text-kpi',
      'text-positive',
    );
    expect(within(widget(container, 'basic.avg-r-per-trade')).getByText('+0.29R')).toHaveClass(
      'text-kpi',
      'text-positive',
    );
    for (const [id, text] of [
      ['basic.trade-win-rate', '54.84%'],
      ['basic.avg-planned-rr', '1 : 3.20'],
    ] as const) {
      const value = within(widget(container, id)).getByText(text);
      expect(value).toHaveClass('text-kpi', 'text-foreground');
      expect(value).not.toHaveClass('text-positive');
      expect(value).not.toHaveClass('text-negative');
    }
  });

  it('renders negative R results with the negative tone', () => {
    const { container } = renderRow({
      trader: { totalR: available('-6.0000'), averageR: available('-0.2000') },
    });
    expect(within(widget(container, 'basic.total-r')).getByText('-6.00R')).toHaveClass(
      'text-negative',
    );
    expect(within(widget(container, 'basic.avg-r-per-trade')).getByText('-0.20R')).toHaveClass(
      'text-negative',
    );
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
    for (const removed of ['17W · 3BE · 11L', 'Calculated from R']) {
      expect(within(container).queryByText(removed)).toBeNull();
    }
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
    expect(indicatorFor('basic.total-r')).toHaveAttribute('data-kpi-indicator', 'cumulativeR');
    expect(indicatorFor('basic.trade-win-rate')).toHaveAttribute(
      'data-kpi-indicator',
      'outcomeSplit',
    );
    expect(indicatorFor('basic.avg-planned-rr')).toHaveAttribute(
      'data-kpi-indicator',
      'riskRewardSplit',
    );
    expect(indicatorFor('basic.avg-r-per-trade')).toHaveAttribute(
      'data-kpi-indicator',
      'divergingBar',
    );
  });

  it('draws each indicator from its own metric, not from a neighbour', () => {
    const { container } = renderRow();
    // 17 winning Trades of 31 -> 54.84 of the ring.
    const tradeArcs = widget(container, 'basic.trade-win-rate').querySelectorAll(
      'circle[data-kpi-arc]',
    );
    expect(tradeArcs).toHaveLength(3);
    expect(tradeArcs[0]?.getAttribute('stroke-dasharray')).toMatch(/^54\.83/);

    // The sparkline's last vertex is the highest cumulative total, so it sits
    // at the top of its box — the same +9.00R printed beside it.
    const spark = widget(container, 'basic.total-r').querySelector('[data-kpi-spark]');
    expect(spark?.getAttribute('points')?.split(' ').at(-1)).toBe('100,0');

    // A 1:3.20 plan is 1 / 4.20 of the track as risk.
    const risk = widget(container, 'basic.avg-planned-rr').querySelector(
      '[data-kpi-bar="plannedRisk"]',
    );
    expect((risk as HTMLElement | null)?.style.width).toBe('24%');
  });

  it('deflects the Avg R / Trade bar from the centre, in the direction of the sign', () => {
    const positive = renderRow({ trader: { averageR: available('0.5000') } });
    const gain = widget(positive.container, 'basic.avg-r-per-trade').querySelector(
      '[data-kpi-bar="averageGain"]',
    ) as HTMLElement | null;
    expect(gain?.style.width).toBe('25%');
    expect(gain?.className).toContain('left-1/2');
    positive.unmount();

    const negative = renderRow({ trader: { averageR: available('-0.5000') } });
    const loss = widget(negative.container, 'basic.avg-r-per-trade').querySelector(
      '[data-kpi-bar="averageLoss"]',
    ) as HTMLElement | null;
    expect(loss?.style.width).toBe('25%');
    expect(loss?.className).toContain('right-1/2');
    // The zero datum is drawn either way, because "no deflection" is only
    // readable against the line it failed to leave.
    expect(
      widget(negative.container, 'basic.avg-r-per-trade').querySelector(
        '[data-kpi-bar="zeroDatum"]',
      ),
    ).not.toBeNull();
  });

  it('shows only the zero datum for an exactly break-even average', () => {
    const { container } = renderRow({ trader: { averageR: available('0.0000') } });
    const card = widget(container, 'basic.avg-r-per-trade');
    expect(card.querySelector('[data-kpi-bar="averageGain"]')).toBeNull();
    expect(card.querySelector('[data-kpi-bar="averageLoss"]')).toBeNull();
    expect(card.querySelector('[data-kpi-bar="zeroDatum"]')).not.toBeNull();
    expect(within(card).getByText('0.00R')).toBeVisible();
  });

  it('names the two revealing indicators as actions and hides every drawing', () => {
    const { container } = renderRow();
    for (const name of ['Show Win Rate breakdown', 'Show Avg Planned RR detail']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('reveals the Win Rate composition in plain words on click, not on hover alone', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Show Win Rate breakdown' }));
    for (const text of ['Wins', '17', 'Break-even', '3', 'Losses', '11']) {
      await waitFor(() => {
        expect(screen.getByText(text)).toBeVisible();
      });
    }
  });

  /*
    Avg Planned RR is the one card whose denominator can be smaller than the
    row's — a Trade recorded without a planned target carries no ratio and is
    excluded rather than counted as zero — so the popover has to say so.
  */
  it('explains the planned ratio as a sentence and states what it averaged', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'Show Avg Planned RR detail' }));
    await waitFor(() => {
      expect(screen.getByText('For every 1R you risked, your Plans aimed at 3.20R.')).toBeVisible();
    });
    expect(screen.getByText('Averaged over 28 Trades that had a planned target.')).toBeVisible();
  });

  it('opens an indicator from the keyboard and closes it with Escape', async () => {
    const user = userEvent.setup();
    renderRow();
    const trigger = screen.getByRole('button', { name: 'Show Win Rate breakdown' });
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
      'no Trade carrying a planned target',
      {
        plannedRr: {
          average: { status: 'unavailable', reason: 'no_trades' } as AnalyticsMetric,
          tradeCount: 0,
        },
      },
      'basic.avg-planned-rr',
      'No Trades with a planned target',
      'no_planned_rr',
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

  /*
    A range holding Trades that were simply never planned must not be reported
    as a range holding no Trades — the four cards beside it are printing
    figures from those very Trades.
  */
  it('never reports an unplanned population as having no eligible Trades', () => {
    const { container } = renderRow({
      plannedRr: { average: { status: 'unavailable', reason: 'no_trades' }, tradeCount: 0 },
    });
    expect(container.textContent).not.toContain('No eligible Trades');
    expect(within(widget(container, 'basic.total-r')).getByText('+9.00R')).toBeVisible();
  });

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
    expect(terms.some((term) => term?.includes('Total R'))).toBe(true);
    expect(terms.some((term) => term?.includes('Win Rate'))).toBe(true);
    expect(terms.some((term) => term?.includes('Avg Planned RR'))).toBe(true);
    expect(terms.some((term) => term?.includes('Avg R / Trade'))).toBe(true);
    // The retired titles are gone from the band entirely.
    for (const retired of ['Trade Win %', 'Day Win %', 'Profit Factor', 'Avg Win / Loss']) {
      expect(container.textContent).not.toContain(retired);
    }
    expect(container.querySelectorAll('dd')).toHaveLength(5);
    expect(screen.getByRole('region', { name: 'Key trading figures' })).toBeInTheDocument();
  });

  it('opens a metric definition from the keyboard, not hover alone', async () => {
    const user = userEvent.setup();
    renderRow();
    const trigger = screen.getByRole('button', { name: 'About Avg Planned RR' });

    await user.tab();
    for (let guard = 0; guard < 12 && document.activeElement !== trigger; guard += 1) {
      await user.tab();
    }
    expect(trigger).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.getByText(/for every 1R of risk/i)).toBeVisible();
    });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByText(/for every 1R of risk/i)).toBeNull();
    });
  });

  it('gives every metric its own named definition affordance', async () => {
    const user = userEvent.setup();
    renderRow();
    for (const name of [
      'About Net P&L',
      'About Total R',
      'About Win Rate',
      'About Avg Planned RR',
      'About Avg R / Trade',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'About Total R' }));
    await waitFor(() => {
      expect(screen.getByText(/whatever your account size/i)).toBeVisible();
    });
  });

  /**
   * The PLAN axis and the ACTUAL axis are the product's central distinction,
   * and this row now carries both. Avg Planned RR must say, in the one place a
   * reader goes for a definition, that it comes from the plan made BEFORE
   * entry — otherwise it reads as a fourth result.
   */
  it('says outright that Avg Planned RR comes from the plan, not the result', async () => {
    const user = userEvent.setup();
    renderRow();
    await user.click(screen.getByRole('button', { name: 'About Avg Planned RR' }));
    await waitFor(() => {
      expect(screen.getByText(/before entering/i)).toBeVisible();
    });
    expect(screen.getByText(/without a planned target are left out/i)).toBeVisible();
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
    expect(within(tradeWin).getByText('อัตราชนะ')).toBeVisible();
    expect(screen.getByRole('button', { name: 'เกี่ยวกับ อัตราชนะ' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ดูรายละเอียดอัตราชนะ' }));
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
