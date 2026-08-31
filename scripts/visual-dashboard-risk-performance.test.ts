import { describe, expect, it } from 'vitest';

import { resolveAnalyticsDateBounds, type AnalyticsDatePreset } from '@/lib/analytics/filters';
import {
  composeRiskPerformance,
  type AvailableRiskPerformanceData,
} from '@/lib/dashboard/risk-performance';
import { composeRiskPerformanceView } from '@/lib/dashboard/risk-performance-presentation';

import {
  buildVisualTradeBlueprints,
  VISUAL_FIXTURE_PARTIAL_TRADE_INDICES,
  VISUAL_FIXTURE_REFERENCE_INSTANT,
  visualAccountIdentity,
} from './visual-dashboard-fixture';

const identities = visualAccountIdentity({
  ownerIdentity: 'beamkattiyot12345@gmail.com',
  workspaceId: '019fc85f-2f69-7726-b245-0d213677b4a5',
});
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

const trades = buildVisualTradeBlueprints({
  populatedAccountId: identities.populatedId,
  framework,
});
const closed = trades
  .filter((trade) => trade.status === 'closed')
  .map((trade) => ({
    tradeId: trade.id,
    actualExitedAt: trade.exitedAt as Date,
    netPnlMinor: trade.netPnlMinor,
    baseCurrency: 'USD',
  }));

function compose(preset: AnalyticsDatePreset, rows = closed): AvailableRiskPerformanceData {
  const dateBounds = resolveAnalyticsDateBounds(preset, 'UTC', VISUAL_FIXTURE_REFERENCE_INSTANT);
  if (!dateBounds.ok) throw new Error(dateBounds.code);
  const result = composeRiskPerformance({
    scope: {
      datePreset: preset,
      dateBounds: dateBounds.bounds,
      account: {
        kind: 'account',
        accountId: identities.populatedId,
        source: 'explicit',
        baseCurrency: 'USD',
        startingBalance: '10000.0000000000',
      },
      strategyId: null,
      setupId: null,
      strategyVersionId: null,
    },
    asOf: VISUAL_FIXTURE_REFERENCE_INSTANT,
    trades: rows,
  });
  if (result.status !== 'available') throw new Error(result.reason);
  return result;
}

function summary(result: AvailableRiskPerformanceData) {
  return {
    opening: result.openingBalanceMinor,
    ending: result.endingBalanceMinor,
    period: result.periodNetPnlMinor,
    peak: result.peakBalanceMinor,
    current: result.currentDrawdown,
    max: result.maxDrawdown,
    count: result.closedTradeCount,
    points: result.series.length,
    checked: result.completeness.checkedClosedTradeCount,
  };
}

describe('Visual Dashboard D7A Risk Performance contract', () => {
  it('reconciles Visual — Populated All exactly from Starting Balance plus 66 authoritative Trade results', () => {
    expect(summary(compose('all'))).toEqual({
      opening: '1000000',
      ending: '1231000',
      period: '231000',
      peak: '1242000',
      current: {
        amountMinor: '11000',
        percentage: { status: 'available', value: '0.8857' },
        referencePeakMinor: '1242000',
      },
      max: {
        amountMinor: '78700',
        percentage: { status: 'available', value: '6.8405' },
        referencePeakMinor: '1150500',
      },
      count: 66,
      points: 68,
      checked: 66,
    });
  });

  it('locks the correct 90D opening and carried drawdown context', () => {
    expect(summary(compose('90d'))).toEqual({
      opening: '1011000',
      ending: '1231000',
      period: '220000',
      peak: '1242000',
      current: {
        amountMinor: '11000',
        percentage: { status: 'available', value: '0.8857' },
        referencePeakMinor: '1242000',
      },
      max: {
        amountMinor: '78700',
        percentage: { status: 'available', value: '6.8405' },
        referencePeakMinor: '1150500',
      },
      count: 64,
      points: 66,
      checked: 66,
    });
  });

  it('locks the correct 30D opening without resetting the historical peak', () => {
    expect(summary(compose('30d'))).toEqual({
      opening: '1127000',
      ending: '1231000',
      period: '104000',
      peak: '1242000',
      current: {
        amountMinor: '11000',
        percentage: { status: 'available', value: '0.8857' },
        referencePeakMinor: '1242000',
      },
      max: {
        amountMinor: '45500',
        percentage: { status: 'available', value: '3.9548' },
        referencePeakMinor: '1150500',
      },
      count: 17,
      points: 19,
      checked: 66,
    });
  });

  it('keeps Visual — Empty available at its declared starting balance', () => {
    const result = compose('all', []);
    expect(summary(result)).toMatchObject({
      opening: '1000000',
      ending: '1000000',
      period: '0',
      peak: '1000000',
      current: { amountMinor: '0' },
      max: { amountMinor: '0' },
      count: 0,
      points: 2,
      checked: 0,
    });
  });

  it('maps all 10 partial-close fixture positions to one balance realization each', () => {
    const result = compose('all');
    const realizedIds = result.series.flatMap((point) =>
      point.kind === 'trade_close' ? point.tradeIds : [],
    );
    const partialIds = new Set(
      trades
        .filter((trade) => VISUAL_FIXTURE_PARTIAL_TRADE_INDICES.has(trade.fixtureIndex))
        .map((trade) => trade.id),
    );
    expect(partialIds.size).toBe(10);
    expect(realizedIds.filter((id) => partialIds.has(id))).toHaveLength(10);
    expect(new Set(realizedIds).size).toBe(66);
    expect(result.endingBalanceMinor).toBe('1231000');
  });
});

/**
 * D7B — the same deterministic fixture, read through the presentation layer
 * the Dashboard actually renders.
 *
 * The block above locks the canonical minor units; this one locks what a
 * reader SEES. They are deliberately separate: a correct domain figure
 * rendered with a rescaled percentage or a re-derived ending balance would
 * pass the first block and still ship a lie.
 */
function present(preset: AnalyticsDatePreset, rows = closed) {
  const view = composeRiskPerformanceView({
    data: compose(preset, rows),
    timezone: 'UTC',
    dateLocale: 'en-GB',
  });
  if (view.status !== 'available') throw new Error(`Expected available, got ${view.status}`);
  return view;
}

function presented(view: ReturnType<typeof present>) {
  return {
    opening: view.opening,
    ending: view.modeledBalanceText,
    period: view.periodNetPnl,
    peak: view.peakBalanceText,
    current: view.currentDrawdown,
    max: view.maxDrawdown,
    count: view.closedTradeCount,
    points: view.points.length,
  };
}

describe('Visual Dashboard D7B Risk Performance presentation', () => {
  it('presents Visual — Populated All from the declared Starting Balance', () => {
    expect(presented(present('all'))).toEqual({
      opening: { kind: 'all', balanceText: '$10,000.00' },
      ending: '$12,310.00',
      period: { text: '+$2,310.00', tone: 'positive' },
      peak: '$12,420.00',
      current: { amountText: '$110.00', percentageText: '0.89%', isZero: false },
      max: { amountText: '$787.00', percentageText: '6.84%', isZero: false },
      count: 66,
      points: 68,
    });
  });

  it('presents Visual — Populated 90D with its carried opening balance', () => {
    expect(presented(present('90d'))).toEqual({
      opening: { kind: 'carried', balanceText: '$10,110.00' },
      ending: '$12,310.00',
      period: { text: '+$2,200.00', tone: 'positive' },
      peak: '$12,420.00',
      current: { amountText: '$110.00', percentageText: '0.89%', isZero: false },
      max: { amountText: '$787.00', percentageText: '6.84%', isZero: false },
      count: 64,
      points: 66,
    });
  });

  it('presents Visual — Populated 30D without ever implying it started at $10,000', () => {
    expect(presented(present('30d'))).toEqual({
      opening: { kind: 'carried', balanceText: '$11,270.00' },
      ending: '$12,310.00',
      period: { text: '+$1,040.00', tone: 'positive' },
      peak: '$12,420.00',
      current: { amountText: '$110.00', percentageText: '0.89%', isZero: false },
      max: { amountText: '$455.00', percentageText: '3.95%', isZero: false },
      count: 17,
      points: 19,
    });
  });

  /**
   * §27 — the misreading this whole section is built to prevent. The 30D
   * window's ending balance is D7A's, not "Starting Balance plus the period
   * P&L on screen", and the two differ by the $1,270 the range carried in.
   */
  it('makes the 30D window impossible to read as $10,000 growing to $12,310', () => {
    const view = present('30d');
    expect(view.opening.balanceText).toBe('$11,270.00');
    expect(view.opening.balanceText).not.toBe('$10,000.00');
    // 10,000 + 1,040 = 11,040, which is NOT what is displayed.
    expect(view.modeledBalanceText).toBe('$12,310.00');
    expect(view.points[0]?.balanceText).toBe('$11,270.00');
    expect(view.points.at(-1)?.balanceText).toBe('$12,310.00');
  });

  it('presents Visual — Empty as available at its starting balance, not as an error', () => {
    const view = present('all', []);
    expect(presented(view)).toEqual({
      opening: { kind: 'all', balanceText: '$10,000.00' },
      ending: '$10,000.00',
      period: { text: '$0.00', tone: 'neutral' },
      peak: '$10,000.00',
      current: { amountText: '$0.00', percentageText: '0.00%', isZero: true },
      max: { amountText: '$0.00', percentageText: '0.00%', isZero: true },
      count: 0,
      points: 2,
    });
    // Which is what suppresses the chart in favour of a compact available state.
    expect(view.hasClosedTrades).toBe(false);
  });

  it('carries the 10 partial-close positions as 10 presented balance steps, never 24', () => {
    const view = present('all');
    const closes = view.points.filter((point) => point.kind === 'trade_close');
    // 66 Trades over 68 points means the two anchors plus one step per
    // realization instant; no Exit leg becomes a step of its own.
    expect(closes).toHaveLength(66);
    expect(closes.reduce((total, point) => total + point.tradeCount, 0)).toBe(66);
  });
});
