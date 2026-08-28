import { describe, expect, it } from 'vitest';

import type { OutcomeValue } from '@/lib/trades/constants';

import {
  composeDashboardInsights,
  INSIGHT_PILLAR_WIDGET_IDS,
  INSIGHT_SELECTION_POLICY,
  type ComposeDashboardInsightsInput,
  type InsightActualTradeInput,
  type InsightRuleCheckInput,
  type InsightSystemTradeInput,
} from './insight-pillars';

const BASE_SCOPE = {
  datePreset: 'all' as const,
  dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
  accountScope: { kind: 'all' as const },
  strategyId: null,
  setupId: null,
  strategyVersionId: null,
};

function outcome(r: string): OutcomeValue {
  const value = Number(r);
  return value > 0 ? 'win' : value < 0 ? 'loss' : 'break_even';
}

function actual(
  index: number,
  overrides: Partial<InsightActualTradeInput> = {},
): InsightActualTradeInput {
  const actualR = overrides.actualR ?? '0.5000';
  return {
    tradeId: `trade-${index}`,
    actualR,
    traderOutcome: outcome(actualR),
    actualExitedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    systemR: actualR,
    systemOutcome: outcome(actualR),
    systemExitedAt: new Date(Date.UTC(2026, 0, index + 1, 1)).toISOString(),
    strategyId: 'strategy-a',
    strategyLabel: 'Strategy A v1',
    setupId: 'setup-a',
    setupLabel: 'Setup A v1',
    confidence: 50,
    ...overrides,
  };
}

function systemFrom(trade: InsightActualTradeInput): InsightSystemTradeInput {
  return {
    tradeId: trade.tradeId,
    systemR: trade.systemR ?? trade.actualR,
    systemOutcome: trade.systemOutcome ?? trade.traderOutcome,
    systemExitedAt: trade.systemExitedAt ?? trade.actualExitedAt,
    strategyId: trade.strategyId,
    strategyLabel: trade.strategyLabel,
    setupId: trade.setupId,
    setupLabel: trade.setupLabel,
  };
}

function input(
  actualTrades: readonly InsightActualTradeInput[],
  overrides: Partial<ComposeDashboardInsightsInput> = {},
): ComposeDashboardInsightsInput {
  return {
    scope: BASE_SCOPE,
    actualTrades,
    systemTrades: actualTrades.map(systemFrom),
    emotions: [],
    ruleChecks: [],
    mistakes: [],
    ...overrides,
  };
}

function checksFor(
  trades: readonly InsightActualTradeInput[],
  status: InsightRuleCheckInput['checkStatus'],
  suffix = 'risk',
): InsightRuleCheckInput[] {
  return trades.map((trade) => ({
    tradeId: trade.tradeId,
    ruleKey: `rule-${suffix}`,
    title: `Rule ${suffix}`,
    checkStatus: status,
    isRequired: true,
    occurredAt: trade.actualExitedAt,
  }));
}

function requireData(value: ReturnType<typeof composeDashboardInsights>) {
  expect(value.status).toBe('available');
  if (value.status !== 'available') throw new Error(value.reason);
  return value;
}

describe('D8A shared contract', () => {
  it('returns three localization-ready widget identities and explicit non-causal limits', () => {
    const data = requireData(composeDashboardInsights(input([])));
    expect(data.widgets).toEqual(INSIGHT_PILLAR_WIDGET_IDS);
    expect(data.policy).toEqual(INSIGHT_SELECTION_POLICY);
    expect(data.semantics).toEqual({
      mode: 'descriptive_association_not_causation',
      unsupported: [
        'discipline_score',
        'mistake_cost_attribution',
        'emotion_cost_attribution',
        'fear_exit_cost',
        'early_exit_cost',
      ],
    });
    expect(JSON.stringify(data)).not.toContain('caused');
  });

  it('keeps empty pillars intentional and distinct from integrity errors', () => {
    const data = requireData(composeDashboardInsights(input([])));
    expect(data.strategy.status).toBe('no_eligible_trades');
    expect(data.psychology.status).toBe('no_eligible_trades');
    expect(data.discipline.status).toBe('no_eligible_trades');
  });

  it('fails malformed and duplicate Trade input explicitly', () => {
    const duplicate = actual(0);
    expect(composeDashboardInsights(input([duplicate, duplicate]))).toMatchObject({
      status: 'integrity_error',
      reason: 'duplicate_trade',
    });
    expect(composeDashboardInsights(input([actual(0, { confidence: 33 })]))).toMatchObject({
      status: 'integrity_error',
      reason: 'invalid_confidence',
    });
  });
});

describe('Strategy pillar', () => {
  it('rejects a one-Trade false winner and ranks supported System expectancy', () => {
    const supported = Array.from({ length: 40 }, (_, index) =>
      actual(index, {
        strategyId: 'strategy-supported',
        strategyLabel: 'Supported',
        systemR: '0.5000',
        systemOutcome: 'win',
      }),
    );
    const anecdote = actual(40, {
      strategyId: 'strategy-anecdote',
      strategyLabel: 'Anecdote',
      actualR: '5.0000',
      traderOutcome: 'win',
      systemR: '5.0000',
      systemOutcome: 'win',
    });
    const data = requireData(composeDashboardInsights(input([...supported, anecdote])));
    expect(data.strategy.status).toBe('available');
    expect(data.strategy.primaryInsight?.subject).toMatchObject({
      kind: 'strategy',
      id: 'strategy-supported',
    });
  });

  it('prioritizes material paired System-vs-Actual divergence', () => {
    const trades = Array.from({ length: 20 }, (_, index) =>
      actual(index, {
        actualR: '0.2500',
        traderOutcome: 'win',
        systemR: '1.0000',
        systemOutcome: 'win',
      }),
    );
    const data = requireData(composeDashboardInsights(input(trades)));
    expect(data.strategy.primaryInsight).toMatchObject({
      type: 'system_actual_divergence',
      basis: 'paired_execution_gap',
      metrics: { averageExecutionGapR: { status: 'available', value: '-0.7500' } },
    });
  });

  it('uses selected Strategy health as primary and Setup as its breakdown', () => {
    const trades = Array.from({ length: 40 }, (_, index) =>
      actual(index, {
        setupId: index < 20 ? 'setup-a' : 'setup-b',
        setupLabel: index < 20 ? 'Setup A' : 'Setup B',
        actualR: index < 20 ? '0.5000' : '-0.2500',
        traderOutcome: index < 20 ? 'win' : 'loss',
        systemR: index < 20 ? '0.5000' : '-0.2500',
        systemOutcome: index < 20 ? 'win' : 'loss',
      }),
    );
    const data = requireData(
      composeDashboardInsights(
        input(trades, { scope: { ...BASE_SCOPE, strategyId: 'strategy-a' } }),
      ),
    );
    expect(data.strategy.primaryInsight?.type).toBe('selected_strategy_health');
    expect(data.strategy.secondaryInsight).toMatchObject({
      type: 'strongest_observed_setup',
      subject: { id: 'setup-a' },
    });
  });

  it('uses a selected Setup as the health subject rather than creating another pillar', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index));
    const data = requireData(
      composeDashboardInsights(
        input(trades, {
          scope: { ...BASE_SCOPE, strategyId: 'strategy-a', setupId: 'setup-a' },
        }),
      ),
    );
    expect(data.strategy.primaryInsight).toMatchObject({
      type: 'selected_setup_health',
      subject: { kind: 'setup', id: 'setup-a' },
    });
  });
});

describe('Psychology pillar', () => {
  it('selects a material negative Emotion cohort against the scoped baseline', () => {
    const trades = Array.from({ length: 20 }, (_, index) =>
      actual(index, {
        actualR: index < 10 ? '-1.0000' : '1.0000',
        traderOutcome: index < 10 ? 'loss' : 'win',
      }),
    );
    const emotions = trades.map((trade, index) => ({
      tradeId: trade.tradeId,
      key: index < 10 ? 'fearful' : 'focused',
      label: index < 10 ? 'Fearful' : 'Focused',
      isSystem: true,
    }));
    const data = requireData(composeDashboardInsights(input(trades, { emotions })));
    expect(data.psychology.primaryInsight).toMatchObject({
      type: 'emotion_underperformance',
      subject: { kind: 'emotion', id: 'fearful' },
      averageActualR: { status: 'available', value: '-1.0000' },
      scopedBaselineActualR: { status: 'available', value: '0.0000' },
      differenceFromBaselineR: { status: 'available', value: '-1.0000' },
    });
  });

  it('treats multi-Emotion cohorts as overlapping and coverage as unique Trades', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index));
    const emotions = trades.flatMap((trade) => [
      { tradeId: trade.tradeId, key: 'calm', label: 'Calm', isSystem: true },
      { tradeId: trade.tradeId, key: 'focused', label: 'Focused', isSystem: true },
    ]);
    const data = requireData(composeDashboardInsights(input(trades, { emotions })));
    expect(data.psychology.coverage).toMatchObject({
      eligibleTradeCount: 20,
      emotionTaggedTradeCount: 20,
      emotionCoverageRate: '1.0000',
      emotionAttribution: 'overlapping_cohorts_non_additive',
    });
  });

  it('returns a low-coverage warning instead of a strong pattern', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index, { confidence: null }));
    const emotions = trades.slice(0, 4).map((trade) => ({
      tradeId: trade.tradeId,
      key: 'fearful',
      label: 'Fearful',
      isSystem: true,
    }));
    const data = requireData(composeDashboardInsights(input(trades, { emotions })));
    expect(data.psychology.status).toBe('low_coverage');
    expect(data.psychology.primaryInsight?.type).toBe('psychology_coverage_warning');
  });

  it('preserves exact ordinal Confidence levels and does not invent bands', () => {
    const trades = Array.from({ length: 20 }, (_, index) =>
      actual(index, {
        confidence: index < 10 ? 25 : 100,
        actualR: index < 10 ? '-1.0000' : '1.0000',
        traderOutcome: index < 10 ? 'loss' : 'win',
      }),
    );
    const data = requireData(composeDashboardInsights(input(trades)));
    expect(data.psychology.primaryInsight).toMatchObject({
      type: 'confidence_underperformance',
      subject: { kind: 'confidence_level', level: 25 },
    });
    expect(data.psychology.supportingMetrics.confidenceLevels).toEqual([0, 25, 50, 75, 100]);
  });

  it('distinguishes no Psychology recording from no eligible Trades', () => {
    const trades = Array.from({ length: 10 }, (_, index) => actual(index, { confidence: null }));
    const data = requireData(composeDashboardInsights(input(trades)));
    expect(data.psychology).toMatchObject({
      status: 'unevaluated',
      reason: 'psychology_not_recorded',
    });
  });
});

describe('Discipline pillar', () => {
  it('keeps check-level Rule Checks Followed separate from trade-level Rule Adherence', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index));
    const ruleChecks = trades.flatMap((trade, index) => [
      ...checksFor([trade], index < 10 ? 'followed' : 'violated', 'required'),
      ...checksFor([trade], 'followed', 'optional').map((check) => ({
        ...check,
        isRequired: false,
      })),
    ]);
    const data = requireData(composeDashboardInsights(input(trades, { ruleChecks })));
    expect(data.discipline.supportingMetrics).toMatchObject({
      ruleChecksFollowedRate: { status: 'available', value: '0.7500' },
      tradeRuleAdherenceRate: { status: 'available', value: '0.5000' },
    });
  });

  it('prioritizes unresolved required checks and distinguishes all-required N/A', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index));
    const ruleChecks = [
      ...checksFor(trades.slice(0, 10), 'followed'),
      ...checksFor(trades.slice(10, 15), 'not_checked'),
      ...checksFor(trades.slice(15), 'not_applicable'),
    ];
    const data = requireData(composeDashboardInsights(input(trades, { ruleChecks })));
    expect(data.discipline.primaryInsight?.type).toBe('required_checks_incomplete');
    expect(data.discipline.coverage).toMatchObject({
      evaluatedTradeCount: 10,
      incompleteTradeCount: 5,
      notApplicableTradeCount: 5,
    });
  });

  it('returns unevaluated when no required Trade checks are evaluable', () => {
    const trades = Array.from({ length: 10 }, (_, index) => actual(index));
    const data = requireData(
      composeDashboardInsights(input(trades, { ruleChecks: checksFor(trades, 'not_applicable') })),
    );
    expect(data.discipline).toMatchObject({
      status: 'unevaluated',
      reason: 'required_checks_not_evaluated',
    });
  });

  it('compares compliant and non-compliant expectancy descriptively', () => {
    const trades = Array.from({ length: 20 }, (_, index) =>
      actual(index, {
        actualR: index < 10 ? '1.0000' : '-1.0000',
        traderOutcome: index < 10 ? 'win' : 'loss',
      }),
    );
    const ruleChecks = [
      ...checksFor(trades.slice(0, 10), 'followed'),
      ...checksFor(trades.slice(10), 'violated'),
    ];
    const data = requireData(composeDashboardInsights(input(trades, { ruleChecks })));
    expect(data.discipline.primaryInsight).toMatchObject({
      type: 'adherence_performance_difference',
      compliantExpectancyR: { status: 'available', value: '1.0000' },
      nonCompliantExpectancyR: { status: 'available', value: '-1.0000' },
      differenceR: { status: 'available', value: '2.0000' },
      observational: true,
    });
  });

  it('reports issue-associated Gap as an overlapping cohort, never causal cost', () => {
    const trades = Array.from({ length: 20 }, (_, index) => actual(index));
    const ruleChecks = checksFor(trades, 'followed');
    const mistakes = trades.slice(0, 5).map((trade) => ({
      tradeId: trade.tradeId,
      mistakeTypeId: 'mistake-early-exit',
      key: 'early_exit',
      label: 'Early Exit',
      isSystem: true,
    }));
    const data = requireData(composeDashboardInsights(input(trades, { ruleChecks, mistakes })));
    expect(data.discipline.primaryInsight).toMatchObject({
      type: 'issue_associated_execution_gap',
      subject: { kind: 'mistake', id: 'early_exit' },
      affectedTradeCount: 5,
      nonAdditiveCohort: true,
      observational: true,
    });
  });
});

describe('materiality, determinism, and Trade-level samples', () => {
  it('does not promote a sub-quarter-R Psychology difference', () => {
    const trades = Array.from({ length: 20 }, (_, index) =>
      actual(index, {
        actualR: index < 10 ? '0.3100' : '0.2900',
        traderOutcome: 'win',
      }),
    );
    const emotions = trades.map((trade, index) => ({
      tradeId: trade.tradeId,
      key: index < 10 ? 'calm' : 'focused',
      label: index < 10 ? 'Calm' : 'Focused',
      isSystem: true,
    }));
    const data = requireData(composeDashboardInsights(input(trades, { emotions })));
    expect(data.psychology.primaryInsight?.type).toBe('no_material_pattern');
  });

  it('uses deterministic identity tie-breaks independent of source row order', () => {
    const trades = Array.from({ length: 10 }, (_, index) =>
      actual(index, {
        strategyId: index < 5 ? 'strategy-b' : 'strategy-a',
        strategyLabel: index < 5 ? 'B' : 'A',
      }),
    );
    const forward = requireData(composeDashboardInsights(input(trades)));
    const reverse = requireData(composeDashboardInsights(input([...trades].reverse())));
    expect(forward.strategy.primaryInsight?.subject).toMatchObject({ id: 'strategy-a' });
    expect(reverse.strategy.primaryInsight?.subject).toEqual(
      forward.strategy.primaryInsight?.subject,
    );
  });

  it('counts one parent Trade once regardless of external partial-close leg metadata', () => {
    const trades = Array.from({ length: 10 }, (_, index) => actual(index));
    const data = requireData(
      composeDashboardInsights(
        input(trades as readonly (InsightActualTradeInput & { exitLegCount?: number })[]),
      ),
    );
    expect(data.strategy.coverage.actualEligibleTradeCount).toBe(10);
    expect(data.psychology.coverage.eligibleTradeCount).toBe(10);
    expect(data.discipline.coverage.eligibleTradeCount).toBe(10);
  });
});
