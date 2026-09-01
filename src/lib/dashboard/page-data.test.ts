import { describe, expect, it } from 'vitest';

import type { ComparisonMetricRecord, SystemMetricRecord } from '@/lib/analytics/metrics';

import {
  composeDashboardPageData,
  type DashboardPageCompositionInput,
  type DashboardTraderMetricRecord,
} from './page-data';

const TIME = '2026-08-01T10:00:00.000Z';

function trader(
  tradeId: string,
  actualR: string,
  outcome: 'win' | 'break_even' | 'loss',
  netPnlMinor: string | null = '100',
  baseCurrency = 'USD',
  plannedR: string | null = '2.0000',
): DashboardTraderMetricRecord {
  return {
    tradeId,
    status: 'closed',
    deletedAt: null,
    actualR,
    traderOutcome: outcome,
    exitedAt: TIME,
    netPnlMinor,
    baseCurrency,
    plannedR,
  };
}

function system(
  tradeId: string,
  systemR: string,
  outcome: 'win' | 'break_even' | 'loss',
): SystemMetricRecord {
  return {
    tradeId,
    systemStatus: 'resolved',
    deletedAt: null,
    systemR,
    systemOutcome: outcome,
    systemExitedAt: TIME,
  };
}

function pair(tradeId: string, actualR: string, systemR: string): ComparisonMetricRecord {
  return {
    tradeId,
    status: 'closed',
    deletedAt: null,
    actualR,
    traderOutcome: actualR.startsWith('-') ? 'loss' : 'win',
    actualExitedAt: TIME,
    systemStatus: 'resolved',
    systemR,
    systemOutcome: systemR.startsWith('-') ? 'loss' : 'win',
    systemExitedAt: TIME,
  };
}

function input(
  overrides: Partial<DashboardPageCompositionInput> = {},
): DashboardPageCompositionInput {
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
      timezone: 'UTC',
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
    account: {
      kind: 'account',
      source: 'active',
      account: {
        id: 'account-a',
        name: 'Primary',
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000',
      },
    },
    trader: [
      trader('win', '2.0000', 'win', '250'),
      trader('be', '0.0000', 'break_even', '0'),
      trader('loss', '-1.0000', 'loss', '-125'),
    ],
    system: [system('win', '3.0000', 'win'), system('loss', '-1.0000', 'loss')],
    comparison: [pair('win', '2.0000', '3.0000'), pair('loss', '-1.0000', '-1.0000')],
    attention: {
      openTrades: 1,
      pendingSystemOutcomes: 2,
      unclassifiedTrades: 3,
      reviewsPending: 4,
      needsExecutionDetails: 0,
    },
    recentTrades: [
      {
        tradeId: 'win',
        occurredAt: TIME,
        symbol: 'EURUSD',
        direction: 'long',
        tradingAccountName: 'Primary',
        status: 'closed',
        traderOutcome: 'win',
        actualR: '2.0000',
        actualExitedAt: TIME,
        systemStatus: 'resolved',
        systemOutcome: 'win',
        systemR: '3.0000',
        systemExitedAt: TIME,
        strategyName: 'Momentum v1',
        setupName: 'Retest',
      },
    ],
    ...overrides,
  };
}

describe('DashboardPageData composition', () => {
  it('prepares canonical basic, System, Trader, comparison, and coverage data', () => {
    const result = composeDashboardPageData(input());
    expect(result.basic.netPnl).toEqual({
      status: 'available',
      currency: 'USD',
      totalMinor: '125',
    });
    expect(result.basic.tradeWin).toEqual({
      rate: { status: 'available', value: '0.3333' },
      tradeCount: 3,
      wins: 1,
      breakEvens: 1,
      losses: 1,
    });
    expect(result.basic.dayWinRate).toMatchObject({
      status: 'available',
      value: { eligibleDayCount: 1, winningDayCount: 1, rate: '1.0000' },
    });
    expect(result.basic.averageWinLoss.payoffRatio).toEqual({
      status: 'available',
      value: '2.0000',
    });
    expect(result.trader.sampleCount).toBe(3);
    expect(result.system.sampleCount).toBe(2);
    expect(result.comparison.summary.executionGapR).toEqual({
      status: 'available',
      value: '-1.0000',
    });
    expect(result.comparison.summary.systemEdgeCaptured).toEqual({
      status: 'available',
      value: '0.5000',
    });
    expect(result.coverage).toEqual({
      traderTradeCount: 3,
      systemTradeCount: 2,
      pairedTradeCount: 2,
      monetaryResultCount: 3,
    });
  });

  /**
   * D5A's contract at the DTO boundary: the series arrive on
   * `DashboardPageData` itself, already cumulative, so no component ever
   * accumulates a financial series during render.
   */
  it('delivers the D5 paired series and distribution through DashboardPageData', () => {
    const result = composeDashboardPageData(input());
    expect(result.comparison.status).toBe('available');
    if (result.comparison.status !== 'available') throw new Error('unreachable');

    expect(result.comparison.tradeSeries.map((point) => point.tradeId)).toEqual(['loss', 'win']);
    expect(result.comparison.tradeSeries.at(-1)?.cumulativeExecutionGapR).toBe('-1.0000');
    // Both fixture pairs share one instant and one UTC day.
    expect(result.comparison.dailySeries).toHaveLength(1);
    expect(result.comparison.dailySeries[0]).toMatchObject({
      pairedTradeCount: 2,
      cumulativeExecutionGapR: '-1.0000',
    });
    expect(result.comparison.distribution).toMatchObject({
      underperformedCount: 1,
      matchedCount: 1,
      outperformedCount: 0,
    });
    expect(result.availability.comparison).toBe('available');
  });

  it('propagates incomplete and mixed-currency money states without affecting R', () => {
    const incomplete = composeDashboardPageData(
      input({ trader: [trader('money', '1', 'win'), trader('price', '2', 'win', null)] }),
    );
    expect(incomplete.basic.netPnl).toEqual({ status: 'unavailable', reason: 'incomplete' });
    expect(incomplete.trader.totalR).toEqual({ status: 'available', value: '3.0000' });

    const mixed = composeDashboardPageData(
      input({ trader: [trader('usd', '1', 'win'), trader('thb', '2', 'win', '100', 'THB')] }),
    );
    expect(mixed.basic.netPnl).toEqual({ status: 'unavailable', reason: 'mixed_currency' });
  });

  it('keeps Population A/B/C independent and exposes empty states explicitly', () => {
    const result = composeDashboardPageData(
      input({
        trader: [],
        system: [system('system-only', '2', 'win')],
        comparison: [],
      }),
    );
    expect(result.availability).toEqual({
      trader: 'empty',
      system: 'available',
      comparison: 'empty',
    });
    expect(result.basic.netPnl).toEqual({ status: 'empty' });
    expect(result.basic.dayWinRate).toEqual({ status: 'unavailable', reason: 'no_trading_days' });
  });

  /*
    AVG PLANNED RR IS THE PLAN AXIS, AND ITS POPULATION IS ITS OWN.

    It averages the persisted `planned_r` of the SAME Trader-eligible Trades
    the rest of the band reads — so it follows Account, date range and every
    filter identically — but a Trade with no planned target contributes no
    ratio and leaves the denominator, rather than entering it as a zero plan.
  */
  it('averages Planned R over the Trader-eligible Trades that carry one', () => {
    const result = composeDashboardPageData(
      input({
        trader: [
          trader('a', '2.0000', 'win', '250', 'USD', '3.0000'),
          trader('b', '-1.0000', 'loss', '-125', 'USD', '2.0000'),
        ],
      }),
    );
    expect(result.basic.plannedRr).toEqual({
      average: { status: 'available', value: '2.5000' },
      tradeCount: 2,
    });
  });

  it('excludes an unplanned Trade from Avg Planned RR without counting it as zero', () => {
    const result = composeDashboardPageData(
      input({
        trader: [
          trader('planned', '2.0000', 'win', '250', 'USD', '4.0000'),
          trader('unplanned', '1.0000', 'win', '100', 'USD', null),
        ],
      }),
    );
    // 4.0000 over ONE Trade, not 2.0000 over two.
    expect(result.basic.plannedRr).toEqual({
      average: { status: 'available', value: '4.0000' },
      tradeCount: 1,
    });
    // The Trader axis still counts both — only the PLAN population narrowed.
    expect(result.coverage.traderTradeCount).toBe(2);
  });

  it('reports a wholly unplanned population as a zero count, never a fabricated ratio', () => {
    const result = composeDashboardPageData(
      input({
        trader: [
          trader('a', '2.0000', 'win', '250', 'USD', null),
          trader('b', '1.0000', 'win', '100', 'USD', null),
        ],
      }),
    );
    expect(result.basic.plannedRr.tradeCount).toBe(0);
    expect(result.basic.plannedRr.average.status).not.toBe('available');
  });

  /*
    The cumulative-R series the Total R card draws is the axis's OWN canonical
    equity curve, so its final point is that axis's Total R by construction.
  */
  it('publishes each axis equity curve, ending at that axis total', () => {
    const result = composeDashboardPageData(input());
    const curve = result.trader.equityCurve;
    expect(curve.status).toBe('available');
    if (curve.status !== 'available') throw new Error('expected a curve');
    // The engine's own order — exit timestamp, then Trade ID — not the order
    // the fixture happened to list them in.
    expect(curve.value.map((point) => point.cumulativeR)).toEqual(['0.0000', '-1.0000', '1.0000']);
    expect(result.trader.totalR).toEqual({ status: 'available', value: '1.0000' });
  });

  it('preserves negative Gap sign and explicit recent-trade unresolved states', () => {
    const base = input();
    const result = composeDashboardPageData(
      input({
        recentTrades: [
          ...base.recentTrades,
          {
            ...base.recentTrades[0]!,
            tradeId: 'pending',
            systemStatus: 'pending',
            systemR: null,
            systemOutcome: null,
            systemExitedAt: null,
          },
        ],
      }),
    );
    expect(result.recentTrades.items[0]?.executionGapR).toEqual({
      status: 'available',
      value: '-1.0000',
    });
    expect(result.recentTrades.items[1]?.executionGapR).toEqual({
      status: 'unavailable',
      reason: 'system_incomplete',
    });
    expect(result.recentTrades).toMatchObject({
      scope: 'dashboard_filters',
      dateAxis: 'occurred_at',
    });
    expect(result.attention.scope).toBe('workspace_operational');
  });

  it('propagates System Edge Captured unavailable reasons', () => {
    const result = composeDashboardPageData(
      input({ comparison: [pair('no-edge', '1.0000', '0.0000')] }),
    );
    expect(result.comparison.summary.systemEdgeCaptured).toEqual({
      status: 'unavailable',
      reason: 'system_has_no_edge',
    });
  });
});
