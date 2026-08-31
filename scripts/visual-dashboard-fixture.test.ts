import { describe, expect, it } from 'vitest';

import { composeDashboardPageData } from '@/lib/dashboard/page-data';

import {
  assertVisualSeedSafety,
  buildVisualTradeBlueprints,
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_PARTIAL_TRADE_INDICES,
  VISUAL_FIXTURE_TRADE_COUNT,
  VISUAL_POPULATED_ACCOUNT_NAME,
  visualAccountIdentity,
  visualTradeChildIdentity,
} from './visual-dashboard-fixture';

const EMAIL = 'beamkattiyot12345@gmail.com';
const WORKSPACE_ID = '019fc85f-2f69-7726-b245-0d213677b4a5';
const identities = visualAccountIdentity({ ownerIdentity: EMAIL, workspaceId: WORKSPACE_ID });
const framework = {
  strategyId: '019fd752-2c97-76e2-8af5-178c49d17ab9',
  strategyVersionId: '019fd752-2d01-7c1a-a955-b464c05cb3c2',
  setups: [
    {
      id: '019fd752-8bf1-7798-8a4e-3d636e7eb00c',
      versionId: '019fd752-8c4e-7e46-acf7-82364bae660c',
      name: 'Wave 2 Reversal',
    },
    {
      id: '019fd752-a7e1-7a2c-992e-f1bcb391b794',
      versionId: '019fd752-a83a-7c3a-af78-aaa5078b4b2e',
      name: 'Wave 3 Continuation',
    },
    {
      id: '019fd752-b9de-744b-9675-f832fc4c7634',
      versionId: '019fd752-ba37-794e-bc41-ca3e49691102',
      name: 'Wave 4 Pullback',
    },
  ],
} as const;

function build() {
  return buildVisualTradeBlueprints({
    populatedAccountId: identities.populatedId,
    framework,
  });
}

function buildFor(populatedAccountId: string) {
  return buildVisualTradeBlueprints({ populatedAccountId, framework });
}

function exitIds(trades: ReturnType<typeof buildFor>): string[] {
  return trades.flatMap((trade) => trade.exits.map((exit) => exit.id));
}

function ruleCheckIds(trades: ReturnType<typeof buildFor>): string[] {
  return trades.flatMap((trade) =>
    ['entry', 'risk', 'exit'].map((ruleKey) =>
      visualTradeChildIdentity(trade.id, 'rule-check', ruleKey),
    ),
  );
}

function page() {
  const trades = build();
  const trader = trades
    .filter((trade) => trade.status === 'closed')
    .map((trade) => ({
      tradeId: trade.id,
      status: trade.status,
      deletedAt: null,
      actualR: trade.actualR,
      traderOutcome: trade.traderOutcome,
      exitedAt: trade.exitedAt!.toISOString(),
      netPnlMinor: trade.netPnlMinor!.toString(),
      baseCurrency: 'USD',
    }));
  const system = trades
    .filter((trade) => trade.systemStatus === 'resolved')
    .map((trade) => ({
      tradeId: trade.id,
      systemStatus: trade.systemStatus,
      deletedAt: null,
      systemR: trade.systemR,
      systemOutcome: trade.systemOutcome,
      systemExitedAt: trade.systemExitedAt!.toISOString(),
    }));
  const comparison = trades.map((trade) => ({
    tradeId: trade.id,
    status: trade.status,
    deletedAt: null,
    actualR: trade.actualR,
    traderOutcome: trade.traderOutcome,
    actualExitedAt: trade.exitedAt?.toISOString() ?? null,
    systemStatus: trade.systemStatus,
    systemR: trade.systemR,
    systemOutcome: trade.systemOutcome,
    systemExitedAt: trade.systemExitedAt?.toISOString() ?? null,
  }));
  const accountScope = { kind: 'account' as const, accountId: identities.populatedId };
  return composeDashboardPageData({
    scope: {
      datePreset: 'all',
      dateBounds: { kind: 'all', start: null, endExclusive: null },
      accountScope: { ...accountScope, source: 'explicit' },
      strategyId: null,
      setupId: null,
      strategyVersionId: null,
      timezone: 'UTC',
    },
    filters: {
      datePreset: 'all',
      customDateRange: null,
      accountScope,
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
      source: 'explicit',
      account: {
        id: identities.populatedId,
        name: VISUAL_POPULATED_ACCOUNT_NAME,
        accountMode: 'live',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
      },
    },
    trader,
    system,
    comparison,
    attention: {
      openTrades: trades.filter((trade) => trade.status === 'open').length,
      pendingSystemOutcomes: trades.filter((trade) => trade.systemStatus === 'pending').length,
      unclassifiedTrades: trades.filter((trade) => trade.strategyId === null).length,
      reviewsPending: trades.filter(
        (trade) => trade.status === 'closed' && trade.reviewNotes === null,
      ).length,
      needsExecutionDetails: trades.filter((trade) => trade.status === 'planned').length,
    },
    recentTrades: [],
  });
}

describe('visual Dashboard seed safety', () => {
  it('requires explicit opt-in and refuses production classifications', () => {
    expect(() =>
      assertVisualSeedSafety({ DATABASE_URL: 'postgresql://local/trading_os_dev' }),
    ).toThrow(/ALLOW_VISUAL_FIXTURE_SEED/);
    expect(() =>
      assertVisualSeedSafety({
        ALLOW_VISUAL_FIXTURE_SEED: 'true',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://local/trading_os_dev',
      }),
    ).toThrow(/production/);
    expect(() =>
      assertVisualSeedSafety({
        ALLOW_VISUAL_FIXTURE_SEED: 'true',
        DATABASE_URL: 'postgresql://local/trading_os',
      }),
    ).toThrow(/non-production marker/);
  });

  it('returns only a redacted, unmistakably development identity', () => {
    expect(
      assertVisualSeedSafety({
        ALLOW_VISUAL_FIXTURE_SEED: 'true',
        DATABASE_URL: 'postgresql://secret-user:secret-password@db.example/trading_os_dev',
      }),
    ).toEqual({
      protocol: 'postgresql:',
      host: 'db.example',
      port: null,
      database: 'trading_os_dev',
      environment: 'development',
    });
  });
});

describe('deterministic visual Dashboard fixture', () => {
  it('rebuilds the same target-owned identities, timestamps, outcomes, and Exit legs', () => {
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(first).toHaveLength(VISUAL_FIXTURE_TRADE_COUNT);
    expect(new Set(first.map((trade) => trade.id)).size).toBe(VISUAL_FIXTURE_TRADE_COUNT);
    expect(VISUAL_EMPTY_ACCOUNT_NAME).toBe('Visual — Empty');
    expect(VISUAL_POPULATED_ACCOUNT_NAME).toBe('Visual — Populated');
    expect(first.filter((trade) => trade.exits.length > 1)).toHaveLength(
      VISUAL_FIXTURE_PARTIAL_TRADE_INDICES.size,
    );
    expect(first.reduce((count, trade) => count + trade.exits.length, 0)).toBe(80);
    expect(first.every((trade) => trade.tradingAccountId === identities.populatedId)).toBe(true);
  });

  it('keeps the same owner/workspace/account namespace exactly deterministic', () => {
    const firstAccounts = visualAccountIdentity({
      ownerIdentity: `  ${EMAIL.toUpperCase()}  `,
      workspaceId: WORKSPACE_ID,
    });
    const secondAccounts = visualAccountIdentity({
      ownerIdentity: EMAIL,
      workspaceId: WORKSPACE_ID.toUpperCase(),
    });
    expect(firstAccounts).toEqual(secondAccounts);
    expect(buildFor(firstAccounts.populatedId)).toEqual(buildFor(secondAccounts.populatedId));
  });

  it('isolates Account identities across owners and workspaces', () => {
    const otherOwner = visualAccountIdentity({
      ownerIdentity: 'visual-isolation-probe@example.invalid',
      workspaceId: WORKSPACE_ID,
    });
    const otherWorkspace = visualAccountIdentity({
      ownerIdentity: EMAIL,
      workspaceId: '019fc85f-2f69-7726-b245-0d213677b4a6',
    });
    const targetIds = new Set(Object.values(identities));
    expect(Object.values(otherOwner).every((id) => !targetIds.has(id))).toBe(true);
    expect(Object.values(otherWorkspace).every((id) => !targetIds.has(id))).toBe(true);
  });

  it('isolates Trade, Exit, mutation, and rule-check IDs across fixture Accounts', () => {
    const other = visualAccountIdentity({
      ownerIdentity: 'visual-isolation-probe@example.invalid',
      workspaceId: WORKSPACE_ID,
    });
    const targetTrades = build();
    const otherTrades = buildFor(other.populatedId);
    const targetIds = new Set([
      ...targetTrades.flatMap((trade) => [trade.id, trade.mutationKey]),
      ...targetTrades.flatMap((trade) =>
        trade.exits.flatMap((exit) => [exit.id, exit.mutationKey]),
      ),
      ...ruleCheckIds(targetTrades),
    ]);
    const otherIds = [
      ...otherTrades.flatMap((trade) => [trade.id, trade.mutationKey]),
      ...otherTrades.flatMap((trade) => trade.exits.flatMap((exit) => [exit.id, exit.mutationKey])),
      ...ruleCheckIds(otherTrades),
    ];
    expect(otherIds.every((id) => !targetIds.has(id))).toBe(true);
  });

  it('makes every Exit ID unique, including every leg on partial-close Trades', () => {
    const trades = build();
    const allExitIds = exitIds(trades);
    const partialExitIds = exitIds(trades.filter((trade) => trade.exits.length > 1));
    expect(allExitIds).toHaveLength(80);
    expect(new Set(allExitIds).size).toBe(allExitIds.length);
    expect(new Set(partialExitIds).size).toBe(partialExitIds.length);
    expect(partialExitIds).toHaveLength(24);
  });

  it('keeps lifecycle populations, money completeness, and operational backlog stable', () => {
    const result = page();
    expect(result.coverage).toEqual({
      traderTradeCount: 66,
      systemTradeCount: 68,
      pairedTradeCount: 64,
      monetaryResultCount: 66,
    });
    expect(result.basic.netPnl).toEqual({
      status: 'available',
      currency: 'USD',
      totalMinor: '231000',
    });
    expect(result.attention.counts).toEqual({
      openTrades: 2,
      pendingSystemOutcomes: 2,
      unclassifiedTrades: 2,
      reviewsPending: 1,
      needsExecutionDetails: 2,
    });
  });

  it('produces stable canonical KPI targets without a second formula implementation', () => {
    const result = page();
    expect(result.system).toMatchObject({
      sampleCount: 68,
      outcomeCounts: { wins: 29, breakEvens: 4, losses: 35 },
      totalR: { status: 'available', value: '36.2500' },
      winRate: { status: 'available', value: '0.4265' },
      averageR: { status: 'available', value: '0.5331' },
      expectancyR: { status: 'available', value: '0.5331' },
      profitFactor: { status: 'available', value: '2.1240' },
      maximumDrawdownR: { status: 'available', value: '5.2000' },
    });
    expect(result.trader).toMatchObject({
      sampleCount: 66,
      outcomeCounts: { wins: 27, breakEvens: 5, losses: 34 },
      totalR: { status: 'available', value: '23.1000' },
      winRate: { status: 'available', value: '0.4091' },
      averageR: { status: 'available', value: '0.3500' },
      expectancyR: { status: 'available', value: '0.3500' },
      profitFactor: { status: 'available', value: '1.6058' },
      maximumDrawdownR: { status: 'available', value: '7.8700' },
    });
    /**
     * PAIRED TOTALS ARE NOT THE INDEPENDENT TOTALS, and this is the assertion
     * that keeps them apart. Population A totals +23.1000R over 66 Trades and
     * Population B totals +36.2500R over 68 (both asserted above), while the
     * 64 paired Trades total +22.0000R and +35.8000R. System Edge Captured is
     * 22.0000 / 35.8000 = 0.6145 — computed from the paired pair, never from
     * 23.1000 / 36.2500 (which would be 0.6372). Making the two sets of
     * numbers agree would destroy the fixture's whole purpose.
     */
    expect(result.comparison.summary).toMatchObject({
      comparableCount: 64,
      pairedSystemTotalR: { status: 'available', value: '35.8000' },
      pairedActualTotalR: { status: 'available', value: '22.0000' },
      executionGapR: { status: 'available', value: '-13.8000' },
      averageExecutionGapR: { status: 'available', value: '-0.2156' },
      systemEdgeCaptured: { status: 'available', value: '0.6145' },
    });

    /*
     * THE TWO AXES OVER THE PAIRED POPULATION — the reason they exist.
     *
     * The System card counts Population B and the Trader card counts
     * Population A, so `System Win Rate` and `Actual Win Rate` are today
     * computed over 68 and 66 Trades respectively. Printed side by side that
     * invites a subtraction of two figures that were never counted over the
     * same Trades. These two axes pin BOTH sides to the same 64, which is
     * what makes a row-by-row comparison honest.
     *
     * Every figure is still produced by `composePerformanceAxis`, the same
     * function both cards use. Only the population is pinned.
     */
    expect(result.comparison.summary.pairedSystemAxis.sampleCount).toBe(64);
    expect(result.comparison.summary.pairedActualAxis.sampleCount).toBe(64);
    expect(result.comparison.summary.pairedSystemAxis.totalR).toEqual({
      status: 'available',
      value: '35.8000',
    });
    expect(result.comparison.summary.pairedActualAxis.totalR).toEqual({
      status: 'available',
      value: '22.0000',
    });
    // The axis totals are the same numbers the dedicated total fields carry.
    // If these ever diverge, two formulas are computing one quantity.
    expect(result.comparison.summary.pairedSystemAxis.totalR).toEqual(
      result.comparison.summary.pairedSystemTotalR,
    );
    expect(result.comparison.summary.pairedActualAxis.totalR).toEqual(
      result.comparison.summary.pairedActualTotalR,
    );

    /*
     * WHY 68 AND 66 BECOME 64. The Dashboard now says so on the card, and
     * "excluding 6 Trades" alone cannot: the reader is watching System Total
     * R read 35.80R where the System card reads 36.25R, and needs the reason
     * rather than the count.
     */
    expect(result.comparison.exclusions).toEqual({
      total: 6,
      byReason: {
        awaiting_system_result: 2,
        trade_open: 2,
        trade_planned: 2,
        trade_canceled: 0,
        incomplete_record: 0,
      },
    });
    expect(result.basic.dayWinRate.status).toBe('available');
    if (result.basic.dayWinRate.status === 'available') {
      expect(result.basic.dayWinRate.value.winningDayCount).toBeGreaterThan(0);
      expect(result.basic.dayWinRate.value.breakEvenDayCount).toBeGreaterThan(0);
      expect(result.basic.dayWinRate.value.losingDayCount).toBeGreaterThan(0);
    }
  });

  /**
   * TRADE WIN % AND DAY WIN % CAN NOW DISAGREE, WHICH THEY COULD NOT BEFORE.
   *
   * The fixture used to put exactly one Trade on every local day, which made
   * the two metrics share a numerator and a denominator by construction: both
   * read 40.91% on every range, and no regression test could have caught a
   * defect in either because they were incapable of differing. Three Trades
   * now share one day, so 66 Trades occupy 64 days and the two rates are
   * computed over genuinely different populations.
   *
   * This is what a fixture is for. The numbers below are not a target — they
   * are the proof that the two formulas are separable.
   */
  it('separates Trade Win % from Day Win % instead of forcing them equal', () => {
    const result = page();
    const trade = result.basic.tradeWin;
    const day = result.basic.dayWinRate;

    expect(trade.tradeCount).toBe(66);
    expect(trade.rate).toEqual({ status: 'available', value: '0.4091' });

    expect(day.status).toBe('available');
    if (day.status !== 'available') throw new Error('unreachable');
    expect(day.value.eligibleDayCount).toBe(64);
    expect(day.value.eligibleDayCount).toBeLessThan(trade.tradeCount);
    expect(day.value.rate).not.toEqual(trade.rate.status === 'available' ? trade.rate.value : null);
  });

  /**
   * THE BREAK-EVEN BAND IS REACHABLE AT DAY LEVEL, AND TODAY IT IS IGNORED.
   *
   * `BREAK_EVEN_TOLERANCE_R` is 0.0500R and it classifies a Trade's own R.
   * `dayWinRate` and the Calendar both classify a DAY's total R — the same
   * quantity, summed — but with a strict `> 0` comparison, so a day totalling
   * +0.0300R is a winning day while the single Trade that produced it is a
   * break-even Trade. The same figure, contradicting itself on one page.
   *
   * The fixture now contains all three shapes that expose it: a lone
   * +0.0300R Trade, a lone -0.0300R Trade, and a three-Trade day of
   * 2.2000 - 1.1000 - 1.1500 that lands on exactly -0.0500R, the tolerance
   * boundary, from Trades none of which is individually break-even.
   *
   * THESE NUMBERS ARE THE BUG, NOT THE CONTRACT. They are pinned here so the
   * fix has something to change: under the tolerance rule the day counts
   * become 26 winning / 6 break-even / 32 losing and the rate becomes 0.4063.
   * Update this test when that lands; do not update the fixture to make it
   * pass.
   */
  it('currently classifies a day by strict sign, ignoring the break-even band', () => {
    const day = page().basic.dayWinRate;
    if (day.status !== 'available') throw new Error('unreachable');

    expect(day.value).toMatchObject({
      eligibleDayCount: 64,
      winningDayCount: 27,
      breakEvenDayCount: 3,
      losingDayCount: 34,
      rate: '0.4219',
    });
  });

  /**
   * D5A on the deterministic fixture, offline. The same 64 paired Trades that
   * produce the summary above must produce a series that closes on it — the
   * numbers here are derived, never restated, so a drift in either the
   * composer or the fixture breaks this rather than hiding.
   */
  it('composes a D5 paired series that reconciles with the paired summary', () => {
    const comparison = page().comparison;
    expect(comparison.status).toBe('available');
    if (comparison.status !== 'available') throw new Error('unreachable');

    expect(comparison.tradeSeries).toHaveLength(64);
    expect(comparison.tradeSeries.at(-1)?.cumulativeSystemR).toBe('35.8000');
    expect(comparison.tradeSeries.at(-1)?.cumulativeActualR).toBe('22.0000');
    expect(comparison.tradeSeries.at(-1)?.cumulativeExecutionGapR).toBe('-13.8000');
    expect(comparison.dailySeries.at(-1)?.cumulativeExecutionGapR).toBe('-13.8000');
    expect(comparison.dailySeries.reduce((total, point) => total + point.pairedTradeCount, 0)).toBe(
      64,
    );

    // Ordering is Actual exit ASC then Trade ID ASC, with the identity intact
    // at every point.
    let previousInstant = Number.NEGATIVE_INFINITY;
    for (const point of comparison.tradeSeries) {
      const instant = new Date(point.exitedAt).getTime();
      expect(instant).toBeGreaterThanOrEqual(previousInstant);
      previousInstant = instant;
      expect(Number(point.cumulativeExecutionGapR)).toBeCloseTo(
        Number(point.cumulativeActualR) - Number(point.cumulativeSystemR),
        10,
      );
    }

    // Distribution is derived from the canonical Gap, never hardcoded.
    const { underperformedCount, matchedCount, outperformedCount } = comparison.distribution;
    expect(underperformedCount + matchedCount + outperformedCount).toBe(64);
    expect(underperformedCount).toBe(
      comparison.tradeSeries.filter((point) => Number(point.executionGapR) < 0).length,
    );
    expect(matchedCount).toBe(
      comparison.tradeSeries.filter((point) => Number(point.executionGapR) === 0).length,
    );
    expect(outperformedCount).toBe(
      comparison.tradeSeries.filter((point) => Number(point.executionGapR) > 0).length,
    );
  });

  /**
   * §16 on real fixture data: the 10 partial-close Trades are one position
   * each, so they contribute one series point each and never one per leg.
   */
  it('emits exactly one paired series point per partial-close Trade', () => {
    const comparison = page().comparison;
    if (comparison.status !== 'available') throw new Error('unreachable');
    const seriesIds = comparison.tradeSeries.map((point) => point.tradeId);
    expect(new Set(seriesIds).size).toBe(seriesIds.length);

    const partialIds = new Set(
      build()
        .filter((trade) => trade.exits.length > 1)
        .map((trade) => trade.id),
    );
    expect(partialIds.size).toBe(10);
    const partialPoints = seriesIds.filter((id) => partialIds.has(id));
    expect(partialPoints).toHaveLength(partialIds.size);
  });
});
