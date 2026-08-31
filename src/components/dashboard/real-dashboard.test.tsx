import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { DashboardPageData, DashboardPerformanceData } from '@/lib/dashboard/page-data';
import { NO_COMPARISON_EXCLUSIONS, performanceAxis } from '@/test/analytics-model-fixtures';

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
    payoffRatio: available('2.4000'),
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
      pairedSystemAxis: performanceAxis(),
      pairedActualAxis: performanceAxis(),
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
  exclusions: NO_COMPARISON_EXCLUSIONS,
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
  exclusions: NO_COMPARISON_EXCLUSIONS,
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

/** The skeleton reads its own copy, so it needs the same message context. */
function renderSkeleton() {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <DashboardSkeleton />
    </NextIntlClientProvider>,
  );
}

describe('RealDashboard', () => {
  /**
   * THE TWO BASELINE PANELS ARE ONE TABLE NOW, AND THE POPULATION IS WHY.
   *
   * `data-dashboard-panel="system"` and `="trader"` were two cards printing
   * the same three metric names over two DIFFERENT populations, with no
   * relationship stated between them. They are replaced by three rows that
   * read one paired population on both sides, so the difference column is a
   * subtraction of like for like rather than an invitation to subtract by
   * eye across a gutter.
   */
  it('renders System and Actual as one paired table, not two independent panels', () => {
    const { container } = renderDashboard();
    expect(container.querySelector('[data-dashboard-panel="system"]')).toBeNull();
    expect(container.querySelector('[data-dashboard-panel="trader"]')).toBeNull();

    const card = container.querySelector('[data-dashboard-panel="execution-gap"]') as HTMLElement;
    // Two tables in this card: the comparison and the chart's sr-only
    // fallback. Scope by the data hook rather than by role.
    const table = card.querySelector('[data-comparison-table]') as HTMLElement;
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Metric', 'System', 'Actual', 'ΔDifference (Actual minus System)']);
    expect(
      [...table.querySelectorAll('[data-comparison-row]')].map((row) =>
        row.getAttribute('data-comparison-row'),
      ),
    ).toEqual(['totalR', 'winRate', 'payoffRatio']);
  });

  /**
   * The Total R row's difference is not recomputed from the two totals: it
   * IS `executionGapR`, the same metric the header shows. If the two ever
   * disagreed there would be two implementations of one quantity and no way
   * to tell which was right.
   */
  it('shows the same Execution Gap in the header and in the Total R row', () => {
    const { container } = renderDashboard();
    const card = container.querySelector('[data-dashboard-panel="execution-gap"]') as HTMLElement;
    const headline = card.querySelector('[data-execution-gap-metric="totalGap"]') as HTMLElement;
    const totalRow = card.querySelector('[data-comparison-row="totalR"]') as HTMLElement;
    const delta = totalRow.querySelector('[data-comparison-cell="delta"]') as HTMLElement;

    expect(headline.textContent).toContain('-2.00R');
    expect(delta.textContent).toBe('-2.00R');
  });

  /**
   * A paired population that cannot be formed is one fact about the card,
   * not two facts about two sides. The per-side "no eligible System Trades"
   * and "no eligible Trader Trades" notices went with the panels that
   * carried them; the merged card says the pairing failed once.
   */
  it('states an empty comparison once rather than per side', () => {
    const model = overview({
      comparison: {
        status: 'empty',
        reason: 'no_comparable_trades',
        exclusions: NO_COMPARISON_EXCLUSIONS,
        summary: overview().comparison.summary,
      },
    });
    const { container } = renderDashboard(model);
    const card = container.querySelector('[data-dashboard-panel="execution-gap"]') as HTMLElement;

    expect(card.querySelector('[data-execution-gap-state="empty"]')).not.toBeNull();
    expect(card.querySelector('[data-comparison-table]')).toBeNull();
    expect(card.textContent).not.toContain('No eligible System Trades');
  });

  /**
   * D4.5 §5. The page used to separate every boundary with the same 32px
   * gap, whatever it separated. These margins are the explicit rhythm that
   * replaced it — asserted as classes because the jsdom renderer has no
   * layout, and pinned here so a later edit cannot quietly restore the
   * uniform spacing that made the Dashboard read as a landing page.
   */
  /**
   * TWO BOUNDARIES, NOT FIVE. D4.5 replaced one uniform 32px gap with a
   * 20/24/28/32 ramp; this pass replaces the ramp, because four margins
   * nobody can tell apart is just four ways of being loose. The page has
   * exactly two kinds of boundary now — 16px inside the opening operational
   * block (account strip, KPI band, Needs Attention) and 24px between
   * analytical sections, which is also the gap those sections use between
   * their own cards. Asserted as classes because the jsdom renderer has no
   * layout, and pinned here so a later edit cannot quietly reintroduce the
   * spacing that made the Dashboard read as a landing page.
   */
  it('separates the page on exactly two boundaries, context and section', () => {
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
    const comparison = container
      .querySelector('[data-dashboard-panel="execution-gap"]')
      ?.closest('section') as HTMLElement;

    expect(kpiRow.className).toContain('mt-4');
    // Absent an account context bar the KPI band is first and takes no margin.
    expect(kpiRow.className).toContain('first:mt-0');
    expect(attention.className).toContain('mt-4');
    expect(comparison.className).toContain('mt-6');
    // The retired ramp must not creep back in one step at a time.
    for (const element of [kpiRow, attention, comparison]) {
      expect(element.className).not.toMatch(/\bmt-(5|7|8)\b/);
    }
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
    // Nothing was traded away for the height: title, every non-zero count with
    // its label, and the Review action are all still here. The scope sentence
    // moved behind the ⓘ in this pass and is asserted there instead.
    expect(within(panel).getByText('Needs attention')).toBeVisible();
    expect(within(panel).queryByText(/not a task list/i)).toBeNull();
    expect(within(panel).getByRole('button', { name: 'About Needs attention' })).toBeVisible();
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
  it('states that Needs Attention spans the workspace and ignores the date range', async () => {
    const user = userEvent.setup();
    const { container } = renderDashboard(overview(), [RECENT], {
      ...ATTENTION,
      reviewsPending: 28,
    });
    const panel = container.querySelector(
      '[data-dashboard-panel="needs-attention"]',
    ) as HTMLElement;

    // The sentence is no longer printed permanently beside the counts — the
    // benchmark's Dashboard carries no such copy — but it is still on the
    // page and still reachable by a real button, which is the whole point of
    // moving it rather than deleting it. The D9 guarantee is unchanged: a
    // reader can always find out which population these counts came from.
    await user.click(within(panel).getByRole('button', { name: 'About Needs attention' }));
    expect(await screen.findByText(/every Account in this workspace/i)).toBeVisible();
    expect(screen.getByText(/whatever date range is selected/i)).toBeVisible();
  });

  /**
   * THE OPPOSITE RULE NOW HOLDS, DELIBERATELY.
   *
   * "Keeps Execution Gap out of the performance cards" was the right rule
   * while the baselines counted their own populations: a Gap printed on a
   * Population B card would have been a figure from a third population
   * sitting inside a second. Once every row reads the paired population the
   * Gap belongs in the same card — it is the difference between the two
   * columns beside it.
   */
  it('carries the Gap, the captured ratio and the table in one card', () => {
    const { container } = renderDashboard();
    const card = container.querySelector('[data-dashboard-panel="execution-gap"]') as HTMLElement;

    expect(card.querySelector('[data-execution-gap-metric="totalGap"]')).not.toBeNull();
    expect(card.querySelector('[data-execution-gap-metric="systemEdgeCaptured"]')).not.toBeNull();
    expect(card.querySelector('[data-comparison-table]')).not.toBeNull();
    // One card, so exactly one heading for the whole comparison.
    expect(within(card).getAllByRole('heading')).toHaveLength(1);
  });

  /**
   * The section's headline R figure is the SUMMED `executionGapR`, by explicit
   * product decision — Average Execution Gap remains a canonical computed
   * diagnostic on the payload but is no longer a Dashboard headline. Signed
   * tone is unchanged: the sign is the data.
   */
  it.each([
    ['2.0000', '+2.00R'],
    ['-1.0000', '-1.00R'],
  ] as const)('renders the Execution Gap %s as %s with its sign', (value, display) => {
    const model = overview({
      comparison: withSummary(overview().comparison, { executionGapR: available(value) }),
    });
    const { container } = renderDashboard(model);
    const comparison = container.querySelector(
      '[data-dashboard-panel="execution-gap"]',
    ) as HTMLElement;
    // The same figure is now legitimately on screen twice — as the header's
    // conclusion and as the Total R row's difference — so this asserts the
    // headline specifically rather than "the only node with this text".
    const headline = comparison.querySelector(
      '[data-execution-gap-metric="totalGap"]',
    ) as HTMLElement;
    const metric = within(headline).getByText(display);
    expect(metric).toBeVisible();
    expect(metric.className).toContain(value.startsWith('-') ? 'text-negative' : 'text-positive');
  });

  it('keeps Average Execution Gap on the payload while never rendering it', () => {
    const model = overview({
      comparison: withSummary(overview().comparison, {
        executionGapR: available('-5.0000'),
        averageExecutionGapR: available('-2.5000'),
      }),
    });
    const { container } = renderDashboard(model);
    const comparison = container.querySelector(
      '[data-dashboard-panel="execution-gap"]',
    ) as HTMLElement;
    const headline = comparison.querySelector(
      '[data-execution-gap-metric="totalGap"]',
    ) as HTMLElement;
    expect(within(headline).getByText('-5.00R')).toBeVisible();
    expect(comparison.textContent).not.toContain('-2.50R');
    // The data itself is untouched — only the presentation dropped it.
    expect(model.comparison.summary.averageExecutionGapR).toEqual({
      status: 'available',
      value: '-2.5000',
    });
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
          pairedSystemAxis: performanceAxis(),
          pairedActualAxis: performanceAxis(),
          pairedSystemTotalR: unavailable('no_comparable_trades'),
          pairedActualTotalR: unavailable('no_comparable_trades'),
          executionGapR: unavailable('no_comparable_trades'),
          averageExecutionGapR: unavailable('no_comparable_trades'),
          systemEdgeCaptured: unavailable('no_comparable_trades'),
        }),
      }),
    );
    // The paired count is no longer a headline, so the empty population is
    // stated in words on both remaining metrics rather than as a bare "0".
    expect(screen.getAllByText('No comparable Trades').length).toBeGreaterThanOrEqual(1);
  });

  /**
   * R2B removed the section-local 30D/90D/All control. The Dashboard has ONE
   * visible Date Range owner — the sticky toolbar — and this asserts the
   * duplicate is genuinely gone from the page rather than merely restyled.
   * The underlying applied state is unchanged and is still exercised by the
   * date-domain and toolbar suites.
   */
  it('renders no section-local date range control', () => {
    renderDashboard();
    expect(screen.queryByRole('navigation', { name: 'Date range' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '30D' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '90D' })).not.toBeInTheDocument();
  });

  it('keeps an applied custom range out of the performance section entirely', () => {
    const model = overview();
    renderDashboard({
      ...model,
      filters: {
        ...model.filters,
        datePreset: 'custom',
        customDateRange: { from: '2026-07-10', to: '2026-08-12' },
      },
    });
    // The floating section heading is retired with the section; the card
    // that replaced it names itself, which is what every other block on the
    // page already did.
    expect(
      screen.queryByRole('heading', { name: 'System vs Trader performance' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'System vs Trader' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Date range' })).not.toBeInTheDocument();
  });

  it('exposes stable widget IDs and mobile span metadata without rendering Later widgets', () => {
    const { container } = renderDashboard();
    expect(container.querySelector('[data-dashboard-widget="execution.gap"]')).toHaveAttribute(
      'data-dashboard-mobile-span',
      '2',
    );
    // The two baseline widgets were absorbed rather than hidden, so they are
    // absent from the DOM as well as from the registry.
    expect(container.querySelector('[data-dashboard-widget="system.performance"]')).toBeNull();
    expect(container.querySelector('[data-dashboard-widget="trader.performance"]')).toBeNull();
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
    // that would sit between them is absent; the merged System vs Trader card
    // is the first attribution surface that always renders.
    const comparison = container.querySelector('[data-dashboard-panel="execution-gap"]');
    expect(kpiRow.compareDocumentPosition(comparison as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    const comparison = container.querySelector(
      '[data-dashboard-panel="execution-gap"]',
    ) as HTMLElement;
    expect(kpiRow.compareDocumentPosition(attention)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(attention.compareDocumentPosition(comparison)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    // Present, but no longer a heading: the account name is the value beside
    // its "Active account" label, and as an `<h3>` under the page's `<h1>` it
    // skipped a level for a string that titles nothing.
    expect(within(account).getByText(ACCOUNT.name)).toBeVisible();
    expect(within(account).queryByRole('heading')).not.toBeInTheDocument();
    // The Recent Trades preview is three fields now (date, symbol, Actual R),
    // so the pinned Strategy/Setup line is no longer printed on the row — it
    // belongs to the Trade record the row links to. The link itself is
    // unchanged in destination and now spans the whole row, so its accessible
    // name is the row's three fields rather than the symbol alone.
    expect(screen.queryByText(/Pinned Breakout v1 · Pinned London Retest/)).toBeNull();
    expect(screen.getByRole('link', { name: /XAUUSD/ })).toHaveAttribute(
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
    // The empty record list must not blank the analytical surfaces above it.
    // `+4.00R` used to be the System baseline card's Total R; the merged card
    // states the PAIRED System total instead, which is the fixture's 3.0000.
    const totalRow = screen.getByRole('row', { name: /Total R/ });
    expect(
      within(totalRow).getByText('+3.00R', {
        selector: '[data-comparison-cell="system"]',
      }),
    ).toBeVisible();
  });

  it('reserves the five-card KPI geometry in the loading skeleton', () => {
    const { container } = renderSkeleton();
    const band = container.querySelector('.lg\\:grid-cols-5');
    expect(band).not.toBeNull();
    expect(band?.children).toHaveLength(5);
    // Same span metadata as the real row, so the cards do not resize on arrival.
    expect((band?.lastElementChild as HTMLElement).className).toContain('col-span-2');
    // The reserved geometry is decorative; the announcement and the branded
    // mark beside it are not, so `aria-hidden` belongs on the blocks alone.
    expect(band?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
