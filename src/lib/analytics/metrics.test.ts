import { describe, expect, it } from 'vitest';

import { CALC_FAILURE_REASONS, calcErr } from '@/lib/calc/types';

import {
  composeAnalyticsSnapshot,
  composeComparisonAnalytics,
  composeConditionAnalytics,
  composeConfidenceAnalytics,
  composeContextBreakdown,
  composeDashboardOverview,
  composeEmotionAnalytics,
  composeMistakeAnalytics,
  composeRuleAnalytics,
  composeSetupAdherenceAnalytics,
  composeSetupPerformance,
  composeStrategyPerformance,
  composeSystemAnalytics,
  composeTraderAnalytics,
  toAnalyticsMetric,
  type AnalyticsScopeModel,
  type ComparisonMetricRecord,
  type ConditionMetricRecord,
  type ConfidenceMetricRecord,
  type ContextMetricRecord,
  type EmotionMetricRecord,
  type FrameworkMetricRecord,
  type MistakeMetricRecord,
  type SetupAdherenceMetricRecord,
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
    ['3.0000', '2.0000', '-1.0000'],
    ['3.0000', '-1.0000', '-4.0000'],
    ['2.0000', '3.0000', '1.0000'],
  ])('calculates System %s / Actual %s gap as %s', (systemR, actualR, gap) => {
    const result = composeComparisonAnalytics([pair('same-trade', systemR, actualR)]);
    expect(result.executionGapR).toEqual({ status: 'available', value: gap });
    expect(result.averageExecutionGapR).toEqual({ status: 'available', value: gap });
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
    expect(result.executionGapR).toEqual({ status: 'available', value: '-2.0000' });
    expect(result.averageExecutionGapR).toEqual({ status: 'available', value: '-1.0000' });
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
      empty.executionGapR,
      empty.averageExecutionGapR,
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
      'no_conditions_applicable',
      'no_confidence_recorded',
    ]);
    expect(CALC_FAILURE_REASONS).toHaveLength(24);
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
      systemPendingCount: 0,
      comparison: [{ tradeId: 'divergent', actualR: '-1.0000', systemR: '3.0000' }],
      rules: [],
      mistakes: [],
      setupAdherence: [],
      setupAdherenceSystem: [],
      conditions: [],
      conditionsSystem: [],
      confidence: [],
      confidenceSystem: [],
      emotions: [],
      emotionsSystem: [],
      frameworkTrader: [],
      frameworkSystem: [],
      contextSymbol: [],
      contextDirection: [],
      contextSession: [],
      contextTimeframe: [],
    });
    expect(snapshot.trader.winRate).toEqual({ status: 'available', value: '0.0000' });
    expect(snapshot.system.winRate).toEqual({ status: 'available', value: '1.0000' });
    expect(snapshot.comparison.executionGapR).toEqual({ status: 'available', value: '-4.0000' });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
  });

  it('creates a concise Dashboard overview by reference without recalculation', () => {
    const snapshot = composeAnalyticsSnapshot({
      scope: SCOPE,
      trader: [trader('t', '1.0000', 'win')],
      system: [system('t', '2.0000', 'win')],
      systemPendingCount: 3,
      comparison: [{ tradeId: 't', actualR: '1.0000', systemR: '2.0000' }],
      rules: [],
      mistakes: [],
      setupAdherence: [],
      setupAdherenceSystem: [],
      conditions: [],
      conditionsSystem: [],
      confidence: [],
      confidenceSystem: [],
      emotions: [],
      emotionsSystem: [],
      frameworkTrader: [],
      frameworkSystem: [],
      contextSymbol: [],
      contextDirection: [],
      contextSession: [],
      contextTimeframe: [],
    });
    const overview = composeDashboardOverview(snapshot);
    expect(overview.trader.totalR).toBe(snapshot.trader.totalR);
    expect(overview.system.expectancyR).toBe(snapshot.system.expectancyR);
    expect(overview.comparison).toBe(snapshot.comparison);
    expect(overview.systemPendingCount).toBe(3);
    expect(overview.trader).not.toHaveProperty('averageWinR');
    expect(overview.system).not.toHaveProperty('equityCurve');
    expect(overview).not.toHaveProperty('rules');
    expect(overview).not.toHaveProperty('mistakes');
  });
});

describe('Phase 13H — Setup Adherence composition (independent Trader/System)', () => {
  function adherence(
    tradeId: string,
    metCount: number,
    totalCount: number,
    r: string,
    outcome: 'win' | 'loss' | 'break_even',
  ): SetupAdherenceMetricRecord {
    return { tradeId, metCount, totalCount, r, outcome };
  }

  it('averages per-Trade adherence (50% + 90% => 70%), distinct from Conditions Met Rate (10/12 => 83.33%), over the Trader population', () => {
    const result = composeSetupAdherenceAnalytics(
      [adherence('a', 1, 2, '1.0000', 'win'), adherence('b', 9, 10, '1.0000', 'win')],
      [],
    );
    expect(result.sampleCount).toBe(2);
    expect(result.averageAdherence).toEqual({ status: 'available', value: '0.7000' });
    expect(result.conditionsMetRate).toEqual({ status: 'available', value: '0.8333' });
  });

  it('excludes Trades with zero applicable Conditions, never coercing to 0%', () => {
    const result = composeSetupAdherenceAnalytics([], []);
    expect(result.sampleCount).toBe(0);
    expect(result.averageAdherence).toEqual({
      status: 'unavailable',
      reason: 'no_conditions_applicable',
    });
    expect(result.conditionsMetRate).toEqual({
      status: 'unavailable',
      reason: 'no_conditions_applicable',
    });
  });

  it('buckets each Trade by its own adherence ratio and reports independent Trader/System Avg R and Win Rate per bucket', () => {
    const result = composeSetupAdherenceAnalytics(
      [
        adherence('full', 5, 5, '2.0000', 'win'),
        adherence('full-2', 4, 4, '4.0000', 'win'),
        adherence('none', 0, 4, '-1.0000', 'loss'),
      ],
      [adherence('sys-full', 5, 5, '9.0000', 'win')],
    );
    const full = result.buckets.find((b) => b.bucket === '100');
    const zero = result.buckets.find((b) => b.bucket === '0-24');
    expect(full?.trader).toEqual({
      tradeCount: 2,
      averageR: { status: 'available', value: '3.0000' },
      winRate: { status: 'available', value: '1.0000' },
    });
    // The System population is entirely separate from the Trader one —
    // a different Trade count and value, never merged or intersected.
    expect(full?.system).toEqual({
      tradeCount: 1,
      averageR: { status: 'available', value: '9.0000' },
      winRate: { status: 'available', value: '1.0000' },
    });
    expect(zero?.trader.tradeCount).toBe(1);
    expect(zero?.system.tradeCount).toBe(0);
    expect(zero?.system.averageR).toEqual({ status: 'unavailable', reason: 'no_trades' });
    expect(result.buckets).toHaveLength(5);
  });

  it('a System-resolved Trade with a still partial/open Actual position appears only in the System bucket, never the Trader one', () => {
    const result = composeSetupAdherenceAnalytics(
      [],
      [adherence('partial-open', 3, 4, '5.0000', 'win')],
    );
    const bucket = result.buckets.find((b) => b.bucket === '75-99');
    expect(bucket?.trader.tradeCount).toBe(0);
    expect(bucket?.system.tradeCount).toBe(1);
    // The Trader-scoped primary/secondary metrics stay unavailable — this
    // Trade never contributes to them, since it is Trader-ineligible.
    expect(result.sampleCount).toBe(0);
    expect(result.averageAdherence).toEqual({
      status: 'unavailable',
      reason: 'no_conditions_applicable',
    });
  });
});

describe('Phase 13H — Condition-level composition (independent Trader/System)', () => {
  function condition(
    tradeId: string,
    setupId: string,
    conditionKey: string,
    label: string,
    checkStatus: 'met' | 'not_met',
    r: string,
    outcome: 'win' | 'loss' | 'break_even',
    occurredAt: string,
  ): ConditionMetricRecord {
    return { tradeId, setupId, conditionKey, label, checkStatus, r, outcome, occurredAt };
  }

  it('groups by (setupId, conditionKey), separating Met from Not Met performance independently per axis', () => {
    const result = composeConditionAnalytics(
      [
        condition(
          't1',
          's1',
          'c1',
          'Above 200 EMA',
          'met',
          '2.0000',
          'win',
          '2026-08-01T00:00:00Z',
        ),
        condition(
          't2',
          's1',
          'c1',
          'Above 200 EMA',
          'met',
          '4.0000',
          'win',
          '2026-08-02T00:00:00Z',
        ),
        condition(
          't3',
          's1',
          'c1',
          'Above 200 EMA',
          'not_met',
          '-2.0000',
          'loss',
          '2026-08-03T00:00:00Z',
        ),
      ],
      [
        condition(
          't4',
          's1',
          'c1',
          'Above 200 EMA',
          'met',
          '9.0000',
          'win',
          '2026-08-04T00:00:00Z',
        ),
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.trader.met).toEqual({
      tradeCount: 2,
      averageR: { status: 'available', value: '3.0000' },
      winRate: { status: 'available', value: '1.0000' },
    });
    expect(result[0]?.trader.notMet).toEqual({
      tradeCount: 1,
      averageR: { status: 'available', value: '-2.0000' },
      winRate: { status: 'available', value: '0.0000' },
    });
    // System side is entirely independent — a different Trade (t4, absent
    // from the Trader population), a different value.
    expect(result[0]?.system.met).toEqual({
      tradeCount: 1,
      averageR: { status: 'available', value: '9.0000' },
      winRate: { status: 'available', value: '1.0000' },
    });
    expect(result[0]?.system.notMet.tradeCount).toBe(0);
  });

  it('does NOT require the same Trade to have both Actual and System results — a System-only row still forms/joins a group', () => {
    const result = composeConditionAnalytics(
      [],
      [
        condition(
          't1',
          's1',
          'c1',
          'Above 200 EMA',
          'met',
          '9.0000',
          'win',
          '2026-08-01T00:00:00Z',
        ),
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.trader.met.tradeCount).toBe(0);
    expect(result[0]?.trader.notMet.tradeCount).toBe(0);
    expect(result[0]?.system.met.tradeCount).toBe(1);
  });

  it('the same condition_key on two different Setups never merges into one group', () => {
    const result = composeConditionAnalytics(
      [
        condition(
          't1',
          'setup-a',
          'shared-key',
          'Label A',
          'met',
          '1.0000',
          'win',
          '2026-08-01T00:00:00Z',
        ),
        condition(
          't2',
          'setup-b',
          'shared-key',
          'Label B',
          'met',
          '2.0000',
          'win',
          '2026-08-01T00:00:00Z',
        ),
      ],
      [],
    );
    expect(result).toHaveLength(2);
  });

  it('uses the most-recent-by-exit label across BOTH axes for a Condition whose label changed across Setup Versions', () => {
    const result = composeConditionAnalytics(
      [condition('t1', 's1', 'c1', 'Old label', 'met', '1.0000', 'win', '2026-08-01T00:00:00Z')],
      [
        condition(
          't2',
          's1',
          'c1',
          'Renamed label',
          'met',
          '1.0000',
          'win',
          '2026-08-05T00:00:00Z',
        ),
      ],
    );
    expect(result[0]?.label).toBe('Renamed label');
  });
});

describe('Phase 13H — Confidence composition (independent Trader/System)', () => {
  function confidence(
    tradeId: string,
    value: number,
    r: string,
    outcome: 'win' | 'loss' | 'break_even',
  ): ConfidenceMetricRecord {
    return { tradeId, confidence: value, r, outcome };
  }

  it('averages only recorded Confidence over the Trader population — NULL Trades are never fed in, and 0 is a real recorded value', () => {
    const result = composeConfidenceAnalytics(
      [confidence('a', 0, '-1.0000', 'loss'), confidence('b', 100, '3.0000', 'win')],
      [],
    );
    expect(result.sampleCount).toBe(2);
    // (0/100 + 100/100) / 2 = 0.5000
    expect(result.averageConfidence).toEqual({ status: 'available', value: '0.5000' });
    const zeroLevel = result.levels.find((l) => l.level === 0);
    expect(zeroLevel?.trader.tradeCount).toBe(1);
    expect(zeroLevel?.trader.averageR).toEqual({ status: 'available', value: '-1.0000' });
  });

  it('an empty Trader population is no_confidence_recorded, never a fake 0%, independent of the System population', () => {
    const result = composeConfidenceAnalytics([], [confidence('a', 75, '5.0000', 'win')]);
    expect(result.averageConfidence).toEqual({
      status: 'unavailable',
      reason: 'no_confidence_recorded',
    });
    expect(result.levels.every((level) => level.trader.tradeCount === 0)).toBe(true);
    const level75 = result.levels.find((l) => l.level === 75);
    expect(level75?.system.tradeCount).toBe(1);
    expect(level75?.system.averageR).toEqual({ status: 'available', value: '5.0000' });
  });

  it('a System-resolved Trade whose Actual position is still partial/open appears only in the System level, never the Trader one', () => {
    const result = composeConfidenceAnalytics(
      [confidence('closed', 50, '1.0000', 'win')],
      [confidence('closed', 50, '2.0000', 'win'), confidence('partial-open', 75, '4.0000', 'win')],
    );
    const level50 = result.levels.find((l) => l.level === 50);
    const level75 = result.levels.find((l) => l.level === 75);
    expect(level50?.trader.tradeCount).toBe(1);
    expect(level50?.system.tradeCount).toBe(1);
    expect(level75?.trader.tradeCount).toBe(0);
    expect(level75?.system.tradeCount).toBe(1);
  });
});

describe('Phase 13H — Emotion composition (independent Trader/System)', () => {
  function emotion(
    tradeId: string,
    key: string,
    label: string,
    r: string,
    outcome: 'win' | 'loss' | 'break_even',
  ): EmotionMetricRecord {
    return { tradeId, key, label, r, outcome };
  }

  it('a multi-Emotion Trade belongs to every one of its Emotion groups, on whichever axis it is eligible for', () => {
    const result = composeEmotionAnalytics(
      [
        emotion('t1', 'fearful', 'Fearful', '-1.0000', 'loss'),
        emotion('t1', 'hesitant', 'Hesitant', '-1.0000', 'loss'),
      ],
      [],
    );
    expect(result).toHaveLength(2);
    expect(result.find((g) => g.key === 'fearful')?.trader.tradeCount).toBe(1);
    expect(result.find((g) => g.key === 'hesitant')?.trader.tradeCount).toBe(1);
    // The same Trade counted once per group is expected, not a duplicate bug —
    // the sum across groups (2) legitimately exceeds the unique Trade count (1).
  });

  it('a recorded-zero-selection Trade and a never-recorded Trade both contribute no Emotion group on either axis (no rows reach this function)', () => {
    const result = composeEmotionAnalytics([], []);
    expect(result).toEqual([]);
  });

  it('a System-only Emotion group (no Trader rows at all) still renders truthfully with a zero Trader sample, never a fake merge', () => {
    const result = composeEmotionAnalytics(
      [],
      [emotion('t1', 'fearful', 'Fearful', '5.0000', 'win')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.trader).toEqual({
      tradeCount: 0,
      averageR: { status: 'unavailable', reason: 'no_trades' },
      winRate: { status: 'unavailable', reason: 'no_trades' },
    });
    expect(result[0]?.system.tradeCount).toBe(1);
  });

  it('ranks groups by combined Trader+System Trade count, then canonical key', () => {
    const result = composeEmotionAnalytics(
      [
        emotion('t1', 'calm', 'Calm', '1.0000', 'win'),
        emotion('t2', 'fomo', 'FOMO', '-1.0000', 'loss'),
      ],
      [emotion('t3', 'fomo', 'FOMO', '-2.0000', 'loss')],
    );
    expect(result.map((g) => g.key)).toEqual(['fomo', 'calm']);
  });
});

// ---------------------------------------------------------------------------
// Phase 15D — Strategy / Setup Performance, Context breakdowns
// ---------------------------------------------------------------------------

function framework(
  tradeId: string,
  strategyId: string | null,
  setupId: string | null,
  r: string,
  outcome: 'win' | 'loss' | 'break_even',
): FrameworkMetricRecord {
  return { tradeId, strategyId, setupId, r, outcome };
}

describe('composeStrategyPerformance', () => {
  it('excludes unclassified Trades from grouping but discloses them as coverage, never an "Unknown Strategy" bucket', () => {
    const result = composeStrategyPerformance(
      [
        framework('t1', 'strategy-a', 'setup-a', '1.0000', 'win'),
        framework('t2', null, null, '2.0000', 'win'),
      ],
      [],
    );
    expect(result.strategies).toHaveLength(1);
    expect(result.strategies[0]?.strategyId).toBe('strategy-a');
    expect(result.classifiedTraderCount).toBe(1);
    expect(result.unclassifiedTraderCount).toBe(1);
    expect(result.strategies.some((s) => s.strategyId === 'unknown')).toBe(false);
  });

  it('preserves independent Trader and System populations — a Strategy present only on one axis is not fabricated on the other', () => {
    const result = composeStrategyPerformance(
      [framework('t1', 'strategy-a', null, '1.0000', 'win')],
      [framework('t2', 'strategy-b', null, '3.0000', 'win')],
    );
    const a = result.strategies.find((s) => s.strategyId === 'strategy-a');
    const b = result.strategies.find((s) => s.strategyId === 'strategy-b');
    expect(a?.trader.tradeCount).toBe(1);
    expect(a?.system.tradeCount).toBe(0);
    expect(b?.trader.tradeCount).toBe(0);
    expect(b?.system.tradeCount).toBe(1);
  });

  it('ranks by Trader average R descending — the "Best observed" measure, not raw Total R', () => {
    const result = composeStrategyPerformance(
      [
        // strategy-many: 3 Trades averaging +1.0R (lower avg, higher total)
        framework('t1', 'strategy-many', null, '2.0000', 'win'),
        framework('t2', 'strategy-many', null, '2.0000', 'win'),
        framework('t3', 'strategy-many', null, '-1.0000', 'loss'),
        // strategy-few: 1 Trade at +1.5R (higher avg, lower total)
        framework('t4', 'strategy-few', null, '1.5000', 'win'),
      ],
      [],
    );
    expect(result.strategies.map((s) => s.strategyId)).toEqual(['strategy-few', 'strategy-many']);
  });

  it('breaks a tied average R by higher Trader Trade count', () => {
    const result = composeStrategyPerformance(
      [
        framework('t1', 'strategy-a', null, '1.0000', 'win'),
        framework('t2', 'strategy-b', null, '1.0000', 'win'),
        framework('t3', 'strategy-b', null, '1.0000', 'win'),
      ],
      [],
    );
    expect(result.strategies.map((s) => s.strategyId)).toEqual(['strategy-b', 'strategy-a']);
  });

  it('breaks a fully tied average R and Trade count deterministically by id, never DB row order', () => {
    const result = composeStrategyPerformance(
      [
        framework('t1', 'strategy-z', null, '1.0000', 'win'),
        framework('t2', 'strategy-a', null, '1.0000', 'win'),
      ],
      [],
    );
    expect(result.strategies.map((s) => s.strategyId)).toEqual(['strategy-a', 'strategy-z']);
  });

  it('returns an empty ranking with zero coverage for no data', () => {
    const result = composeStrategyPerformance([], []);
    expect(result).toEqual({
      strategies: [],
      classifiedTraderCount: 0,
      unclassifiedTraderCount: 0,
      classifiedSystemCount: 0,
      unclassifiedSystemCount: 0,
    });
  });

  it('handles a single classified Strategy without error', () => {
    const result = composeStrategyPerformance(
      [framework('t1', 'strategy-a', null, '1.0000', 'win')],
      [],
    );
    expect(result.strategies).toHaveLength(1);
  });
});

describe('composeSetupPerformance', () => {
  it('resolves the owning Strategy id for each Setup from whichever axis first supplies it', () => {
    const result = composeSetupPerformance(
      [framework('t1', 'strategy-a', 'setup-a', '1.0000', 'win')],
      [],
    );
    expect(result.setups[0]).toMatchObject({ setupId: 'setup-a', strategyId: 'strategy-a' });
  });

  it('excludes Trades without a Setup from grouping but discloses coverage', () => {
    const result = composeSetupPerformance(
      [
        framework('t1', 'strategy-a', 'setup-a', '1.0000', 'win'),
        framework('t2', 'strategy-a', null, '2.0000', 'win'),
      ],
      [],
    );
    expect(result.setups).toHaveLength(1);
    expect(result.classifiedTraderCount).toBe(1);
    expect(result.unclassifiedTraderCount).toBe(1);
  });

  it('ranks by Trader average R descending, same discipline as Strategy ranking', () => {
    const result = composeSetupPerformance(
      [
        framework('t1', 'strategy-a', 'setup-low', '0.5000', 'win'),
        framework('t2', 'strategy-a', 'setup-high', '2.0000', 'win'),
      ],
      [],
    );
    expect(result.setups.map((s) => s.setupId)).toEqual(['setup-high', 'setup-low']);
  });
});

describe('composeContextBreakdown', () => {
  function contextRecord(
    tradeId: string,
    value: string | null,
    r: string,
    outcome: 'win' | 'loss' | 'break_even',
  ): ContextMetricRecord {
    return { tradeId, value, r, outcome };
  }

  it('groups by value and separately discloses recorded vs missing coverage', () => {
    const result = composeContextBreakdown([
      contextRecord('t1', 'XAUUSD', '1.0000', 'win'),
      contextRecord('t2', 'XAUUSD', '1.0000', 'win'),
      contextRecord('t3', null, '0.0000', 'break_even'),
    ]);
    expect(result.recordedCount).toBe(2);
    expect(result.missingCount).toBe(1);
    expect(result.groups).toEqual([
      {
        value: 'XAUUSD',
        trader: {
          tradeCount: 2,
          averageR: { status: 'available', value: '1.0000' },
          winRate: { status: 'available', value: '1.0000' },
        },
      },
    ]);
  });

  it('never creates a group for a missing value', () => {
    const result = composeContextBreakdown([contextRecord('t1', null, '1.0000', 'win')]);
    expect(result.groups).toEqual([]);
    expect(result.missingCount).toBe(1);
  });

  it('sorts groups by Trade count descending, then value ascending — coverage-first, not a performance ranking', () => {
    const result = composeContextBreakdown([
      contextRecord('t1', 'BTCUSD', '1.0000', 'win'),
      contextRecord('t2', 'XAUUSD', '5.0000', 'win'),
      contextRecord('t3', 'XAUUSD', '5.0000', 'win'),
      contextRecord('t4', 'EURUSD', '1.0000', 'win'),
      contextRecord('t5', 'EURUSD', '1.0000', 'win'),
    ]);
    expect(result.groups.map((g) => g.value)).toEqual(['EURUSD', 'XAUUSD', 'BTCUSD']);
  });

  it('returns no groups and zero coverage for an empty population', () => {
    expect(composeContextBreakdown([])).toEqual({ groups: [], recordedCount: 0, missingCount: 0 });
  });
});
