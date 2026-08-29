import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardPageData, DashboardPerformanceData } from '@/lib/dashboard/page-data';

import en from '../../../messages/en.json';
import { DashboardSkeleton, RealDashboard, type DashboardRecentTrade } from './real-dashboard';

vi.mock('@/i18n/navigation', () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) => `/${locale}${href}`,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const available = (value: string) => ({ status: 'available' as const, value });
const unavailable = (
  reason: 'no_trades' | 'no_losses' | 'no_comparable_trades' | 'system_has_no_edge',
) => ({
  status: 'unavailable' as const,
  reason,
});

function axis(
  sampleCount: number,
  overrides: Partial<
    Pick<DashboardPerformanceData, 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'>
  > = {},
): DashboardPerformanceData {
  return {
    sampleCount,
    outcomeCounts: { wins: sampleCount, breakEvens: 0, losses: 0 },
    totalR: available('4.0000'),
    averageR: available('1.3333'),
    expectancyR: available('1.3333'),
    winRate: available('0.6667'),
    profitFactor: available('5.0000'),
    maximumDrawdownR: available('1.0000'),
    ...overrides,
  };
}

function overview(overrides: Partial<DashboardPageData> = {}): DashboardPageData {
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
    filters: {
      datePreset: '90d',
      customDateRange: null,
      accountScope: { kind: 'active' },
      strategyId: null,
      setupId: null,
      strategyVersionId: null,
      unitMode: 'r',
      dimensions: {
        symbol: null,
        side: null,
        session: null,
        timeframe: null,
        ruleAdherence: null,
        mistake: null,
        emotion: null,
      },
    },
    account: { kind: 'account', source: 'active', account: ACCOUNT },
    availability: { trader: 'available', system: 'available', comparison: 'available' },
    coverage: {
      traderTradeCount: 5,
      systemTradeCount: 3,
      pairedTradeCount: 2,
      monetaryResultCount: 5,
    },
    basic: {
      netPnl: { status: 'available', currency: 'USD', totalMinor: '1000' },
      tradeWin: {
        rate: available('0.6000'),
        tradeCount: 5,
        wins: 3,
        breakEvens: 0,
        losses: 2,
      },
      profitFactor: available('5.0000'),
      dayWinRate: {
        status: 'available',
        value: {
          eligibleDayCount: 3,
          winningDayCount: 2,
          breakEvenDayCount: 0,
          losingDayCount: 1,
          rate: '0.6667',
        },
      },
      averageWinLoss: {
        averageWinR: available('2.0000'),
        averageLossR: available('-1.0000'),
        payoffRatio: available('2.0000'),
      },
    },
    system: axis(3),
    trader: axis(5, { totalR: available('-1.0000') }),
    comparison: comparisonFixture({
      comparableCount: 2,
      pairedSystemTotalR: available('3.0000'),
      pairedActualTotalR: available('1.0000'),
      executionGapR: available('-2.0000'),
      averageExecutionGapR: available('-1.0000'),
      systemEdgeCaptured: available('0.3333'),
    }),
    attention: { scope: 'workspace_operational', counts: ATTENTION },
    recentTrades: { scope: 'dashboard_filters', dateAxis: 'occurred_at', items: [RECENT] },
    ...overrides,
  };
}

const ACCOUNT = {
  id: 'account-a',
  name: 'Primary Execution Account',
  accountMode: 'live' as const,
  baseCurrency: 'USD',
  startingBalance: '10000',
};

const RECENT: DashboardRecentTrade = {
  tradeId: 'trade-1',
  occurredAt: '2026-08-08T10:00:00.000Z',
  symbol: 'XAUUSD',
  direction: 'long',
  tradingAccountName: ACCOUNT.name,
  strategyName: 'Pinned Breakout v1',
  setupName: 'Pinned London Retest',
  status: 'closed',
  systemStatus: 'resolved',
  actualR: '-1.0000',
  systemR: '3.0000',
  executionGapR: { status: 'available', value: '-4.0000' },
};

type ComparisonSummary = DashboardPageData['comparison']['summary'];

/**
 * D5A wraps the frozen D2 summary in a status-carrying object that also holds
 * the paired series. These helpers keep every existing case expressed in
 * terms of the summary it actually asserts on — the series themselves are
 * covered in `execution-comparison.test.ts`, and this file has no business
 * restating them.
 */
const comparisonFixture = (summary: ComparisonSummary): DashboardPageData['comparison'] => ({
  status: 'available',
  summary,
  tradeSeries: [],
  dailySeries: [],
  distribution: {
    underperformedCount: 0,
    matchedCount: 0,
    outperformedCount: 0,
    minimumExecutionGapR: unavailable('no_comparable_trades'),
    maximumExecutionGapR: unavailable('no_comparable_trades'),
  },
});

const emptyComparisonFixture = (summary: ComparisonSummary): DashboardPageData['comparison'] => ({
  status: 'empty',
  reason: 'no_comparable_trades',
  summary,
});

const withSummary = (
  comparison: DashboardPageData['comparison'],
  overrides: Partial<ComparisonSummary>,
): DashboardPageData['comparison'] => ({
  ...comparison,
  summary: { ...comparison.summary, ...overrides },
});

const ATTENTION = {
  openTrades: 0,
  pendingSystemOutcomes: 0,
  unclassifiedTrades: 0,
  reviewsPending: 0,
  needsExecutionDetails: 0,
};

function renderDashboard(
  model = overview(),
  recentTrades: readonly DashboardRecentTrade[] = [RECENT],
  attention = ATTENTION,
  // The Calendar is its own async server boundary (D6B); these tests cover the
  // page composition around it, so the slot is stubbed rather than rendered.
  calendarSlot: ReactNode = <div data-testid="calendar-slot" />,
  // D7B's Risk Performance section is its own async server boundary too.
  riskSlot: ReactNode = <div data-testid="risk-slot" />,
  // D8B's insight pillars are their own async server boundary as well.
  insightSlot: ReactNode = <div data-testid="insight-slot" />,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RealDashboard
        data={{
          ...model,
          attention: { scope: 'workspace_operational', counts: attention },
          recentTrades: { ...model.recentTrades, items: recentTrades },
        }}
        dateLocale="en-GB"
        calendarSlot={calendarSlot}
        insightSlot={insightSlot}
        riskSlot={riskSlot}
      />
    </NextIntlClientProvider>,
  );
}

describe('RealDashboard', () => {
  it('renders System and Trader as distinct, independently counted panels', () => {
    const { container } = renderDashboard();
    const system = container.querySelector('[data-dashboard-panel="system"]');
    const trader = container.querySelector('[data-dashboard-panel="trader"]');
    expect(system).not.toBeNull();
    expect(trader).not.toBeNull();
    expect(
      within(system as HTMLElement).getByRole('heading', { name: 'System Performance' }),
    ).toBeVisible();
    expect(
      within(trader as HTMLElement).getByRole('heading', { name: 'Trader Performance' }),
    ).toBeVisible();
    // D4 shows each side's Trade count as its own supporting metric. The two
    // counts differ because Population B and Population A are independent.
    expect(
      within(system as HTMLElement).getByText('3', {
        selector: '[data-performance-metric="sampleCount"] span',
      }),
    ).toBeVisible();
    expect(
      within(trader as HTMLElement).getByText('5', {
        selector: '[data-performance-metric="sampleCount"] span',
      }),
    ).toBeVisible();
    expect(within(system as HTMLElement).getByText('+4.00R')).toBeVisible();
    expect(within(trader as HTMLElement).getByText('-1.00R')).toBeVisible();
  });

  it('shows Trader metrics while System is empty', () => {
    const emptySystem = axis(0, {
      totalR: unavailable('no_trades'),
      expectancyR: unavailable('no_trades'),
      winRate: unavailable('no_trades'),
      profitFactor: unavailable('no_trades'),
    });
    const { container } = renderDashboard(overview({ system: emptySystem }));
    const system = container.querySelector('[data-dashboard-panel="system"]') as HTMLElement;
    const trader = container.querySelector('[data-dashboard-panel="trader"]') as HTMLElement;
    // One empty notice plus the truthful zero count, not four repetitions of
    // the same fact — and the populated side is untouched by it.
    expect(within(system).getByText(/No eligible System Trades/i)).toBeVisible();
    expect(within(system).queryAllByText('No eligible Trades')).toHaveLength(0);
    expect(system).toHaveAttribute('data-performance-status', 'empty');
    expect(trader).toHaveAttribute('data-performance-status', 'available');
    expect(within(trader).getByText('-1.00R')).toBeVisible();
  });

  /**
   * D4.5 §5. The page used to separate every boundary with the same 32px
   * gap, whatever it separated. These margins are the explicit rhythm that
   * replaced it — asserted as classes because the jsdom renderer has no
   * layout, and pinned here so a later edit cannot quietly restore the
   * uniform spacing that made the Dashboard read as a landing page.
   */
  it('steps the section rhythm up with the weight of each boundary', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      ...ATTENTION,
      openTrades: 2,
    });
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('gap-8');

    const kpiRow = screen.getByRole('region', { name: 'Key trading figures' });
    const attention = container.querySelector(
      '[data-dashboard-widget="review.needs-attention"]',
    ) as HTMLElement;
    const performance = container
      .querySelector('[data-dashboard-panel="system"]')
      ?.closest('section') as HTMLElement;

    expect(kpiRow.className).toContain('mt-5');
    // Absent an account context bar the KPI band is first and takes no margin.
    expect(kpiRow.className).toContain('first:mt-0');
    expect(attention.className).toContain('mt-6');
    expect(performance.className).toContain('mt-7');
  });

  it('compresses Needs Attention into one bar rather than a header-and-grid card', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      ...ATTENTION,
      openTrades: 2,
      unclassifiedTrades: 1,
    });
    const panel = container.querySelector(
      '[data-dashboard-panel="needs-attention"]',
    ) as HTMLElement;
    // One row on desktop, stacked below it — never the old four-column grid.
    expect(panel.className).toContain('lg:flex-row');
    expect(panel.className).not.toContain('lg:grid-cols-4');
    // Nothing was traded away for the height: title, meaning, every non-zero
    // count with its label, and the Review action are all still here.
    expect(within(panel).getByText('Needs attention')).toBeVisible();
    expect(within(panel).getByText(/not a task list/i)).toBeVisible();
    expect(within(panel).getByText('Open Trades')).toBeVisible();
    expect(within(panel).getByText('2')).toBeVisible();
    expect(within(panel).getByText('Unclassified Trades')).toBeVisible();
    expect(within(panel).getByText('1')).toBeVisible();
    expect(within(panel).getByRole('link', { name: /Review/ })).toBeVisible();
  });

  /**
   * D9 — the one band on the page whose population is not the active Account
   * and the selected range must SAY SO.
   *
   * `getWorkspaceTradeAttentionCounts` counts every Trade in the workspace
   * with no account filter and no date filter, while the KPI band, both
   * baselines, the Execution Gap, the three pillars, the Trade list, the
   * Calendar and the Risk section are all scoped to one Account and one
   * range. Measured on the shipping page, that produced two readings a
   * trader cannot reconcile: an Account with no Trades at all showing
   * "Reviews Pending 28", and a 30D range showing "14 Trades" in Net P&L
   * beside the same unchanged 28. The counts are correct; the silence about
   * which population they came from was the defect.
   */
  it('states that Needs Attention spans the workspace and ignores the date range', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      ...ATTENTION,
      reviewsPending: 28,
    });
    const panel = container.querySelector(
      '[data-dashboard-panel="needs-attention"]',
    ) as HTMLElement;
    expect(within(panel).getByText(/every Account in this workspace/i)).toBeVisible();
    expect(within(panel).getByText(/whatever date range is selected/i)).toBeVisible();
  });

  it('places the two performance cards side by side in one balanced grid', () => {
    const { container } = renderDashboard();
    const system = container.querySelector('[data-dashboard-widget="system.performance"]');
    const trader = container.querySelector('[data-dashboard-widget="trader.performance"]');
    expect(system).not.toBeNull();
    expect(trader).not.toBeNull();
    // Same parent, two equal desktop columns, neither side dominant.
    expect(system?.parentElement).toBe(trader?.parentElement);
    expect(system?.parentElement?.className).toContain('lg:grid-cols-2');
    expect(system?.parentElement?.className).toContain('items-stretch');
    expect(system?.compareDocumentPosition(trader as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps Execution Gap out of the performance cards', () => {
    const { container } = renderDashboard();
    for (const id of ['system.performance', 'trader.performance']) {
      const card = container.querySelector(`[data-dashboard-widget="${id}"]`) as HTMLElement;
      expect(card.textContent).not.toContain('Execution Gap');
      expect(card.textContent).not.toContain('System Edge Captured');
      expect(card.textContent).not.toContain('Comparable Trades');
    }
    // It lives in the D5 section that follows the pair, untouched by D4.
    expect(container.querySelector('[data-dashboard-panel="execution-gap"]')).not.toBeNull();
  });

  it('shows System metrics while Trader is empty', () => {
    const emptyTrader = axis(0, {
      totalR: unavailable('no_trades'),
      expectancyR: unavailable('no_trades'),
      winRate: unavailable('no_trades'),
      profitFactor: unavailable('no_trades'),
    });
    const { container } = renderDashboard(overview({ trader: emptyTrader }));
    const system = container.querySelector('[data-dashboard-panel="system"]') as HTMLElement;
    const trader = container.querySelector('[data-dashboard-panel="trader"]') as HTMLElement;
    expect(within(trader).getByText(/No eligible closed Trader Trades/i)).toBeVisible();
    expect(within(system).getByText('+4.00R')).toBeVisible();
  });

  it.each([
    ['2.0000', '+2.00R'],
    ['-1.0000', '-1.00R'],
  ] as const)('renders the Average Execution Gap %s as %s with its sign', (value, display) => {
    const model = overview({
      comparison: withSummary(overview().comparison, { averageExecutionGapR: available(value) }),
    });
    const { container } = renderDashboard(model);
    const comparison = container.querySelector(
      '[data-dashboard-panel="execution-gap"]',
    ) as HTMLElement;
    const metric = within(comparison).getByText(display);
    expect(metric).toBeVisible();
    // Signed tone is the D5B contract for Gap figures: the sign is the data.
    expect(metric.className).toContain(value.startsWith('-') ? 'text-negative' : 'text-positive');
  });

  it('shows canonical unavailable semantics for efficiency and no comparable Trades', () => {
    const noEdge = overview({
      comparison: withSummary(overview().comparison, {
        systemEdgeCaptured: unavailable('system_has_no_edge'),
      }),
    });
    const first = renderDashboard(noEdge);
    expect(screen.getByText('No positive paired System edge')).toBeVisible();
    first.unmount();

    renderDashboard(
      overview({
        comparison: emptyComparisonFixture({
          comparableCount: 0,
          pairedSystemTotalR: unavailable('no_comparable_trades'),
          pairedActualTotalR: unavailable('no_comparable_trades'),
          executionGapR: unavailable('no_comparable_trades'),
          averageExecutionGapR: unavailable('no_comparable_trades'),
          systemEdgeCaptured: unavailable('no_comparable_trades'),
        }),
      }),
    );
    expect(screen.getByText('0', { exact: true })).toBeVisible();
    expect(screen.getAllByText('No comparable Trades').length).toBeGreaterThanOrEqual(1);
  });

  it('marks the selected date preset and exposes only 30D, 90D, and All links', () => {
    renderDashboard();
    const navigation = screen.getByRole('navigation', { name: 'Date range' });
    expect(within(navigation).getByRole('link', { name: '90D' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getAllByRole('link')).toHaveLength(3);
    expect(within(navigation).getByRole('link', { name: '30D' })).toHaveAttribute(
      'href',
      '/en/app?range=30d&unit=r',
    );
    expect(within(navigation).queryByText(/All accounts/i)).not.toBeInTheDocument();
  });

  it('replaces custom bounds when the temporary legacy range control selects a preset', () => {
    const model = overview();
    renderDashboard({
      ...model,
      filters: {
        ...model.filters,
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
      },
    });
    const navigation = screen.getByRole('navigation', { name: 'Date range' });
    expect(within(navigation).getByRole('link', { name: '30D' })).toHaveAttribute(
      'href',
      '/en/app?range=30d&unit=r',
    );
  });

  it('exposes stable widget IDs and mobile span metadata without rendering Later widgets', () => {
    const { container } = renderDashboard();
    expect(container.querySelector('[data-dashboard-widget="system.performance"]')).toHaveAttribute(
      'data-dashboard-mobile-span',
      '2',
    );
    expect(container.querySelector('[data-dashboard-widget="trades.recent"]')).not.toBeNull();
    expect(container.querySelector('[data-dashboard-widget="calendar.performance"]')).toBeNull();
    // D3 implemented the five Basic KPI widgets; the reserved ones stay unrendered.
    expect(container.querySelector('[data-dashboard-widget="basic.net-pnl"]')).not.toBeNull();
    expect(container.querySelector('[data-dashboard-widget="account.balance"]')).toBeNull();
    expect(container.querySelector('[data-dashboard-widget="risk.drawdown"]')).toBeNull();
  });

  it('leads with the five Basic KPI cards above the attribution panels', () => {
    const { container } = renderDashboard();
    const kpiRow = screen.getByRole('region', { name: 'Key trading figures' });
    expect(kpiRow.querySelectorAll('[data-dashboard-widget]')).toHaveLength(5);

    // The fixture's Trader axis: 60% win rate, +$10.00, 66.67% of days,
    // 2.00x payoff — every figure straight from the D2 payload.
    expect(within(kpiRow).getByText('+$10.00')).toBeVisible();
    expect(within(kpiRow).getByText('60.00%')).toBeVisible();
    expect(within(kpiRow).getByText('5.00')).toBeVisible();
    expect(within(kpiRow).getByText('66.67%')).toBeVisible();
    expect(within(kpiRow).getByText('2.00x')).toBeVisible();

    // The default fixture has every attention count at zero, so the panel
    // that would sit between them is absent; the System card is the first
    // attribution surface that always renders.
    const system = container.querySelector('[data-dashboard-panel="system"]');
    expect(kpiRow.compareDocumentPosition(system as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('orders the KPI row, Needs Attention and the attribution panels top to bottom', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      ...ATTENTION,
      openTrades: 2,
    });
    const kpiRow = screen.getByRole('region', { name: 'Key trading figures' });
    const attention = container.querySelector(
      '[data-dashboard-widget="review.needs-attention"]',
    ) as HTMLElement;
    const system = container.querySelector('[data-dashboard-panel="system"]') as HTMLElement;
    expect(kpiRow.compareDocumentPosition(attention)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(attention.compareDocumentPosition(system)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  /**
   * The panel owns its own layout slot rather than being wrapped in one, so
   * a workspace with nothing to attend to gets no element — and therefore no
   * section margin — where the panel would have been.
   */
  it('leaves no empty layout slot behind when there is nothing to attend to', () => {
    const { container } = renderDashboard(overview(), [RECENT], ATTENTION);
    expect(container.querySelector('[data-dashboard-widget="review.needs-attention"]')).toBeNull();
  });

  it('keeps the real active-account summary and recent pinned labels', () => {
    renderDashboard();
    const account = screen.getByRole('region', { name: 'Active trading account summary' });
    expect(within(account).getByRole('heading', { name: ACCOUNT.name })).toBeVisible();
    // D6B typesets Strategy and Setup as one supporting line beneath the
    // Trade's identity; both pinned historical labels still appear verbatim.
    expect(screen.getByText(/Pinned Breakout v1 · Pinned London Retest/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'XAUUSD' })).toHaveAttribute(
      'href',
      '/app/trades?trade=trade-1',
    );
  });

  it('provides real navigation without demo, verdict, grade, or deep analytics content', () => {
    const { container } = renderDashboard();
    expect(screen.getByRole('link', { name: /View full analytics/i })).toHaveAttribute(
      'href',
      '/app/analytics',
    );
    expect(screen.getByRole('link', { name: /View all Trades/i })).toHaveAttribute(
      'href',
      '/app/trades',
    );
    expect(container.textContent).not.toMatch(
      /demo data|strong edge|weak edge|execution grade|discipline score|mistake cost/i,
    );
    expect(container.querySelector('.recharts-wrapper')).not.toBeInTheDocument();
  });

  it('hides the Needs Attention panel entirely when every count is zero', () => {
    const { container } = renderDashboard(overview(), [RECENT], ATTENTION);
    expect(
      container.querySelector('[data-dashboard-panel="needs-attention"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
  });

  it('shows only the non-zero Needs Attention counts, each linking to the Journal', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      openTrades: 2,
      pendingSystemOutcomes: 0,
      unclassifiedTrades: 5,
      reviewsPending: 0,
      needsExecutionDetails: 0,
    });
    const panel = container.querySelector(
      '[data-dashboard-panel="needs-attention"]',
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getByText('Open Trades')).toBeVisible();
    expect(within(panel).getByText('2')).toBeVisible();
    expect(within(panel).getByText('Unclassified Trades')).toBeVisible();
    expect(within(panel).getByText('5')).toBeVisible();
    expect(within(panel).queryByText('Pending System Outcomes')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Reviews Pending')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Needs Execution Details')).not.toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Review/ })).toHaveAttribute(
      'href',
      '/app/trades',
    );
  });

  // Phase 14E — Open/Close-Only Trade Flow: a small optional bucket for
  // legacy/internal `planned` rows only — shown exclusively when they
  // actually exist, never a major new workflow.
  it('shows the Needs Execution Details bucket only when legacy planned Trades exist', () => {
    const { container } = renderDashboard(overview(), [RECENT], {
      openTrades: 0,
      pendingSystemOutcomes: 0,
      unclassifiedTrades: 0,
      reviewsPending: 0,
      needsExecutionDetails: 3,
    });
    const panel = container.querySelector(
      '[data-dashboard-panel="needs-attention"]',
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(within(panel).getByText('Needs Execution Details')).toBeVisible();
    expect(within(panel).getByText('3')).toBeVisible();
  });

  it('renders an instructional recent-Trades state without replacing populated metrics', () => {
    renderDashboard(overview(), []);
    expect(screen.getByText('No Trades in this account yet')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Log a Trade' })).toHaveAttribute(
      'href',
      '/app/trades/new',
    );
    expect(screen.getByText('+4.00R')).toBeVisible();
  });

  it('reserves the five-card KPI geometry in the loading skeleton', () => {
    const { container } = render(<DashboardSkeleton />);
    const band = container.querySelector('.lg\\:grid-cols-5');
    expect(band).not.toBeNull();
    expect(band?.children).toHaveLength(5);
    // Same span metadata as the real row, so the cards do not resize on arrival.
    expect((band?.lastElementChild as HTMLElement).className).toContain('col-span-2');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
