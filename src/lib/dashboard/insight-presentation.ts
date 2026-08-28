import type { AnalyticsMetric } from '@/lib/analytics/metrics';
import {
  formatAnalyticsMetric,
  type AnalyticsDisplayStyle,
  type AnalyticsDisplayTone,
} from '@/lib/analytics/presentation';
import {
  buildAnalyticsViewHref,
  type AnalyticsUrlSelection,
  type AnalyticsView,
} from '@/lib/analytics/url-filters';

import type { DashboardFilterState } from './filters';
import type {
  DashboardInsightData,
  DisciplineInsight,
  DisciplinePerformanceInsightData,
  InsightSubject,
  PsychologyInsight,
  PsychologyPerformanceInsightData,
  SampleQuality,
  StrategyInsight,
  StrategyPerformanceInsightData,
} from './insight-pillars';
import { dashboardLayoutItem, type DashboardLayoutItem, type DashboardWidgetId } from './widgets';

/**
 * D8B presentation model for the three compact insight pillars.
 *
 * PURE, AND THE ONLY PLACE A D8A FIGURE BECOMES TEXT.
 *
 * D8A already decided everything that matters: which insight each pillar
 * surfaces, on what basis, over which cohort, at what sample quality, and
 * whether the sample or coverage even permits a claim. This module re-ranks
 * nothing, re-thresholds nothing, and computes no expectancy, rate,
 * difference or gap of its own. It formats the metrics D8A published and
 * hands the components strings plus the insight's own `type`, so the copy is
 * chosen by the domain's token rather than inferred from a raw value.
 *
 * It also deliberately DROPS most of the payload. D8A supplies far more than
 * three compact cards should show; §1 allows one primary insight, at most one
 * supporting insight, and small context. Everything else stays in Analytics.
 */

export type InsightPillarKey = 'strategy' | 'psychology' | 'discipline';

/** D8A's published policy, read rather than restated. */
type InsightPolicy = Extract<DashboardInsightData, { status: 'available' }>['policy'];

export type InsightTone = AnalyticsDisplayTone;

export interface InsightFigure {
  readonly text: string;
  readonly tone: InsightTone;
}

/**
 * What a figure IS, so the card can label it unambiguously.
 *
 * `checks_followed` and `rule_adherence` are separate roles on purpose:
 * Rule Checks Followed is check-level and Trade Rule Adherence is
 * Trade-level, they are different numbers over different denominators, and
 * D8A keeps them distinct. A shared "adherence" role would be the first step
 * toward one being printed under the other's name.
 */
export type InsightComparisonRole =
  | 'system_expectancy'
  | 'actual_expectancy'
  | 'average_execution_gap'
  | 'cohort_average'
  | 'scoped_baseline'
  | 'compliant_expectancy'
  | 'non_compliant_expectancy'
  | 'checks_followed'
  | 'rule_adherence'
  | 'associated_execution_gap';

export interface InsightComparison {
  readonly role: InsightComparisonRole;
  readonly figure: InsightFigure;
}

export interface InsightStatementView {
  /** D8A's own insight `type`. The card selects copy from this, never from a value. */
  readonly type: string;
  readonly subjectLabel: string | null;
  readonly subjectKind: InsightSubject['kind'] | null;
  /** The one figure the statement leads with; `null` when the claim is not numeric. */
  readonly headline: InsightFigure | null;
  /**
   * WHAT the hero figure is. Without it a bare `63.64%` cannot be attributed
   * to Trade Rule Adherence rather than Rule Checks Followed, and a bare
   * `-0.63R` cannot be told from an expectancy — which is exactly the
   * ambiguity the two rate definitions must never fall into.
   */
  readonly headlineRole: InsightComparisonRole | null;
  readonly comparisons: readonly InsightComparison[];
  /** Observations this statement was drawn from, when D8A published a count. */
  readonly tradeCount: number | null;
  /** True where cohorts overlap, so the card must not imply a partition. */
  readonly nonAdditive: boolean;
}

export interface InsightSampleView {
  readonly quality: SampleQuality;
  readonly tradeCount: number;
}

export type InsightCoverageView =
  | {
      readonly kind: 'strategy';
      readonly classifiedTradeCount: number;
      readonly eligibleTradeCount: number;
    }
  | {
      readonly kind: 'psychology';
      readonly taggedTradeCount: number;
      readonly eligibleTradeCount: number;
      readonly ratePercent: string;
    }
  | {
      readonly kind: 'discipline';
      readonly evaluatedTradeCount: number;
      readonly eligibleTradeCount: number;
    };

/** D8A's own reason vocabulary, plus this layer's two failure modes. */
export type InsightCardReason =
  | 'no_eligible_trades'
  | 'sample_below_policy'
  | 'strategy_attribution_missing'
  | 'psychology_not_recorded'
  | 'required_checks_not_evaluated'
  | 'duplicate_trade'
  | 'invalid_timestamp'
  | 'invalid_confidence'
  | 'orphan_dimension_record'
  | 'service_error';

export interface InsightCardView {
  readonly pillar: InsightPillarKey;
  readonly widgetId: DashboardWidgetId;
  readonly layout: DashboardLayoutItem;
  readonly analyticsView: AnalyticsView;
  readonly analyticsHref: string;
  /** D8A's `PillarStatus`, or `integrity_error` for a failed compose/read. */
  readonly status:
    | 'available'
    | 'limited_sample'
    | 'low_coverage'
    | 'no_eligible_trades'
    | 'insufficient_sample'
    | 'unevaluated'
    | 'unavailable'
    | 'integrity_error';
  readonly reason: InsightCardReason | null;
  readonly primary: InsightStatementView | null;
  /** At most ONE supporting insight reaches the Dashboard (§1). */
  readonly secondary: InsightStatementView | null;
  readonly sample: InsightSampleView | null;
  readonly coverage: InsightCoverageView | null;
  /** The policy floor, so an insufficient card can state the real threshold. */
  readonly minimumCohortTradeCount: number;
}

export interface InsightPillarsView {
  readonly cards: readonly [InsightCardView, InsightCardView, InsightCardView];
}

export interface ComposeInsightPillarsViewInput {
  readonly data: DashboardInsightData;
  readonly filters: DashboardFilterState;
}

const WIDGET_ID: Record<InsightPillarKey, DashboardWidgetId> = {
  strategy: 'strategy.performance',
  psychology: 'psychology.performance',
  discipline: 'discipline.performance',
};

/**
 * D8A's destination token to the Analytics view that actually holds that
 * material today. This is the EXISTING `?view=` contract
 * (`buildAnalyticsViewHref`), not a new route: Strategy and Setup Performance
 * live in `edge`, Confidence and Emotion in `behavior`, and the Rule Summary
 * and Mistake Frequency panels in `results`. No destination is invented, and
 * no Analytics view is created by D8B.
 */
const ANALYTICS_VIEW: Record<InsightPillarKey, AnalyticsView> = {
  strategy: 'edge',
  psychology: 'behavior',
  discipline: 'results',
};

/** A failed Insight read — never dressed up as an empty product state. */
export function insightPillarsServiceError(filters: DashboardFilterState): InsightPillarsView {
  return {
    cards: [
      errorCard('strategy', filters, 'service_error'),
      errorCard('psychology', filters, 'service_error'),
      errorCard('discipline', filters, 'service_error'),
    ],
  };
}

export function composeInsightPillarsView(
  input: ComposeInsightPillarsViewInput,
): InsightPillarsView {
  const { data, filters } = input;
  if (data.status === 'integrity_error') {
    return {
      cards: [
        errorCard('strategy', filters, data.reason),
        errorCard('psychology', filters, data.reason),
        errorCard('discipline', filters, data.reason),
      ],
    };
  }

  const policy = data.policy;
  return {
    cards: [
      strategyCard(data.strategy, filters, policy),
      psychologyCard(data.psychology, filters, policy),
      disciplineCard(data.discipline, filters, policy),
    ],
  };
}

function base(
  pillar: InsightPillarKey,
  filters: DashboardFilterState,
): Pick<InsightCardView, 'pillar' | 'widgetId' | 'layout' | 'analyticsView' | 'analyticsHref'> {
  const widgetId = WIDGET_ID[pillar];
  const view = ANALYTICS_VIEW[pillar];
  return {
    pillar,
    widgetId,
    layout: dashboardLayoutItem(widgetId),
    analyticsView: view,
    analyticsHref: buildAnalyticsViewHref(analyticsSelection(filters), view),
  };
}

/**
 * The Dashboard's own scope, expressed in the Analytics URL vocabulary, so
 * following a pillar lands on the SAME population the card described rather
 * than on an unfiltered page.
 */
function analyticsSelection(filters: DashboardFilterState): AnalyticsUrlSelection {
  return {
    range: filters.datePreset,
    account:
      filters.accountScope.kind === 'all'
        ? 'all'
        : filters.accountScope.kind === 'account'
          ? filters.accountScope.accountId
          : null,
    strategy: filters.strategyId,
    setup: filters.setupId,
    version: filters.strategyVersionId,
  };
}

function errorCard(
  pillar: InsightPillarKey,
  filters: DashboardFilterState,
  reason: InsightCardReason,
): InsightCardView {
  return {
    ...base(pillar, filters),
    status: 'integrity_error',
    reason,
    primary: null,
    secondary: null,
    sample: null,
    coverage: null,
    minimumCohortTradeCount: 0,
  };
}

function strategyCard(
  pillar: StrategyPerformanceInsightData,
  filters: DashboardFilterState,
  policy: InsightPolicy,
): InsightCardView {
  const coverage: InsightCoverageView = {
    kind: 'strategy',
    classifiedTradeCount: pillar.coverage.actualClassifiedTradeCount,
    eligibleTradeCount: pillar.coverage.actualEligibleTradeCount,
  };
  if (pillar.primaryInsight === null) {
    return {
      ...base('strategy', filters),
      status: pillar.status,
      reason: pillar.reason,
      primary: null,
      secondary: null,
      sample: null,
      coverage,
      minimumCohortTradeCount: policy.minimumCohortTradeCount,
    };
  }

  return {
    ...base('strategy', filters),
    status: pillar.status,
    reason: null,
    primary: strategyStatement(pillar.primaryInsight),
    secondary: pillar.secondaryInsight === null ? null : strategyStatement(pillar.secondaryInsight),
    sample: {
      quality: pillar.primaryInsight.sampleQuality,
      // The Actual population the claim was observed over.
      tradeCount: pillar.primaryInsight.metrics.actualTradeCount,
    },
    coverage,
    minimumCohortTradeCount: policy.minimumCohortTradeCount,
  };
}

/**
 * The headline follows the insight's own BASIS, not the largest number
 * available. A `system_expectancy` selection leads with System expectancy; a
 * divergence or gap selection leads with the paired average Execution Gap.
 * Reading a basis off the values instead would let the card claim a reason
 * D8A never selected.
 */
function strategyStatement(insight: StrategyInsight): InsightStatementView {
  const metrics = insight.metrics;
  const headlineRole: InsightComparisonRole =
    insight.basis === 'paired_execution_gap'
      ? 'average_execution_gap'
      : insight.basis === 'selected_health'
        ? 'actual_expectancy'
        : 'system_expectancy';
  const headline =
    headlineRole === 'average_execution_gap'
      ? signed(metrics.averageExecutionGapR, 'r')
      : headlineRole === 'actual_expectancy'
        ? signed(metrics.actualExpectancyR, 'r')
        : signed(metrics.systemExpectancyR, 'r');

  const comparisons: InsightComparison[] = [];
  push(comparisons, 'system_expectancy', signed(metrics.systemExpectancyR, 'r'));
  push(comparisons, 'actual_expectancy', signed(metrics.actualExpectancyR, 'r'));
  if (insight.basis !== 'paired_execution_gap') {
    push(comparisons, 'average_execution_gap', signed(metrics.averageExecutionGapR, 'r'));
  }

  return {
    type: insight.type,
    subjectLabel: subjectLabel(insight.subject),
    subjectKind: insight.subject.kind,
    headline,
    headlineRole,
    // Two supporting figures at most: a compact card is not a metric table.
    comparisons: supporting(comparisons, headlineRole),
    tradeCount: metrics.actualTradeCount,
    nonAdditive: false,
  };
}

function psychologyCard(
  pillar: PsychologyPerformanceInsightData,
  filters: DashboardFilterState,
  policy: InsightPolicy,
): InsightCardView {
  const coverage: InsightCoverageView = {
    kind: 'psychology',
    taggedTradeCount: pillar.coverage.emotionTaggedTradeCount,
    eligibleTradeCount: pillar.coverage.eligibleTradeCount,
    ratePercent: percentText(pillar.coverage.emotionCoverageRate),
  };
  if (pillar.primaryInsight === null) {
    return {
      ...base('psychology', filters),
      status: pillar.status,
      reason: pillar.reason,
      primary: null,
      secondary: null,
      sample: null,
      coverage,
      minimumCohortTradeCount: policy.minimumCohortTradeCount,
    };
  }

  return {
    ...base('psychology', filters),
    status: pillar.status,
    reason: null,
    primary: psychologyStatement(pillar.primaryInsight),
    secondary:
      pillar.secondaryInsight === null ? null : psychologyStatement(pillar.secondaryInsight),
    sample: {
      quality: sampleQualityFor(pillar.primaryInsight.sampleTradeCount, policy),
      tradeCount: pillar.primaryInsight.sampleTradeCount,
    },
    coverage,
    minimumCohortTradeCount: policy.minimumCohortTradeCount,
  };
}

/**
 * DESCRIPTIVE, ALWAYS. The headline is the cohort's own average Actual R and
 * the comparison is the scoped baseline it is being read against — never a
 * total "cost", never a difference dressed as an amount the cohort took away.
 * `nonAdditive` is set for every Emotion cohort because one Trade can carry
 * several Emotions, so these groups never partition the population.
 */
function psychologyStatement(insight: PsychologyInsight): InsightStatementView {
  const comparisons: InsightComparison[] = [];
  push(comparisons, 'scoped_baseline', signed(insight.scopedBaselineActualR, 'r'));
  push(comparisons, 'average_execution_gap', signed(insight.averageExecutionGapR, 'r'));

  return {
    type: insight.type,
    subjectLabel: subjectLabel(insight.subject),
    subjectKind: insight.subject?.kind ?? null,
    headline: signed(insight.averageActualR, 'r'),
    headlineRole: 'cohort_average',
    comparisons: supporting(comparisons, 'cohort_average'),
    tradeCount: insight.sampleTradeCount,
    nonAdditive: insight.subject?.kind === 'emotion',
  };
}

function disciplineCard(
  pillar: DisciplinePerformanceInsightData,
  filters: DashboardFilterState,
  policy: InsightPolicy,
): InsightCardView {
  const coverage: InsightCoverageView = {
    kind: 'discipline',
    evaluatedTradeCount: pillar.coverage.evaluatedTradeCount,
    eligibleTradeCount: pillar.coverage.eligibleTradeCount,
  };
  if (pillar.primaryInsight === null) {
    return {
      ...base('discipline', filters),
      status: pillar.status,
      reason: pillar.reason,
      primary: null,
      secondary: null,
      sample: null,
      coverage,
      minimumCohortTradeCount: policy.minimumCohortTradeCount,
    };
  }

  return {
    ...base('discipline', filters),
    status: pillar.status,
    reason: null,
    primary: disciplineStatement(pillar.primaryInsight, pillar.supportingMetrics),
    secondary:
      pillar.secondaryInsight === null
        ? null
        : disciplineStatement(pillar.secondaryInsight, pillar.supportingMetrics),
    sample: {
      quality: sampleQualityFor(pillar.coverage.evaluatedTradeCount, policy),
      tradeCount: pillar.coverage.evaluatedTradeCount,
    },
    coverage,
    minimumCohortTradeCount: policy.minimumCohortTradeCount,
  };
}

/**
 * Rule Adherence leads, because it is the Trade-level reading a trader acts
 * on. Rule Checks Followed rides alongside it as a separately named
 * comparison — the two are different denominators and D8A keeps them
 * distinct, so neither is ever printed under the other's label.
 *
 * An `issue_associated_execution_gap` statement carries the association only:
 * the affected cohort, its associated Gap, and the non-additive flag. It is
 * never a cost, and never "because of".
 */
function disciplineStatement(
  insight: DisciplineInsight,
  rates: DisciplinePerformanceInsightData['supportingMetrics'],
): InsightStatementView {
  const comparisons: InsightComparison[] = [];

  if (insight.type === 'issue_associated_execution_gap') {
    push(comparisons, 'associated_execution_gap', signed(insight.associatedExecutionGapR, 'r'));
    return {
      type: insight.type,
      subjectLabel: subjectLabel(insight.subject),
      subjectKind: insight.subject.kind,
      headline: signed(insight.associatedExecutionGapR, 'r'),
      headlineRole: 'associated_execution_gap',
      comparisons: supporting(comparisons, 'associated_execution_gap'),
      tradeCount: insight.affectedTradeCount,
      nonAdditive: insight.nonAdditiveCohort,
    };
  }

  if (insight.type === 'adherence_performance_difference') {
    push(comparisons, 'compliant_expectancy', signed(insight.compliantExpectancyR, 'r'));
    push(comparisons, 'non_compliant_expectancy', signed(insight.nonCompliantExpectancyR, 'r'));
    return {
      type: insight.type,
      subjectLabel: null,
      subjectKind: 'discipline',
      headline: signed(insight.differenceR, 'r'),
      headlineRole: null,
      comparisons: supporting(comparisons, null),
      tradeCount: null,
      nonAdditive: false,
    };
  }

  push(comparisons, 'checks_followed', neutral(rates.ruleChecksFollowedRate, 'percent'));
  return {
    type: insight.type,
    subjectLabel: null,
    subjectKind: 'discipline',
    headline: neutral(rates.tradeRuleAdherenceRate, 'percent'),
    // NAMED, always. Rule Checks Followed sits directly beneath it and the two
    // can be numerically identical when every Trade carries one required
    // check, so an unlabelled hero would be genuinely unreadable.
    headlineRole: 'rule_adherence',
    comparisons: supporting(comparisons, 'rule_adherence'),
    tradeCount: insight.sampleTradeCount,
    nonAdditive: false,
  };
}

/**
 * D8A publishes `sampleQuality` on Strategy insights only. Psychology and
 * Discipline get theirs derived from the SAME published policy floor rather
 * than from a second threshold invented here — the policy object is D8A's,
 * and the supported band is its own constant.
 */
function sampleQualityFor(tradeCount: number, policy: InsightPolicy): SampleQuality {
  if (tradeCount < policy.minimumCohortTradeCount) return 'insufficient';
  return tradeCount < policy.supportedCohortTradeCount ? 'limited' : 'supported';
}

function subjectLabel(subject: InsightSubject | null): string | null {
  if (subject === null) return null;
  if (subject.kind === 'confidence_level') return String(subject.level);
  if (subject.kind === 'discipline') return null;
  return subject.label;
}

/** A signed outcome keeps the tone its sign implies. */
function signed(metric: AnalyticsMetric, style: AnalyticsDisplayStyle): InsightFigure | null {
  const formatted = formatAnalyticsMetric(metric, style);
  return formatted.status === 'available' ? { text: formatted.text, tone: formatted.tone } : null;
}

/**
 * A rate is not a verdict (CLAUDE.md §1's rule for Win Rate applies equally
 * to Rule Adherence): 92% adherence is not "good" and 41% is not "bad"
 * without a population to compare against, so neither is coloured.
 */
function neutral(metric: AnalyticsMetric, style: AnalyticsDisplayStyle): InsightFigure | null {
  const figure = signed(metric, style);
  return figure === null ? null : { ...figure, tone: 'neutral' };
}

/**
 * The supporting figures beneath the hero: never a repeat of the hero itself,
 * and never more than two. Labelling the hero made the duplication visible —
 * a card showing "System expectancy +0.50R" twice spends a compact card's
 * scarcest space saying one thing.
 */
function supporting(
  comparisons: readonly InsightComparison[],
  headlineRole: InsightComparisonRole | null,
): readonly InsightComparison[] {
  return comparisons.filter((item) => item.role !== headlineRole).slice(0, 2);
}

function push(
  into: InsightComparison[],
  role: InsightComparisonRole,
  figure: InsightFigure | null,
): void {
  if (figure !== null) into.push({ role, figure });
}

/** D8A's coverage rates are ratios (`0.8788`), so the shared percent style applies. */
function percentText(rate: string): string {
  const formatted = formatAnalyticsMetric({ status: 'available', value: rate }, 'percent');
  return formatted.status === 'available' ? formatted.text : '—';
}
