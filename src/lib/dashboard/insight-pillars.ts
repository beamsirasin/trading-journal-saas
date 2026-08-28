import Decimal from 'decimal.js';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from '@/lib/analytics/filters';
import {
  composeComparisonAnalytics,
  composeConfidenceAnalytics,
  composeEmotionAnalytics,
  composeRuleAnalytics,
  composeSetupPerformance,
  composeStrategyPerformance,
  composeSystemAnalytics,
  composeTraderAnalytics,
  type AnalyticsMetric,
  type ComparisonAnalyticsModel,
  type DimensionAxisSummary,
} from '@/lib/analytics/metrics';
import { tradeRuleAdherence } from '@/lib/calc/attribution';
import { CalcDecimal, toCanonicalR } from '@/lib/calc/decimal';
import type { OutcomeValue, RuleCheckStatus } from '@/lib/trades/constants';

export const INSIGHT_PILLAR_WIDGET_IDS = [
  'strategy.performance',
  'psychology.performance',
  'discipline.performance',
] as const;

/**
 * A conservative descriptive Dashboard policy, not a statistical-confidence
 * claim. Five observations prevents anecdotes from winning a ranking; twenty
 * moves the copy out of an explicitly limited-sample state. A tagged majority
 * is required before Psychology may select a cohort insight. A quarter-R
 * difference is the minimum Dashboard materiality unit.
 */
export const INSIGHT_SELECTION_POLICY = {
  minimumCohortTradeCount: 5,
  supportedCohortTradeCount: 20,
  minimumCoverageRate: '0.5000',
  materialDifferenceR: '0.2500',
} as const;

export interface InsightActualTradeInput {
  readonly tradeId: string;
  readonly actualR: string;
  readonly traderOutcome: OutcomeValue;
  readonly actualExitedAt: string;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemExitedAt: string | null;
  readonly strategyId: string | null;
  /** Exact pinned Strategy Version label used by this historical Trade. */
  readonly strategyLabel: string | null;
  readonly setupId: string | null;
  /** Exact pinned Setup Version label used by this historical Trade. */
  readonly setupLabel: string | null;
  /** Canonical ordinal value: null or one of 0/25/50/75/100. */
  readonly confidence: number | null;
}

export interface InsightSystemTradeInput {
  readonly tradeId: string;
  readonly systemR: string;
  readonly systemOutcome: OutcomeValue;
  readonly systemExitedAt: string;
  readonly strategyId: string | null;
  readonly strategyLabel: string | null;
  readonly setupId: string | null;
  readonly setupLabel: string | null;
}

export interface InsightEmotionInput {
  readonly tradeId: string;
  readonly key: string;
  readonly label: string;
  readonly isSystem: boolean;
}

export interface InsightRuleCheckInput {
  readonly tradeId: string;
  readonly ruleKey: string;
  readonly title: string;
  readonly checkStatus: RuleCheckStatus | string;
  readonly isRequired: boolean;
  readonly occurredAt: string;
}

export interface InsightMistakeInput {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly isSystem: boolean;
}

export interface InsightScope {
  readonly datePreset: AnalyticsDatePreset;
  readonly dateBounds: AnalyticsDateBounds;
  readonly accountScope:
    | { readonly kind: 'all' }
    | {
        readonly kind: 'account';
        readonly accountId: string;
        readonly source: 'active' | 'explicit';
      };
  readonly strategyId: string | null;
  readonly setupId: string | null;
  readonly strategyVersionId: string | null;
}

export interface ComposeDashboardInsightsInput {
  readonly scope: InsightScope;
  readonly actualTrades: readonly InsightActualTradeInput[];
  readonly systemTrades: readonly InsightSystemTradeInput[];
  readonly emotions: readonly InsightEmotionInput[];
  readonly ruleChecks: readonly InsightRuleCheckInput[];
  readonly mistakes: readonly InsightMistakeInput[];
}

export type InsightSubject =
  | {
      readonly kind: 'strategy' | 'setup';
      readonly id: string;
      readonly label: string | null;
      readonly labelSource: 'latest_observed_pinned_snapshot';
    }
  | {
      readonly kind: 'emotion';
      readonly id: string;
      readonly label: string;
      readonly taxonomy: 'system' | 'custom' | 'mixed';
    }
  | { readonly kind: 'confidence_level'; readonly level: 0 | 25 | 50 | 75 | 100 }
  | {
      readonly kind: 'rule' | 'mistake';
      readonly id: string;
      readonly label: string;
    }
  | { readonly kind: 'discipline' };

export interface PerformanceInsightMetrics {
  readonly actualTradeCount: number;
  readonly systemTradeCount: number;
  readonly comparableTradeCount: number;
  readonly actualTotalR: AnalyticsMetric;
  readonly actualExpectancyR: AnalyticsMetric;
  readonly actualProfitFactor: AnalyticsMetric;
  readonly systemTotalR: AnalyticsMetric;
  readonly systemExpectancyR: AnalyticsMetric;
  readonly systemProfitFactor: AnalyticsMetric;
  readonly averageExecutionGapR: AnalyticsMetric;
}

export type StrategyInsight = {
  readonly type:
    | 'system_actual_divergence'
    | 'strongest_observed_strategy'
    | 'strongest_observed_setup'
    | 'needs_attention_strategy'
    | 'needs_attention_setup'
    | 'selected_strategy_health'
    | 'selected_setup_health';
  readonly subject: InsightSubject;
  readonly basis: 'system_expectancy' | 'paired_execution_gap' | 'selected_health';
  readonly sampleQuality: SampleQuality;
  readonly metrics: PerformanceInsightMetrics;
};

export type PsychologyInsight = {
  readonly type:
    | 'psychology_coverage_warning'
    | 'emotion_underperformance'
    | 'emotion_outperformance'
    | 'confidence_underperformance'
    | 'confidence_outperformance'
    | 'no_material_pattern';
  readonly subject: InsightSubject | null;
  readonly observational: true;
  readonly sampleTradeCount: number;
  readonly averageActualR: AnalyticsMetric;
  readonly scopedBaselineActualR: AnalyticsMetric;
  readonly differenceFromBaselineR: AnalyticsMetric;
  readonly averageExecutionGapR: AnalyticsMetric;
};

export type DisciplineInsight =
  | {
      readonly type:
        'required_checks_incomplete' | 'majority_non_compliant' | 'rule_adherence_summary';
      readonly subject: { readonly kind: 'discipline' };
      readonly observational: true;
      readonly sampleTradeCount: number;
    }
  | {
      readonly type: 'adherence_performance_difference';
      readonly subject: { readonly kind: 'discipline' };
      readonly observational: true;
      readonly compliantExpectancyR: AnalyticsMetric;
      readonly nonCompliantExpectancyR: AnalyticsMetric;
      /** Compliant minus non-compliant expectancy; association only. */
      readonly differenceR: AnalyticsMetric;
      readonly compliantAverageExecutionGapR: AnalyticsMetric;
      readonly nonCompliantAverageExecutionGapR: AnalyticsMetric;
    }
  | {
      readonly type: 'issue_associated_execution_gap';
      readonly subject: InsightSubject;
      readonly observational: true;
      readonly affectedTradeCount: number;
      readonly associatedExecutionGapR: AnalyticsMetric;
      /** Multi-label cohorts overlap, so issue totals are never additive attribution. */
      readonly nonAdditiveCohort: true;
    };

export type SampleQuality = 'insufficient' | 'limited' | 'supported';
export type PillarStatus =
  | 'available'
  | 'limited_sample'
  | 'low_coverage'
  | 'no_eligible_trades'
  | 'insufficient_sample'
  | 'unevaluated'
  | 'unavailable';

export interface StrategyCoverage {
  readonly actualEligibleTradeCount: number;
  readonly actualClassifiedTradeCount: number;
  readonly systemEligibleTradeCount: number;
  readonly systemClassifiedTradeCount: number;
}

export interface PsychologyCoverage {
  readonly eligibleTradeCount: number;
  readonly emotionTaggedTradeCount: number;
  readonly emotionCoverageRate: string;
  readonly confidenceRecordedTradeCount: number;
  readonly confidenceCoverageRate: string;
  readonly emotionAttribution: 'overlapping_cohorts_non_additive';
}

export interface DisciplineCoverage {
  readonly eligibleTradeCount: number;
  readonly evaluatedTradeCount: number;
  readonly compliantTradeCount: number;
  readonly nonCompliantTradeCount: number;
  readonly incompleteTradeCount: number;
  readonly notApplicableTradeCount: number;
  readonly unrecordedRequiredCheckTradeCount: number;
}

export type InsightPillar<I, C, M> =
  | {
      readonly status: 'available' | 'limited_sample' | 'low_coverage';
      readonly coverage: C;
      readonly primaryInsight: I;
      readonly secondaryInsight: I | null;
      readonly supportingMetrics: M;
      readonly analyticsDestination: 'strategy' | 'psychology' | 'discipline';
    }
  | {
      readonly status: 'no_eligible_trades' | 'insufficient_sample' | 'unevaluated' | 'unavailable';
      readonly reason:
        | 'no_eligible_trades'
        | 'sample_below_policy'
        | 'strategy_attribution_missing'
        | 'psychology_not_recorded'
        | 'required_checks_not_evaluated';
      readonly coverage: C;
      readonly primaryInsight: null;
      readonly secondaryInsight: null;
      readonly supportingMetrics: M;
      readonly analyticsDestination: 'strategy' | 'psychology' | 'discipline';
    };

export interface StrategySupportingMetrics {
  readonly selectedDimension: 'strategy' | 'setup';
  readonly candidateCount: number;
}

export interface PsychologySupportingMetrics {
  readonly scopedBaselineActualR: AnalyticsMetric;
  readonly confidenceLevels: readonly (0 | 25 | 50 | 75 | 100)[];
}

export interface DisciplineSupportingMetrics {
  /** Check-level followed / (followed + violated). */
  readonly ruleChecksFollowedRate: AnalyticsMetric;
  /** Trade-level compliant evaluated Trades / evaluated Trades. */
  readonly tradeRuleAdherenceRate: AnalyticsMetric;
  readonly followedCheckCount: number;
  readonly violatedCheckCount: number;
  readonly notCheckedCheckCount: number;
  readonly notApplicableCheckCount: number;
}

export type StrategyPerformanceInsightData = InsightPillar<
  StrategyInsight,
  StrategyCoverage,
  StrategySupportingMetrics
>;
export type PsychologyPerformanceInsightData = InsightPillar<
  PsychologyInsight,
  PsychologyCoverage,
  PsychologySupportingMetrics
>;
export type DisciplinePerformanceInsightData = InsightPillar<
  DisciplineInsight,
  DisciplineCoverage,
  DisciplineSupportingMetrics
>;

export type DashboardInsightData =
  | {
      readonly status: 'available';
      readonly scope: InsightScope;
      readonly widgets: typeof INSIGHT_PILLAR_WIDGET_IDS;
      readonly policy: typeof INSIGHT_SELECTION_POLICY;
      readonly semantics: {
        readonly mode: 'descriptive_association_not_causation';
        readonly unsupported: readonly [
          'discipline_score',
          'mistake_cost_attribution',
          'emotion_cost_attribution',
          'fear_exit_cost',
          'early_exit_cost',
        ];
      };
      readonly strategy: StrategyPerformanceInsightData;
      readonly psychology: PsychologyPerformanceInsightData;
      readonly discipline: DisciplinePerformanceInsightData;
    }
  | {
      readonly status: 'integrity_error';
      readonly scope: InsightScope;
      readonly reason:
        'duplicate_trade' | 'invalid_timestamp' | 'invalid_confidence' | 'orphan_dimension_record';
    };

interface GroupMetrics {
  readonly subject: InsightSubject;
  readonly actual: readonly InsightActualTradeInput[];
  readonly system: readonly InsightSystemTradeInput[];
  readonly metrics: PerformanceInsightMetrics;
  readonly rankingValue: Decimal | null;
}

const CONFIDENCE_LEVELS = [0, 25, 50, 75, 100] as const;

export function composeDashboardInsights(
  input: ComposeDashboardInsightsInput,
): DashboardInsightData {
  const integrity = validateInput(input);
  if (integrity !== null)
    return { status: 'integrity_error', scope: input.scope, reason: integrity };

  return {
    status: 'available',
    scope: input.scope,
    widgets: INSIGHT_PILLAR_WIDGET_IDS,
    policy: INSIGHT_SELECTION_POLICY,
    semantics: {
      mode: 'descriptive_association_not_causation',
      unsupported: [
        'discipline_score',
        'mistake_cost_attribution',
        'emotion_cost_attribution',
        'fear_exit_cost',
        'early_exit_cost',
      ],
    },
    strategy: composeStrategyPillar(input),
    psychology: composePsychologyPillar(input),
    discipline: composeDisciplinePillar(input),
  };
}

function validateInput(
  input: ComposeDashboardInsightsInput,
): Extract<DashboardInsightData, { status: 'integrity_error' }>['reason'] | null {
  if (hasDuplicate(input.actualTrades.map((trade) => trade.tradeId))) return 'duplicate_trade';
  if (hasDuplicate(input.systemTrades.map((trade) => trade.tradeId))) return 'duplicate_trade';
  if (
    [
      ...input.actualTrades.map((trade) => trade.actualExitedAt),
      ...input.systemTrades.map((trade) => trade.systemExitedAt),
      ...input.ruleChecks.map((check) => check.occurredAt),
    ].some((value) => !Number.isFinite(new Date(value).getTime()))
  ) {
    return 'invalid_timestamp';
  }
  if (
    input.actualTrades.some(
      (trade) =>
        trade.confidence !== null &&
        !(CONFIDENCE_LEVELS as readonly number[]).includes(trade.confidence),
    )
  ) {
    return 'invalid_confidence';
  }
  const actualIds = new Set(input.actualTrades.map((trade) => trade.tradeId));
  if (
    [...input.emotions, ...input.ruleChecks, ...input.mistakes].some(
      (record) => !actualIds.has(record.tradeId),
    )
  ) {
    return 'orphan_dimension_record';
  }
  return null;
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function composeStrategyPillar(
  input: ComposeDashboardInsightsInput,
): StrategyPerformanceInsightData {
  const coverage: StrategyCoverage = {
    actualEligibleTradeCount: input.actualTrades.length,
    actualClassifiedTradeCount: input.actualTrades.filter((trade) => trade.strategyId !== null)
      .length,
    systemEligibleTradeCount: input.systemTrades.length,
    systemClassifiedTradeCount: input.systemTrades.filter((trade) => trade.strategyId !== null)
      .length,
  };
  const selectedDimension = input.scope.setupId !== null ? 'setup' : 'strategy';
  const supporting = { selectedDimension, candidateCount: 0 } as StrategySupportingMetrics;
  if (input.actualTrades.length === 0 && input.systemTrades.length === 0) {
    return emptyPillar('strategy', 'no_eligible_trades', coverage, supporting);
  }
  if (coverage.actualClassifiedTradeCount === 0 && coverage.systemClassifiedTradeCount === 0) {
    return emptyPillar('strategy', 'strategy_attribution_missing', coverage, supporting);
  }

  const selectedKind: 'strategy' | 'setup' = input.scope.setupId !== null ? 'setup' : 'strategy';
  const selectedId = input.scope.setupId ?? input.scope.strategyId;
  const candidateKind: 'strategy' | 'setup' =
    input.scope.strategyId !== null && input.scope.setupId === null ? 'setup' : selectedKind;
  const candidateIds = frameworkIds(input, candidateKind);
  const groups = candidateIds.map((id) => groupMetrics(input, candidateKind, id));
  const eligibleGroups = groups
    .filter(
      (group) =>
        group.system.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
        group.rankingValue !== null,
    )
    .sort(compareGroups);
  const supportingMetrics: StrategySupportingMetrics = {
    selectedDimension: candidateKind,
    candidateCount: groups.length,
  };

  let primaryGroup: GroupMetrics | null;
  if (selectedId !== null) primaryGroup = groupMetrics(input, selectedKind, selectedId);
  else primaryGroup = eligibleGroups[0] ?? null;
  if (primaryGroup === null || sampleForGroup(primaryGroup) < 5) {
    return emptyPillar('strategy', 'sample_below_policy', coverage, supportingMetrics);
  }

  const divergence = primaryGroup.metrics.averageExecutionGapR;
  const hasMaterialDivergence =
    primaryGroup.metrics.comparableTradeCount >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
    metricIsMaterial(divergence);
  const primaryType: StrategyInsight['type'] = hasMaterialDivergence
    ? 'system_actual_divergence'
    : selectedId !== null
      ? selectedKind === 'setup'
        ? 'selected_setup_health'
        : 'selected_strategy_health'
      : primaryGroup.subject.kind === 'setup'
        ? 'strongest_observed_setup'
        : 'strongest_observed_strategy';
  const primary: StrategyInsight = {
    type: primaryType,
    subject: primaryGroup.subject,
    basis: hasMaterialDivergence
      ? 'paired_execution_gap'
      : selectedId !== null
        ? 'selected_health'
        : 'system_expectancy',
    sampleQuality: sampleQuality(sampleForGroup(primaryGroup)),
    metrics: primaryGroup.metrics,
  };

  const supportingSetup =
    input.scope.setupId === null
      ? frameworkIds(input, 'setup')
          .map((id) => groupMetrics(input, 'setup', id))
          .filter(
            (group) =>
              group.system.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
              group.rankingValue !== null,
          )
          .sort(compareGroups)[0]
      : undefined;
  const weakest = weakestMaterialGroup(groups, primaryGroup);
  const secondaryGroup = supportingSetup ?? weakest;
  const secondary =
    secondaryGroup === undefined || secondaryGroup === null
      ? null
      : ({
          type:
            supportingSetup !== undefined
              ? 'strongest_observed_setup'
              : secondaryGroup.subject.kind === 'setup'
                ? 'needs_attention_setup'
                : 'needs_attention_strategy',
          subject: secondaryGroup.subject,
          basis: 'system_expectancy',
          sampleQuality: sampleQuality(sampleForGroup(secondaryGroup)),
          metrics: secondaryGroup.metrics,
        } satisfies StrategyInsight);
  const status = primary.sampleQuality === 'supported' ? 'available' : 'limited_sample';
  return {
    status,
    coverage,
    primaryInsight: primary,
    secondaryInsight: secondary,
    supportingMetrics,
    analyticsDestination: 'strategy',
  };
}

function frameworkIds(
  input: ComposeDashboardInsightsInput,
  kind: 'strategy' | 'setup',
): readonly string[] {
  const trader = input.actualTrades.map((trade) => ({
    tradeId: trade.tradeId,
    strategyId: trade.strategyId,
    setupId: trade.setupId,
    r: trade.actualR,
    outcome: trade.traderOutcome,
  }));
  const system = input.systemTrades.map((trade) => ({
    tradeId: trade.tradeId,
    strategyId: trade.strategyId,
    setupId: trade.setupId,
    r: trade.systemR,
    outcome: trade.systemOutcome,
  }));
  return kind === 'strategy'
    ? composeStrategyPerformance(trader, system).strategies.map((group) => group.strategyId)
    : composeSetupPerformance(trader, system).setups.map((group) => group.setupId);
}

function groupMetrics(
  input: ComposeDashboardInsightsInput,
  kind: 'strategy' | 'setup',
  id: string,
): GroupMetrics {
  const actual = input.actualTrades.filter(
    (trade) => (kind === 'strategy' ? trade.strategyId : trade.setupId) === id,
  );
  const system = input.systemTrades.filter(
    (trade) => (kind === 'strategy' ? trade.strategyId : trade.setupId) === id,
  );
  const label = latestFrameworkLabel(actual, system, kind);
  const subject: InsightSubject = {
    kind,
    id,
    label,
    labelSource: 'latest_observed_pinned_snapshot',
  };
  const metrics = performanceMetrics(actual, system);
  const rankingValue =
    metrics.systemExpectancyR.status === 'available'
      ? new Decimal(metrics.systemExpectancyR.value)
      : null;
  return { subject, actual, system, metrics, rankingValue };
}

function latestFrameworkLabel(
  actual: readonly InsightActualTradeInput[],
  system: readonly InsightSystemTradeInput[],
  kind: 'strategy' | 'setup',
): string | null {
  const values = [
    ...actual.map((trade) => ({
      at: trade.actualExitedAt,
      id: trade.tradeId,
      label: kind === 'strategy' ? trade.strategyLabel : trade.setupLabel,
    })),
    ...system.map((trade) => ({
      at: trade.systemExitedAt,
      id: trade.tradeId,
      label: kind === 'strategy' ? trade.strategyLabel : trade.setupLabel,
    })),
  ]
    .filter((entry): entry is { at: string; id: string; label: string } => entry.label !== null)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  return values.at(-1)?.label ?? null;
}

function performanceMetrics(
  actual: readonly InsightActualTradeInput[],
  system: readonly InsightSystemTradeInput[],
): PerformanceInsightMetrics {
  const trader = composeTraderAnalytics(
    actual.map((trade) => ({
      tradeId: trade.tradeId,
      status: 'closed',
      deletedAt: null,
      actualR: trade.actualR,
      traderOutcome: trade.traderOutcome,
      exitedAt: trade.actualExitedAt,
      netPnlMinor: null,
      baseCurrency: 'USD',
    })),
  );
  const systemModel = composeSystemAnalytics(
    system.map((trade) => ({
      tradeId: trade.tradeId,
      systemStatus: 'resolved',
      deletedAt: null,
      systemR: trade.systemR,
      systemOutcome: trade.systemOutcome,
      systemExitedAt: trade.systemExitedAt,
    })),
  );
  const comparison = comparisonFor(actual);
  return {
    actualTradeCount: actual.length,
    systemTradeCount: system.length,
    comparableTradeCount: comparison.comparableCount,
    actualTotalR: trader.totalR,
    actualExpectancyR: trader.expectancyR,
    actualProfitFactor: trader.profitFactor,
    systemTotalR: systemModel.totalR,
    systemExpectancyR: systemModel.expectancyR,
    systemProfitFactor: systemModel.profitFactor,
    averageExecutionGapR: comparison.averageExecutionGapR,
  };
}

function comparisonFor(actual: readonly InsightActualTradeInput[]): ComparisonAnalyticsModel {
  return composeComparisonAnalytics(
    actual.map((trade) => ({
      tradeId: trade.tradeId,
      status: 'closed',
      deletedAt: null,
      actualR: trade.actualR,
      traderOutcome: trade.traderOutcome,
      actualExitedAt: trade.actualExitedAt,
      systemStatus: trade.systemR === null ? 'pending' : 'resolved',
      systemR: trade.systemR,
      systemOutcome: trade.systemOutcome,
      systemExitedAt: trade.systemExitedAt,
    })),
  );
}

function compareGroups(a: GroupMetrics, b: GroupMetrics): number {
  if (
    a.rankingValue !== null &&
    b.rankingValue !== null &&
    !a.rankingValue.equals(b.rankingValue)
  ) {
    return b.rankingValue.comparedTo(a.rankingValue);
  }
  if (a.system.length !== b.system.length) return b.system.length - a.system.length;
  return subjectKey(a.subject).localeCompare(subjectKey(b.subject));
}

function weakestMaterialGroup(
  groups: readonly GroupMetrics[],
  primary: GroupMetrics,
): GroupMetrics | null {
  const candidates = groups
    .filter(
      (group) =>
        subjectKey(group.subject) !== subjectKey(primary.subject) &&
        group.system.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
        group.rankingValue !== null &&
        group.rankingValue.lessThanOrEqualTo(
          new Decimal(INSIGHT_SELECTION_POLICY.materialDifferenceR).negated(),
        ),
    )
    .sort((a, b) =>
      a.rankingValue !== null && b.rankingValue !== null
        ? a.rankingValue.comparedTo(b.rankingValue)
        : subjectKey(a.subject).localeCompare(subjectKey(b.subject)),
    );
  return candidates[0] ?? null;
}

function sampleForGroup(group: GroupMetrics): number {
  return group.system.length > 0 ? group.system.length : group.actual.length;
}

function subjectKey(subject: InsightSubject): string {
  if (subject.kind === 'confidence_level') return `confidence:${subject.level}`;
  if (subject.kind === 'discipline') return 'discipline';
  return `${subject.kind}:${subject.id}`;
}

function composePsychologyPillar(
  input: ComposeDashboardInsightsInput,
): PsychologyPerformanceInsightData {
  const eligibleCount = input.actualTrades.length;
  const taggedIds = new Set(input.emotions.map((emotion) => emotion.tradeId));
  const confidenceCount = input.actualTrades.filter((trade) => trade.confidence !== null).length;
  const coverage: PsychologyCoverage = {
    eligibleTradeCount: eligibleCount,
    emotionTaggedTradeCount: taggedIds.size,
    emotionCoverageRate: ratio(taggedIds.size, eligibleCount),
    confidenceRecordedTradeCount: confidenceCount,
    confidenceCoverageRate: ratio(confidenceCount, eligibleCount),
    emotionAttribution: 'overlapping_cohorts_non_additive',
  };
  const baseline = performanceMetrics(input.actualTrades, []).actualExpectancyR;
  const supporting: PsychologySupportingMetrics = {
    scopedBaselineActualR: baseline,
    confidenceLevels: CONFIDENCE_LEVELS,
  };
  if (eligibleCount === 0) {
    return emptyPillar('psychology', 'no_eligible_trades', coverage, supporting);
  }
  if (taggedIds.size === 0 && confidenceCount === 0) {
    return emptyPillar('psychology', 'psychology_not_recorded', coverage, supporting);
  }

  const emotionCoverageAdequate = coverageIsAdequate(taggedIds.size, eligibleCount);
  const confidenceCoverageAdequate = coverageIsAdequate(confidenceCount, eligibleCount);
  if (!emotionCoverageAdequate && !confidenceCoverageAdequate) {
    const warning: PsychologyInsight = {
      type: 'psychology_coverage_warning',
      subject: null,
      observational: true,
      sampleTradeCount: Math.max(taggedIds.size, confidenceCount),
      averageActualR: unavailable('no_trades'),
      scopedBaselineActualR: baseline,
      differenceFromBaselineR: unavailable('no_trades'),
      averageExecutionGapR: unavailable('no_comparable_trades'),
    };
    return {
      status: 'low_coverage',
      coverage,
      primaryInsight: warning,
      secondaryInsight: null,
      supportingMetrics: supporting,
      analyticsDestination: 'psychology',
    };
  }

  const emotionModels = composeEmotionAnalytics(
    input.emotions.map((emotion) => {
      const trade = input.actualTrades.find((candidate) => candidate.tradeId === emotion.tradeId)!;
      return {
        tradeId: trade.tradeId,
        key: emotion.key,
        label: emotion.label,
        r: trade.actualR,
        outcome: trade.traderOutcome,
      };
    }),
    [],
  );
  const emotionInsights = emotionCoverageAdequate
    ? emotionModels
        .filter(
          (model) =>
            model.trader.tradeCount >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
            model.trader.averageR.status === 'available',
        )
        .map((model) => {
          const rows = input.emotions.filter((emotion) => emotion.key === model.key);
          const ids = new Set(rows.map((row) => row.tradeId));
          const trades = input.actualTrades.filter((trade) => ids.has(trade.tradeId));
          const taxonomyValues = new Set(rows.map((row) => row.isSystem));
          const taxonomy =
            taxonomyValues.size > 1 ? 'mixed' : taxonomyValues.has(true) ? 'system' : 'custom';
          return psychologyCohortInsight(
            {
              kind: 'emotion',
              id: model.key,
              label: model.label,
              taxonomy,
            },
            model.trader,
            trades,
            baseline,
          );
        })
    : [];

  const confidenceModel = composeConfidenceAnalytics(
    input.actualTrades
      .filter((trade) => trade.confidence !== null)
      .map((trade) => ({
        tradeId: trade.tradeId,
        confidence: trade.confidence as number,
        r: trade.actualR,
        outcome: trade.traderOutcome,
      })),
    [],
  );
  const confidenceInsights = confidenceCoverageAdequate
    ? confidenceModel.levels
        .filter(
          (level) =>
            level.trader.tradeCount >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
            level.trader.averageR.status === 'available',
        )
        .map((level) => {
          const trades = input.actualTrades.filter((trade) => trade.confidence === level.level);
          return psychologyCohortInsight(
            { kind: 'confidence_level', level: level.level },
            level.trader,
            trades,
            baseline,
          );
        })
    : [];
  const insights = [...emotionInsights, ...confidenceInsights];
  const material = insights.filter((insight) => metricIsMaterial(insight.differenceFromBaselineR));
  const negative = material
    .filter((insight) => metricDecimal(insight.differenceFromBaselineR)?.isNegative())
    .sort(comparePsychologyAscending);
  const positive = material
    .filter((insight) => metricDecimal(insight.differenceFromBaselineR)?.isPositive())
    .sort(comparePsychologyDescending);
  const primary = negative[0] ?? positive[0] ?? null;
  if (primary === null) {
    if (insights.length === 0) {
      return emptyPillar('psychology', 'sample_below_policy', coverage, supporting);
    }
    const neutral: PsychologyInsight = {
      type: 'no_material_pattern',
      subject: null,
      observational: true,
      sampleTradeCount: eligibleCount,
      averageActualR: baseline,
      scopedBaselineActualR: baseline,
      differenceFromBaselineR: available('0.0000'),
      averageExecutionGapR: comparisonFor(input.actualTrades).averageExecutionGapR,
    };
    return {
      status: sampleQuality(eligibleCount) === 'supported' ? 'available' : 'limited_sample',
      coverage,
      primaryInsight: neutral,
      secondaryInsight: null,
      supportingMetrics: supporting,
      analyticsDestination: 'psychology',
    };
  }
  const secondary =
    [...negative.slice(1), ...positive]
      .filter(
        (insight) => subjectKey(insight.subject as InsightSubject) !== subjectKey(primary.subject!),
      )
      .at(0) ?? null;
  return {
    status:
      sampleQuality(primary.sampleTradeCount) === 'supported' ? 'available' : 'limited_sample',
    coverage,
    primaryInsight: primary,
    secondaryInsight: secondary,
    supportingMetrics: supporting,
    analyticsDestination: 'psychology',
  };
}

function psychologyCohortInsight(
  subject: InsightSubject,
  summary: DimensionAxisSummary,
  trades: readonly InsightActualTradeInput[],
  baseline: AnalyticsMetric,
): PsychologyInsight {
  const difference = metricDifference(summary.averageR, baseline);
  const negative = metricDecimal(difference)?.isNegative() ?? false;
  return {
    type:
      subject.kind === 'emotion'
        ? negative
          ? 'emotion_underperformance'
          : 'emotion_outperformance'
        : negative
          ? 'confidence_underperformance'
          : 'confidence_outperformance',
    subject,
    observational: true,
    sampleTradeCount: summary.tradeCount,
    averageActualR: summary.averageR,
    scopedBaselineActualR: baseline,
    differenceFromBaselineR: difference,
    averageExecutionGapR: comparisonFor(trades).averageExecutionGapR,
  };
}

function comparePsychologyAscending(a: PsychologyInsight, b: PsychologyInsight): number {
  const aValue = metricDecimal(a.differenceFromBaselineR) ?? new Decimal(0);
  const bValue = metricDecimal(b.differenceFromBaselineR) ?? new Decimal(0);
  return (
    aValue.comparedTo(bValue) ||
    b.sampleTradeCount - a.sampleTradeCount ||
    subjectKey(a.subject!).localeCompare(subjectKey(b.subject!))
  );
}

function comparePsychologyDescending(a: PsychologyInsight, b: PsychologyInsight): number {
  return comparePsychologyAscending(b, a);
}

function composeDisciplinePillar(
  input: ComposeDashboardInsightsInput,
): DisciplinePerformanceInsightData {
  const ruleModel = composeRuleAnalytics(input.ruleChecks);
  const checksByTrade = new Map<string, InsightRuleCheckInput[]>();
  for (const check of input.ruleChecks) {
    const rows = checksByTrade.get(check.tradeId) ?? [];
    rows.push(check);
    checksByTrade.set(check.tradeId, rows);
  }
  const classes = input.actualTrades.map((trade) => ({
    trade,
    classification: classifyTrade(checksByTrade.get(trade.tradeId) ?? []),
  }));
  const coverage: DisciplineCoverage = {
    eligibleTradeCount: input.actualTrades.length,
    evaluatedTradeCount: ruleModel.evaluatedTradeCount,
    compliantTradeCount: ruleModel.compliantTradeCount,
    nonCompliantTradeCount: ruleModel.nonCompliantTradeCount,
    incompleteTradeCount: ruleModel.incompleteTradeCount,
    notApplicableTradeCount: ruleModel.notApplicableTradeCount,
    unrecordedRequiredCheckTradeCount: classes.filter(
      (entry) => entry.classification === 'unrecorded',
    ).length,
  };
  const supporting: DisciplineSupportingMetrics = {
    ruleChecksFollowedRate: ruleModel.checksFollowedRate,
    tradeRuleAdherenceRate: ruleModel.tradeAdherenceRate,
    followedCheckCount: ruleModel.followedCount,
    violatedCheckCount: ruleModel.violatedCount,
    notCheckedCheckCount: ruleModel.notCheckedCount,
    notApplicableCheckCount: ruleModel.notApplicableCount,
  };
  if (input.actualTrades.length === 0) {
    return emptyPillar('discipline', 'no_eligible_trades', coverage, supporting);
  }
  if (ruleModel.evaluatedTradeCount === 0) {
    return emptyPillar('discipline', 'required_checks_not_evaluated', coverage, supporting);
  }

  const compliant = classes
    .filter((entry) => entry.classification === 'compliant')
    .map((entry) => entry.trade);
  const nonCompliant = classes
    .filter((entry) => entry.classification === 'non_compliant')
    .map((entry) => entry.trade);
  const incomplete = coverage.incompleteTradeCount + coverage.unrecordedRequiredCheckTradeCount;
  let primary: DisciplineInsight;
  let secondary: DisciplineInsight | null = null;
  if (incomplete > 0) {
    primary = {
      type: 'required_checks_incomplete',
      subject: { kind: 'discipline' },
      observational: true,
      sampleTradeCount: incomplete,
    };
  } else if (nonCompliant.length > compliant.length) {
    primary = {
      type: 'majority_non_compliant',
      subject: { kind: 'discipline' },
      observational: true,
      sampleTradeCount: ruleModel.evaluatedTradeCount,
    };
  } else {
    const difference = adherenceDifference(compliant, nonCompliant);
    if (
      compliant.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
      nonCompliant.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
      metricIsMaterial(difference.differenceR)
    ) {
      primary = difference;
    } else {
      const issue = mostFrequentIssue(input);
      primary =
        issue ??
        ({
          type: 'rule_adherence_summary',
          subject: { kind: 'discipline' },
          observational: true,
          sampleTradeCount: ruleModel.evaluatedTradeCount,
        } satisfies DisciplineInsight);
    }
  }
  if (primary.type === 'required_checks_incomplete' || primary.type === 'majority_non_compliant') {
    const difference = adherenceDifference(compliant, nonCompliant);
    if (
      compliant.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
      nonCompliant.length >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount &&
      metricIsMaterial(difference.differenceR)
    ) {
      secondary = difference;
    } else secondary = mostFrequentIssue(input);
  }
  const status =
    sampleQuality(ruleModel.evaluatedTradeCount) === 'supported' ? 'available' : 'limited_sample';
  return {
    status,
    coverage,
    primaryInsight: primary,
    secondaryInsight: secondary,
    supportingMetrics: supporting,
    analyticsDestination: 'discipline',
  };
}

type TradeDisciplineClass =
  'compliant' | 'non_compliant' | 'incomplete' | 'not_applicable' | 'unrecorded';

function classifyTrade(checks: readonly InsightRuleCheckInput[]): TradeDisciplineClass {
  const result = tradeRuleAdherence(
    checks.map((check) => ({
      tradeId: check.tradeId,
      isRequired: check.isRequired,
      status: check.checkStatus,
    })),
  );
  if (result.compliantTradeCount === 1) return 'compliant';
  if (result.nonCompliantTradeCount === 1) return 'non_compliant';
  if (result.incompleteTradeCount === 1) return 'incomplete';
  if (result.notApplicableTradeCount === 1) return 'not_applicable';
  return 'unrecorded';
}

function adherenceDifference(
  compliant: readonly InsightActualTradeInput[],
  nonCompliant: readonly InsightActualTradeInput[],
): Extract<DisciplineInsight, { type: 'adherence_performance_difference' }> {
  const compliantMetrics = performanceMetrics(compliant, []);
  const nonCompliantMetrics = performanceMetrics(nonCompliant, []);
  return {
    type: 'adherence_performance_difference',
    subject: { kind: 'discipline' },
    observational: true,
    compliantExpectancyR: compliantMetrics.actualExpectancyR,
    nonCompliantExpectancyR: nonCompliantMetrics.actualExpectancyR,
    differenceR: metricDifference(
      compliantMetrics.actualExpectancyR,
      nonCompliantMetrics.actualExpectancyR,
    ),
    compliantAverageExecutionGapR: comparisonFor(compliant).averageExecutionGapR,
    nonCompliantAverageExecutionGapR: comparisonFor(nonCompliant).averageExecutionGapR,
  };
}

function mostFrequentIssue(input: ComposeDashboardInsightsInput): DisciplineInsight | null {
  const groups = new Map<string, { subject: InsightSubject; tradeIds: Set<string> }>();
  for (const check of input.ruleChecks.filter((row) => row.checkStatus === 'violated')) {
    const key = `rule:${check.ruleKey}`;
    const existing = groups.get(key) ?? {
      subject: { kind: 'rule', id: check.ruleKey, label: check.title },
      tradeIds: new Set<string>(),
    };
    existing.tradeIds.add(check.tradeId);
    existing.subject = { kind: 'rule', id: check.ruleKey, label: check.title };
    groups.set(key, existing);
  }
  for (const mistake of input.mistakes) {
    const key = `mistake:${mistake.mistakeTypeId}`;
    const existing = groups.get(key) ?? {
      subject: { kind: 'mistake', id: mistake.key, label: mistake.label },
      tradeIds: new Set<string>(),
    };
    existing.tradeIds.add(mistake.tradeId);
    groups.set(key, existing);
  }
  const candidate = [...groups.values()]
    .filter((group) => group.tradeIds.size >= INSIGHT_SELECTION_POLICY.minimumCohortTradeCount)
    .sort(
      (a, b) =>
        b.tradeIds.size - a.tradeIds.size ||
        subjectKey(a.subject).localeCompare(subjectKey(b.subject)),
    )[0];
  if (candidate === undefined) return null;
  const trades = input.actualTrades.filter((trade) => candidate.tradeIds.has(trade.tradeId));
  return {
    type: 'issue_associated_execution_gap',
    subject: candidate.subject,
    observational: true,
    affectedTradeCount: candidate.tradeIds.size,
    associatedExecutionGapR: comparisonFor(trades).executionGapR,
    nonAdditiveCohort: true,
  };
}

function emptyPillar<C, M>(
  destination: 'strategy' | 'psychology' | 'discipline',
  reason:
    | 'no_eligible_trades'
    | 'sample_below_policy'
    | 'strategy_attribution_missing'
    | 'psychology_not_recorded'
    | 'required_checks_not_evaluated',
  coverage: C,
  supportingMetrics: M,
): InsightPillar<never, C, M> {
  const status: Extract<
    PillarStatus,
    'no_eligible_trades' | 'insufficient_sample' | 'unevaluated' | 'unavailable'
  > =
    reason === 'no_eligible_trades'
      ? 'no_eligible_trades'
      : reason === 'sample_below_policy'
        ? 'insufficient_sample'
        : reason === 'strategy_attribution_missing'
          ? 'unavailable'
          : 'unevaluated';
  return {
    status,
    reason,
    coverage,
    primaryInsight: null,
    secondaryInsight: null,
    supportingMetrics,
    analyticsDestination: destination,
  };
}

function sampleQuality(count: number): SampleQuality {
  if (count < INSIGHT_SELECTION_POLICY.minimumCohortTradeCount) return 'insufficient';
  if (count < INSIGHT_SELECTION_POLICY.supportedCohortTradeCount) return 'limited';
  return 'supported';
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return '0.0000';
  return new Decimal(numerator).div(denominator).toDecimalPlaces(4).toFixed(4);
}

function coverageIsAdequate(tagged: number, eligible: number): boolean {
  if (eligible === 0) return false;
  return new Decimal(tagged)
    .div(eligible)
    .greaterThanOrEqualTo(INSIGHT_SELECTION_POLICY.minimumCoverageRate);
}

function metricDifference(left: AnalyticsMetric, right: AnalyticsMetric): AnalyticsMetric {
  if (left.status === 'error' || right.status === 'error') {
    return { status: 'error', reason: 'data_integrity_error' };
  }
  if (left.status !== 'available') return left;
  if (right.status !== 'available') return right;
  return available(toCanonicalR(new CalcDecimal(left.value).minus(right.value)));
}

function metricDecimal(metric: AnalyticsMetric): Decimal | null {
  return metric.status === 'available' ? new Decimal(metric.value) : null;
}

function metricIsMaterial(metric: AnalyticsMetric): boolean {
  const value = metricDecimal(metric);
  return (
    value !== null && value.abs().greaterThanOrEqualTo(INSIGHT_SELECTION_POLICY.materialDifferenceR)
  );
}

function available(value: string): AnalyticsMetric {
  return { status: 'available', value };
}

function unavailable(reason: 'no_trades' | 'no_comparable_trades'): AnalyticsMetric {
  return { status: 'unavailable', reason };
}
