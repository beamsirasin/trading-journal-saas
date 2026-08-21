import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardOverview, PerformanceAnalyticsModel } from '@/lib/analytics/metrics';
import type { ActiveTradingAccountSummary } from '@/server/auth/dal';

import en from '../../../messages/en.json';
import { RealDashboard, type DashboardRecentTrade } from './real-dashboard';

vi.mock('@/i18n/navigation', () => ({
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
    Pick<PerformanceAnalyticsModel, 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'>
  > = {},
) {
  return {
    sampleCount,
    totalR: available('4.0000'),
    expectancyR: available('1.3333'),
    winRate: available('0.6667'),
    profitFactor: available('5.0000'),
    ...overrides,
  };
}

function overview(overrides: Partial<DashboardOverview> = {}): DashboardOverview {
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
    system: axis(3),
    trader: axis(5, { totalR: available('-1.0000') }),
    comparison: {
      comparableCount: 2,
      pairedSystemTotalR: available('3.0000'),
      pairedActualTotalR: available('1.0000'),
      executionGapR: available('-2.0000'),
      averageExecutionGapR: available('-1.0000'),
      executionEfficiency: available('0.3333'),
    },
    systemPendingCount: 0,
    ...overrides,
  };
}

const ACCOUNT: ActiveTradingAccountSummary = {
  id: 'account-a',
  name: 'Primary Execution Account',
  accountMode: 'live',
  baseCurrency: 'USD',
  startingBalance: '10000',
};

const RECENT: DashboardRecentTrade = {
  tradeId: 'trade-1',
  occurredAt: '2026-08-08T10:00:00.000Z',
  occurredAtDisplay: '8 Aug 2026, 17:00',
  symbol: 'XAUUSD',
  direction: 'long',
  tradingAccountName: ACCOUNT.name,
  strategyName: 'Pinned Breakout v1',
  setupName: 'Pinned London Retest',
  strategyVersionNumber: 1,
  status: 'closed',
  systemStatus: 'resolved',
  actualR: '-1.0000',
  systemR: '3.0000',
  traderOutcome: 'loss',
  systemOutcome: 'win',
  plannedR: null,
  closedBps: 10_000,
  remainingBps: 0,
  realizedRToDate: null,
  setupConditionMetCount: null,
  setupConditionTotalCount: null,
  tradingAccountIsArchived: false,
  strategyIsArchived: false,
  setupIsArchived: false,
};

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
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <RealDashboard
        account={ACCOUNT}
        overview={model}
        recentTrades={recentTrades}
        attention={attention}
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
    expect(within(system as HTMLElement).getByText('3 Trades')).toBeVisible();
    expect(within(trader as HTMLElement).getByText('5 Trades')).toBeVisible();
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
    expect(within(system).getByText(/No eligible System Trades/i)).toBeVisible();
    expect(within(system).getAllByText('No eligible Trades')).toHaveLength(4);
    expect(within(trader).getByText('-1.00R')).toBeVisible();
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
  ] as const)('renders Execution Gap %s neutrally as %s', (value, display) => {
    const model = overview({
      comparison: { ...overview().comparison, averageExecutionGapR: available(value) },
    });
    const { container } = renderDashboard(model);
    const comparison = container.querySelector(
      '[data-dashboard-panel="comparison"]',
    ) as HTMLElement;
    expect(within(comparison).getByText(display)).toBeVisible();
    expect(within(comparison).getByText(display)).toHaveClass('text-foreground');
  });

  it('shows canonical unavailable semantics for efficiency and no comparable Trades', () => {
    const noEdge = overview({
      comparison: {
        ...overview().comparison,
        executionEfficiency: unavailable('system_has_no_edge'),
      },
    });
    const first = renderDashboard(noEdge);
    expect(screen.getByText('No positive paired System edge')).toBeVisible();
    first.unmount();

    renderDashboard(
      overview({
        comparison: {
          comparableCount: 0,
          pairedSystemTotalR: unavailable('no_comparable_trades'),
          pairedActualTotalR: unavailable('no_comparable_trades'),
          executionGapR: unavailable('no_comparable_trades'),
          averageExecutionGapR: unavailable('no_comparable_trades'),
          executionEfficiency: unavailable('no_comparable_trades'),
        },
      }),
    );
    expect(screen.getByText('0', { exact: true })).toBeVisible();
    expect(screen.getAllByText('No comparable Trades')).toHaveLength(2);
  });

  it('marks the selected date preset and exposes only 30D, 90D, and All links', () => {
    renderDashboard();
    const navigation = screen.getByRole('navigation', { name: 'Date range' });
    expect(within(navigation).getByRole('link', { name: '90D' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(navigation).getAllByRole('link')).toHaveLength(3);
    expect(within(navigation).queryByText(/All accounts/i)).not.toBeInTheDocument();
  });

  it('keeps the real active-account summary and recent pinned labels', () => {
    renderDashboard();
    const account = screen.getByRole('region', { name: 'Active trading account summary' });
    expect(within(account).getByRole('heading', { name: ACCOUNT.name })).toBeVisible();
    expect(screen.getByText('Pinned Breakout v1')).toBeVisible();
    expect(screen.getByText('Pinned London Retest')).toBeVisible();
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
});
