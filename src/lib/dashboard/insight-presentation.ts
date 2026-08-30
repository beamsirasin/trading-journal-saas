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
  /**
   * HOW this statement should read, which is not the same for all three
   * pillars and must not be forced to be.
   *
   * `finding` leads with a named observation ("Strongest observed Strategy",
   * "Tagged Trades averaged below the baseline") and the figure is that
   * observation's evidence. `status` has no observation to name: Discipline
   * answers "am I following my rules?", and its answer IS the rate, so an
   * eyebrow above it could only restate the label already sitting beside the
   * number.
   */
  readonly presentation: 'finding' | 'status';
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
      /**
       * Trades carrying an unresolved required check, which are EXCLUDED from
       * the Trade Rule Adherence denominator. Surfaced so the card can say
       * that the headline rate does not describe every Trade — the scope
       * caveat, not a second finding.
       */
      readonly incompleteTradeCount: number;
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
  /**
   * EXACTLY ONE finding reaches the Dashboard, and there is deliberately no
   * `secondary` field to put a second one in.
   *
   * D8A still selects and publishes `secondaryInsight` for all three pillars
   * — the domain is untouched — but a second full statement, with its own
   * subject, its own hero figure and its own comparisons, is a second
   * independent analysis. Three of those on one row is the miniature report
   * the Dashboard is not. Each pillar's runner-up now lives at its Analytics
   * destination, which already renders it.
   */
  readonly primary: InsightStatementView | null;
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
    from: filters.customDateRange?.from ?? null,
    to: filters.customDateRange?.to ?? null,
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

  /*
    ONE SUPPORTING FIGURE, AND IT IS THE PAIR THE HEADLINE DOES NOT COVER.

    Actual expectancy is gone from this list. The card ranks on SYSTEM
    expectancy — "what is this Strategy offering?" — and the Execution Gap
    already answers "and how much of it am I taking?", which is the only
    follow-up question the headline raises. Actual expectancy is that same
    answer stated a third way, and on the populated fixture it rendered the
    same +0.35R the Psychology card prints two columns to the right under a
    different label. It is still on the payload and still in Analytics.

    Both roles are offered and `supporting` drops whichever one the headline
    already is, so the divergence branch (headline = Gap) falls back to
    System expectancy without a second code path.
  */
  const comparisons: InsightComparison[] = [];
  push(comparisons, 'system_expectancy', signed(metrics.systemExpectancyR, 'r'));
  push(comparisons, 'average_execution_gap', signed(metrics.averageExecutionGapR, 'r'));

  return {
    type: insight.type,
    presentation: 'finding',
    subjectLabel: subjectLabel(insight.subject),
    subjectKind: insight.subject.kind,
    headline,
    headlineRole,
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
  /*
    THE BASELINE IS THE ONLY SUPPORTING FIGURE, AND IT IS MANDATORY.

    This card's claim is inherently comparative — "-0.13R" says nothing
    without "+0.35R" beside it — so the baseline is the one number that must
    never leave. The cohort's Average Execution Gap did leave: it is a
    fourth Gap figure on a page that already has a section devoted to the
    Gap, and it answers a different question from the one this card asks.
  */
  const comparisons: InsightComparison[] = [];
  push(comparisons, 'scoped_baseline', signed(insight.scopedBaselineActualR, 'r'));

  return {
    type: insight.type,
    presentation: 'finding',
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
    // Both domain counts, summed the same way `composeDisciplinePillar` sums
    // them when it decides whether the checklist is incomplete. Nothing is
    // recomputed and no count is invented.
    incompleteTradeCount:
      pillar.coverage.incompleteTradeCount + pillar.coverage.unrecordedRequiredCheckTradeCount,
  };
  if (pillar.primaryInsight === null) {
    return {
      ...base('discipline', filters),
      status: pillar.status,
      reason: pillar.reason,
      primary: null,
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
    sample: {
      quality: sampleQualityFor(pillar.coverage.evaluatedTradeCount, policy),
      tradeCount: pillar.coverage.evaluatedTradeCount,
    },
    coverage,
    minimumCohortTradeCount: policy.minimumCohortTradeCount,
  };
}

/**
 * TRADE RULE ADHERENCE LEADS THIS CARD, ALWAYS — A DASHBOARD PRESENTATION
 * OVERRIDE, NOT A DOMAIN CHANGE.
 *
 * D8A's own precedence lets `required_checks_incomplete` become the primary
 * statement whenever a single unresolved required check exists, and lets
 * `adherence_performance_difference` or `issue_associated_execution_gap`
 * take the hero when they qualify. That precedence is correct for the domain
 * and is untouched — `composeDisciplinePillar` still selects exactly what it
 * selected before, and Analytics still reads it.
 *
 * What changed is what the DASHBOARD asks. This card answers one question,
 * "am I following my rules?", and the answer to that is a rate. A card whose
 * hero figure changes identity between visits — a percentage one day, a
 * signed R difference the next — cannot be scanned, and a data-completeness
 * warning is a caveat on the answer rather than the answer itself. So the
 * hero is Trade Rule Adherence in every branch, Rule Checks Followed rides
 * beside it, and incompleteness becomes the scope caveat it always was (see
 * `InsightCoverageView`'s `incompleteTradeCount`).
 *
 * THE TWO RATES ARE NEVER MERGED. Rule Checks Followed is check-level
 * (`followed / (followed + violated)`); Trade Rule Adherence is Trade-level
 * (fully compliant evaluated Trades / all fully evaluated Trades, with any
 * Trade holding an unresolved required check excluded from the denominator).
 * They keep separate roles so neither is ever printed under the other's name.
 *
 * The insight's own `type` still rides along, so the DOM records which branch
 * D8A chose even though the card no longer renders that branch's own shape.
 */
function disciplineStatement(
  insight: DisciplineInsight,
  rates: DisciplinePerformanceInsightData['supportingMetrics'],
): InsightStatementView {
  const comparisons: InsightComparison[] = [];
  push(comparisons, 'checks_followed', neutral(rates.ruleChecksFollowedRate, 'percent'));
  return {
    type: insight.type,
    // Status, not finding: there is no observation to name above a rate whose
    // own label already sits beside it.
    presentation: 'status',
    subjectLabel: null,
    subjectKind: 'discipline',
    headline: neutral(rates.tradeRuleAdherenceRate, 'percent'),
    // NAMED, always. Rule Checks Followed sits directly beneath it and the two
    // can be numerically identical when every Trade carries one required
    // check, so an unlabelled hero would be genuinely unreadable.
    headlineRole: 'rule_adherence',
    comparisons: supporting(comparisons, 'rule_adherence'),
    tradeCount:
      insight.type === 'issue_associated_execution_gap'
        ? insight.affectedTradeCount
        : insight.type === 'adherence_performance_difference'
          ? null
          : insight.sampleTradeCount,
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
