import { describe, expect, it } from 'vitest';

import { CALC_FAILURE_REASONS, calcErr } from '@/lib/calc/types';

import {
  composeAnalyticsSnapshot,
  composeComparisonAnalytics,
  composeDashboardOverview,
  composeMistakeAnalytics,
  composeRuleAnalytics,
  composeSystemAnalytics,
  composeTraderAnalytics,
  toAnalyticsMetric,
  type AnalyticsScopeModel,
  type ComparisonMetricRecord,
  type MistakeMetricRecord,
  type SystemMetricRecord,
  type TraderMetricRecord,
} from './metrics';

const BASE_TIME = '2026-08-01T00:00:00.000Z';

function trader(
  tradeId: string,
  actualR: string,
  traderOutcome: 'win' | 'loss' | 'break_even',
  day = 1,
): TraderMetricRecord {
  return {
    tradeId,
    status: 'closed',
    deletedAt: null,
    actualR,
    traderOutcome,
    exitedAt: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  };
}

function system(
  tradeId: string,
  systemR: string,
  systemOutcome: 'win' | 'loss' | 'break_even',
  day = 1,
): SystemMetricRecord {
  return {
    tradeId,
    systemStatus: 'resolved',
    deletedAt: null,
    systemR,
    systemOutcome,
    systemExitedAt: `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`,
  };
}

const SCOPE: AnalyticsScopeModel = {
  datePreset: '90d',
  dateBounds: {
    kind: 'bounded',
    start: '2026-05-12T00:00:00.000Z',
    endExclusive: '2026-08-10T00:00:00.000Z',
  },
  accountScope: { kind: 'account', accountId: crypto.randomUUID(), source: 'active' },
  strategyId: null,
  setupId: null,
  strategyVersionId: null,
  timezone: 'UTC',
};

describe('analytics metric composition', () => {
  it('composes the canonical +3/-1/+2 Trader golden population', () => {
    const result = composeTraderAnalytics([
      trader('trade-a', '3.0000', 'win', 1),
      trader('trade-b', '-1.0000', 'loss', 2),
      trader('trade-c', '2.0000', 'win', 3),
    ]);

    expect(result.sampleCount).toBe(3);
    expect(result.totalR).toEqual({ status: 'available', value: '4.0000' });
    expect(result.averageR).toEqual({ status: 'available', value: '1.3333' });
    expect(result.expectancyR).toEqual(result.averageR);
    expect(result.winRate).toEqual({ status: 'available', value: '0.6667' });
    expect(result.averageWinR).toEqual({ status: 'available', value: '2.5000' });
    expect(result.averageLossR).toEqual({ status: 'available', value: '-1.0000' });
    expect(result.payoffRatio).toEqual({ status: 'available', value: '2.5000' });
    expect(result.profitFactor).toEqual({ status: 'available', value: '5.0000' });
    expect(result.maximumDrawdownR).toEqual({ status: 'available', value: '1.0000' });
    expect(result.equityCurve).toEqual({
      status: 'available',
      value: [
        { tradeId: 'trade-a', occurredAt: '2026-08-01T00:00:00.000Z', cumulativeR: '3.0000' },
        { tradeId: 'trade-b', occurredAt: '2026-08-02T00:00:00.000Z', cumulativeR: '2.0000' },
        { tradeId: 'trade-c', occurredAt: '2026-08-03T00:00:00.000Z', cumulativeR: '4.0000' },
      ],
    });
  });

  it('composes System independently and never inspects Trader execution status', () => {
    const input = [
      { ...system('open-trader', '3.0000', 'win'), status: 'open' },
      { ...system('canceled-trader', '-1.0000', 'loss', 2), status: 'canceled' },
      system('planned-trader', '2.0000', 'win', 3),
    ];
    const result = composeSystemAnalytics(input);
    expect(result.sampleCount).toBe(3);
    expect(result.totalR).toEqual({ status: 'available', value: '4.0000' });
    expect(result.averageR).toEqual(result.expectancyR);
  });

  it('defensively applies Trader and System eligibility without coercing excluded rows to zero', () => {
    const traderResult = composeTraderAnalytics([
      trader('eligible', '1.0000', 'win'),
      { ...trader('open', '8.0000', 'win'), status: 'open' },
      { ...trader('deleted', '8.0000', 'win'), deletedAt: new Date(BASE_TIME) },
      { ...trader('missing-r', '8.0000', 'win'), actualR: null },
    ]);
    const systemResult = composeSystemAnalytics([
      system('eligible', '2.0000', 'win'),
      { ...system('pending', '8.0000', 'win'), systemStatus: 'pending' },
      { ...system('no-trade', '8.0000', 'win'), systemStatus: 'no_trade' },
      { ...system('deleted', '8.0000', 'win'), deletedAt: new Date(BASE_TIME) },
    ]);
    expect(traderResult.sampleCount).toBe(1);
    expect(traderResult.totalR).toEqual({ status: 'available', value: '1.0000' });
    expect(systemResult.sampleCount).toBe(1);
    expect(systemResult.totalR).toEqual({ status: 'available', value: '2.0000' });
  });

  it('preserves canonical empty, all-win, all-loss, and exact-zero availability states', () => {
    const empty = composeTraderAnalytics([]);
    expect(empty.sampleCount).toBe(0);
    expect(empty.totalR).toEqual({ status: 'unavailable', reason: 'no_trades' });
    expect(empty.averageWinR).toEqual({ status: 'unavailable', reason: 'no_wins' });
    expect(empty.averageLossR).toEqual({ status: 'unavailable', reason: 'no_losses' });

    const allWins = composeTraderAnalytics([trader('a', '1.0000', 'win')]);
    expect(allWins.profitFactor).toEqual({ status: 'unavailable', reason: 'no_losses' });
    expect(allWins.maximumDrawdownR).toEqual({ status: 'available', value: '0.0000' });

    const allLosses = composeTraderAnalytics([trader('a', '-1.0000', 'loss')]);
    expect(allLosses.profitFactor).toEqual({ status: 'available', value: '0.0000' });
    expect(allLosses.averageWinR).toEqual({ status: 'unavailable', reason: 'no_wins' });

    const exactZero = composeTraderAnalytics([trader('a', '0.0000', 'break_even')]);
    expect(exactZero.totalR).toEqual({ status: 'available', value: '0.0000' });
    expect(exactZero.profitFactor).toEqual({
      status: 'unavailable',
      reason: 'no_profit_or_loss',
    });
  });

  it('keeps break-even outcomes in win-rate denominator while Profit Factor uses R sign', () => {
    const result = composeTraderAnalytics([
      trader('positive-small', '0.0300', 'break_even', 1),
      trader('negative-small', '-0.0100', 'break_even', 2),
      trader('win', '1.0000', 'win', 3),
    ]);
    expect(result.winRate).toEqual({ status: 'available', value: '0.3333' });
    expect(result.profitFactor).toEqual({ status: 'available', value: '103.0000' });
  });

  it('retains high precision until the Phase 07D final rounding boundary', () => {
    const result = composeTraderAnalytics([
      trader('a', '0.33335', 'win', 1),
      trader('b', '0.33335', 'win', 2),
      trader('c', '0.33335', 'win', 3),
    ]);
    expect(result.totalR).toEqual({ status: 'available', value: '1.0001' });
    expect(result.averageR).toEqual({ status: 'available', value: '0.3334' });
    expect(result.averageR).toEqual(result.expectancyR);
  });

  it('sanitizes malformed decimals and timestamps as data-integrity errors', () => {
    const invalidDecimal = composeTraderAnalytics([trader('a', 'NaN', 'win')]);
    expect(invalidDecimal.totalR).toEqual({
      status: 'error',
      reason: 'data_integrity_error',
    });
    const invalidTime = composeTraderAnalytics([
      { ...trader('a', '1.0000', 'win'), exitedAt: 'not-a-timestamp' },
    ]);
    expect(invalidTime.equityCurve).toEqual({
      status: 'error',
      reason: 'data_integrity_error',
    });
    expect(invalidTime.maximumDrawdownR).toEqual({
      status: 'error',
      reason: 'data_integrity_error',
    });
  });
});

describe('comparison composition', () => {
  const pair = (tradeId: string, systemR: string, actualR: string): ComparisonMetricRecord => ({
    tradeId,
    systemR,
    actualR,
  });

  it.each([
    ['3.0000', '2.0000', '1.0000'],
    ['3.0000', '-1.0000', '4.0000'],
    ['2.0000', '3.0000', '-1.0000'],
  ])('calculates System %s / Actual %s leakage as %s', (systemR, actualR, leakage) => {
    expect(composeComparisonAnalytics([pair('same-trade', systemR, actualR)]).edgeLeakageR).toEqual(
      {
        status: 'available',
        value: leakage,
      },
    );
  });

  it('calculates paired totals and efficiency from the exact same IDs', () => {
    const result = composeComparisonAnalytics([
      pair('trade-a', '6.0000', '5.0000'),
      pair('trade-b', '4.0000', '3.0000'),
      { tradeId: 'incomplete', systemR: '100.0000', actualR: null },
    ]);
    expect(result.comparableCount).toBe(2);
    expect(result.pairedSystemTotalR).toEqual({ status: 'available', value: '10.0000' });
    expect(result.pairedActualTotalR).toEqual({ status: 'available', value: '8.0000' });
    expect(result.edgeLeakageR).toEqual({ status: 'available', value: '2.0000' });
    expect(result.executionEfficiency).toEqual({ status: 'available', value: '0.8000' });
  });

  it('preserves efficiency above one and below zero without clamping', () => {
    expect(
      composeComparisonAnalytics([pair('above', '2.0000', '3.0000')]).executionEfficiency,
    ).toEqual({ status: 'available', value: '1.5000' });
    expect(
      composeComparisonAnalytics([pair('negative', '2.0000', '-1.0000')]).executionEfficiency,
    ).toEqual({ status: 'available', value: '-0.5000' });
  });

  it('distinguishes no comparison from a non-positive System edge', () => {
    const empty = composeComparisonAnalytics([]);
    expect(empty.comparableCount).toBe(0);
    for (const metric of [
      empty.pairedSystemTotalR,
      empty.pairedActualTotalR,
      empty.edgeLeakageR,
      empty.executionEfficiency,
    ]) {
      expect(metric).toEqual({ status: 'unavailable', reason: 'no_comparable_trades' });
    }
    expect(
      composeComparisonAnalytics([pair('zero', '0.0000', '1.0000')]).executionEfficiency,
    ).toEqual({ status: 'unavailable', reason: 'system_has_no_edge' });
    expect(
      composeComparisonAnalytics([pair('loss', '-1.0000', '1.0000')]).executionEfficiency,
    ).toEqual({ status: 'unavailable', reason: 'system_has_no_edge' });
  });
});

describe('rule and mistake composition', () => {
  it('composes objective Rule counts and adherence from evaluated checks only', () => {
    const checks = [
      ...Array.from({ length: 8 }, () => ({ checkStatus: 'followed' as const })),
      ...Array.from({ length: 2 }, () => ({ checkStatus: 'violated' as const })),
      { checkStatus: 'not_applicable' as const },
      { checkStatus: 'not_checked' as const },
    ];
    expect(composeRuleAnalytics(checks)).toEqual({
      followedCount: 8,
      violatedCount: 2,
      notCheckedCount: 1,
      notApplicableCount: 1,
      evaluatedCount: 10,
      adherenceRate: { status: 'available', value: '0.8000' },
    });
  });

  it.each([
    ['all followed', ['followed', 'followed'], '1.0000'],
    ['all violated', ['violated', 'violated'], '0.0000'],
  ] as const)('%s has a defined adherence rate', (_name, statuses, expected) => {
    expect(
      composeRuleAnalytics(statuses.map((checkStatus) => ({ checkStatus }))).adherenceRate,
    ).toEqual({ status: 'available', value: expected });
  });

  it.each([
    ['not_checked'],
    ['not_applicable'],
    ['not_checked', 'not_applicable', 'future_status'],
  ])('returns no_rule_checks for unevaluated statuses %s', (...statuses) => {
    expect(
      composeRuleAnalytics(statuses.map((checkStatus) => ({ checkStatus }))).adherenceRate,
    ).toEqual({
      status: 'unavailable',
      reason: 'no_rule_checks',
    });
  });

  it('counts unique Trade/type pairs and sorts by count then canonical key', () => {
    const typeA = crypto.randomUUID();
    const typeB = crypto.randomUUID();
    const typeC = crypto.randomUUID();
    const records: MistakeMetricRecord[] = [
      { tradeId: 't1', mistakeTypeId: typeB, key: 'zeta', label: 'Zeta' },
      { tradeId: 't2', mistakeTypeId: typeB, key: 'zeta', label: 'Zeta' },
      { tradeId: 't1', mistakeTypeId: typeA, key: 'alpha', label: 'Alpha' },
      { tradeId: 't1', mistakeTypeId: typeA, key: 'alpha', label: 'Alpha' },
      { tradeId: 't3', mistakeTypeId: typeC, key: 'beta', label: 'Beta' },
    ];
    expect(composeMistakeAnalytics(records)).toEqual([
      { mistakeTypeId: typeB, key: 'zeta', label: 'Zeta', tradeCount: 2 },
      { mistakeTypeId: typeA, key: 'alpha', label: 'Alpha', tradeCount: 1 },
      { mistakeTypeId: typeC, key: 'beta', label: 'Beta', tradeCount: 1 },
    ]);
    expect(composeMistakeAnalytics([])).toEqual([]);
    expect(JSON.stringify(composeMistakeAnalytics(records))).not.toMatch(
      /actualR|systemR|leakage|cost|severity|weight/i,
    );
  });
});

describe('failure mapping and full projections', () => {
  it('classifies every CalcFailureReason exhaustively and sanitizes integrity failures', () => {
    const expectedUnavailable = new Set([
      'no_trades',
      'no_wins',
      'no_losses',
      'no_profit_or_loss',
      'no_comparable_trades',
      'system_has_no_edge',
      'no_rule_checks',
    ]);
    expect(CALC_FAILURE_REASONS).toHaveLength(17);
    for (const reason of CALC_FAILURE_REASONS) {
      const mapped = toAnalyticsMetric(calcErr(reason));
      if (expectedUnavailable.has(reason)) {
        expect(mapped).toEqual({ status: 'unavailable', reason });
      } else {
        expect(mapped).toEqual({ status: 'error', reason: 'data_integrity_error' });
      }
    }
  });

  it('keeps divergent System-win/Trader-loss outcomes independent and comparable', () => {
    const snapshot = composeAnalyticsSnapshot({
      scope: SCOPE,
      trader: [trader('divergent', '-1.0000', 'loss')],
      system: [system('divergent', '3.0000', 'win')],
      comparison: [{ tradeId: 'divergent', actualR: '-1.0000', systemR: '3.0000' }],
      rules: [],
      mistakes: [],
    });
    expect(snapshot.trader.winRate).toEqual({ status: 'available', value: '0.0000' });
    expect(snapshot.system.winRate).toEqual({ status: 'available', value: '1.0000' });
    expect(snapshot.comparison.edgeLeakageR).toEqual({ status: 'available', value: '4.0000' });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('creates a concise Dashboard overview by reference without recalculation', () => {
    const snapshot = composeAnalyticsSnapshot({
      scope: SCOPE,
      trader: [trader('t', '1.0000', 'win')],
      system: [system('t', '2.0000', 'win')],
      comparison: [{ tradeId: 't', actualR: '1.0000', systemR: '2.0000' }],
      rules: [],
      mistakes: [],
    });
    const overview = composeDashboardOverview(snapshot);
    expect(overview.trader.totalR).toBe(snapshot.trader.totalR);
    expect(overview.system.expectancyR).toBe(snapshot.system.expectancyR);
    expect(overview.comparison).toBe(snapshot.comparison);
    expect(overview.trader).not.toHaveProperty('averageWinR');
    expect(overview.system).not.toHaveProperty('equityCurve');
    expect(overview).not.toHaveProperty('rules');
    expect(overview).not.toHaveProperty('mistakes');
  });
});
