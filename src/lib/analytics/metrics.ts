import {
  averageLossR,
  averageR,
  averageWinR,
  expectancyR,
  payoffRatio,
  profitFactor,
  selectSystemEligible,
  selectTraderEligible,
  totalR,
  winRate,
} from '@/lib/calc/aggregate';
import {
  averageExecutionGapR,
  executionEfficiency,
  pairedExecutionGapR,
  ruleAdherenceRate,
  selectComparisonEligible,
} from '@/lib/calc/attribution';
import { CalcDecimal } from '@/lib/calc/decimal';
import { equityCurveR, maximumDrawdownR } from '@/lib/calc/equity';
import {
  averageSetupAdherence,
  conditionsMetRate,
  SETUP_ADHERENCE_BUCKETS,
  setupAdherenceBucket,
  type SetupAdherenceBucketId,
} from '@/lib/calc/setup-adherence';
import { type CalcFailureReason, type CalcResult } from '@/lib/calc/types';
import type {
  OutcomeValue,
  RuleCheckStatus,
  SystemStatus,
  TradeStatus,
} from '@/lib/trades/constants';

import type { AnalyticsDateBounds, AnalyticsDatePreset } from './filters';

export const ANALYTICS_UNAVAILABLE_REASONS = [
  'no_trades',
  'no_wins',
  'no_losses',
  'no_profit_or_loss',
  'no_comparable_trades',
  'system_has_no_edge',
  'no_rule_checks',
  'no_conditions_applicable',
  'no_confidence_recorded',
] as const;

export type AnalyticsUnavailableReason = (typeof ANALYTICS_UNAVAILABLE_REASONS)[number];

export type AnalyticsMetric<T = string> =
  | { readonly status: 'available'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: AnalyticsUnavailableReason }
  | { readonly status: 'error'; readonly reason: 'data_integrity_error' };

const FAILURE_CLASSIFICATION = {
  missing_input: 'data_integrity_error',
  invalid_decimal: 'data_integrity_error',
  invalid_direction: 'data_integrity_error',
  zero_risk: 'data_integrity_error',
  invalid_risk_direction: 'data_integrity_error',
  invalid_target_direction: 'data_integrity_error',
  invalid_initial_risk: 'data_integrity_error',
  invalid_system_cost: 'data_integrity_error',
  unresolved_system_outcome: 'data_integrity_error',
  system_no_trade: 'data_integrity_error',
  invalid_planned_risk: 'data_integrity_error',
  invalid_planned_reward: 'data_integrity_error',
  invalid_actual_mode: 'data_integrity_error',
  invalid_exit_shape: 'data_integrity_error',
  invalid_closed_bps: 'data_integrity_error',
  no_trades: 'no_trades',
  no_wins: 'no_wins',
  no_losses: 'no_losses',
  no_profit_or_loss: 'no_profit_or_loss',
  system_has_no_edge: 'system_has_no_edge',
  no_comparable_trades: 'no_comparable_trades',
  no_rule_checks: 'no_rule_checks',
  no_conditions_applicable: 'no_conditions_applicable',
  no_confidence_recorded: 'no_confidence_recorded',
} as const satisfies Record<CalcFailureReason, AnalyticsUnavailableReason | 'data_integrity_error'>;

/** Exhaustive, sanitized boundary from calculation failures to UI-safe metric states. */
export function toAnalyticsMetric<T>(result: CalcResult<T>): AnalyticsMetric<T> {
  if (result.ok) return { status: 'available', value: result.value };
  const classification = FAILURE_CLASSIFICATION[result.reason];
  return classification === 'data_integrity_error'
    ? { status: 'error', reason: 'data_integrity_error' }
    : { status: 'unavailable', reason: classification };
}

function integrityError<T>(): AnalyticsMetric<T> {
  return { status: 'error', reason: 'data_integrity_error' };
}

export interface TraderMetricRecord {
  readonly tradeId: string;
  readonly status: TradeStatus | string;
  readonly deletedAt: Date | null;
  readonly actualR: string | null;
  readonly traderOutcome: OutcomeValue | null;
  readonly exitedAt: string;
}

export interface SystemMetricRecord {
  readonly tradeId: string;
  readonly systemStatus: SystemStatus | string;
  readonly deletedAt: Date | null;
  readonly systemR: string | null;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemExitedAt: string;
}

export interface AnalyticsEquityPoint {
  readonly tradeId: string;
  readonly occurredAt: string;
  readonly cumulativeR: string;
}

export interface PerformanceAnalyticsModel {
  readonly sampleCount: number;
  readonly totalR: AnalyticsMetric;
  readonly winRate: AnalyticsMetric;
  readonly averageR: AnalyticsMetric;
  readonly expectancyR: AnalyticsMetric;
  readonly profitFactor: AnalyticsMetric;
  readonly maximumDrawdownR: AnalyticsMetric;
  readonly averageWinR: AnalyticsMetric;
  readonly averageLossR: AnalyticsMetric;
  readonly payoffRatio: AnalyticsMetric;
  readonly equityCurve: AnalyticsMetric<readonly AnalyticsEquityPoint[]>;
}

interface AxisRecord {
  readonly tradeId: string;
  readonly r: string;
  readonly outcome: OutcomeValue;
  readonly occurredAt: string;
}

function composePerformanceAxis(records: readonly AxisRecord[]): PerformanceAnalyticsModel {
  const rValues = records.map((record) => record.r);
  const outcomeRecords = records.map((record) => ({ r: record.r, outcome: record.outcome }));
  const datedRecords = records.map((record) => ({
    id: record.tradeId,
    occurredAt: new Date(record.occurredAt),
    r: record.r,
  }));
  const hasInvalidTimestamp = datedRecords.some((record) =>
    Number.isNaN(record.occurredAt.getTime()),
  );

  const equity = hasInvalidTimestamp ? null : equityCurveR(datedRecords);
  const drawdown = hasInvalidTimestamp ? null : maximumDrawdownR(datedRecords);

  return {
    sampleCount: records.length,
    totalR: toAnalyticsMetric(totalR(rValues)),
    winRate: toAnalyticsMetric(winRate(outcomeRecords)),
    averageR: toAnalyticsMetric(averageR(rValues)),
    expectancyR: toAnalyticsMetric(expectancyR(rValues)),
    profitFactor: toAnalyticsMetric(profitFactor(rValues)),
    maximumDrawdownR: drawdown === null ? integrityError() : toAnalyticsMetric(drawdown),
    averageWinR: toAnalyticsMetric(averageWinR(outcomeRecords)),
    averageLossR: toAnalyticsMetric(averageLossR(outcomeRecords)),
    payoffRatio: toAnalyticsMetric(payoffRatio(outcomeRecords)),
    equityCurve:
      equity === null
        ? integrityError()
        : equity.ok
          ? {
              status: 'available',
              value: equity.value.map((point) => ({
                tradeId: point.tradeId,
                occurredAt: point.occurredAt.toISOString(),
                cumulativeR: point.cumulativeR,
              })),
            }
          : toAnalyticsMetric(equity),
  };
}

export function composeTraderAnalytics(
  records: readonly TraderMetricRecord[],
): PerformanceAnalyticsModel {
  const eligible = selectTraderEligible(records);
  return composePerformanceAxis(
    eligible.map((record) => ({
      tradeId: record.tradeId,
      r: record.actualR as string,
      outcome: record.traderOutcome as OutcomeValue,
      occurredAt: record.exitedAt,
    })),
  );
}

export function composeSystemAnalytics(
  records: readonly SystemMetricRecord[],
): PerformanceAnalyticsModel {
  const eligible = selectSystemEligible(records);
  return composePerformanceAxis(
    eligible.map((record) => ({
      tradeId: record.tradeId,
      r: record.systemR as string,
      outcome: record.systemOutcome as OutcomeValue,
      occurredAt: record.systemExitedAt,
    })),
  );
}

export interface ComparisonMetricRecord {
  readonly tradeId: string;
  readonly actualR: string | null;
  readonly systemR: string | null;
}

export interface ComparisonAnalyticsModel {
  readonly comparableCount: number;
  readonly pairedSystemTotalR: AnalyticsMetric;
  readonly pairedActualTotalR: AnalyticsMetric;
  /** `actualR - systemR`, summed over the paired population (Phase 13H §6's "cumulative/total gap"). */
  readonly executionGapR: AnalyticsMetric;
  /** `AVG(actualR - systemR)` over the paired population — Phase 13H's PRIMARY Execution Gap aggregate (§6). */
  readonly averageExecutionGapR: AnalyticsMetric;
  readonly executionEfficiency: AnalyticsMetric;
}

export function composeComparisonAnalytics(
  records: readonly ComparisonMetricRecord[],
): ComparisonAnalyticsModel {
  const eligible = selectComparisonEligible(records).map((record) => ({
    tradeId: record.tradeId,
    actualR: record.actualR as string,
    systemR: record.systemR as string,
  }));
  if (eligible.length === 0) {
    const unavailable = {
      status: 'unavailable',
      reason: 'no_comparable_trades',
    } as const;
    return {
      comparableCount: 0,
      pairedSystemTotalR: unavailable,
      pairedActualTotalR: unavailable,
      executionGapR: unavailable,
      averageExecutionGapR: unavailable,
      executionEfficiency: unavailable,
    };
  }

  return {
    comparableCount: eligible.length,
    pairedSystemTotalR: toAnalyticsMetric(totalR(eligible.map((record) => record.systemR))),
    pairedActualTotalR: toAnalyticsMetric(totalR(eligible.map((record) => record.actualR))),
    executionGapR: toAnalyticsMetric(pairedExecutionGapR(eligible)),
    averageExecutionGapR: toAnalyticsMetric(averageExecutionGapR(eligible)),
    executionEfficiency: toAnalyticsMetric(executionEfficiency(eligible)),
  };
}

export interface RuleMetricRecord {
  readonly checkStatus: RuleCheckStatus | string;
}

export interface RuleAnalyticsModel {
  readonly followedCount: number;
  readonly violatedCount: number;
  readonly notCheckedCount: number;
  readonly notApplicableCount: number;
  readonly evaluatedCount: number;
  readonly adherenceRate: AnalyticsMetric;
}

export function composeRuleAnalytics(records: readonly RuleMetricRecord[]): RuleAnalyticsModel {
  let followedCount = 0;
  let violatedCount = 0;
  let notCheckedCount = 0;
  let notApplicableCount = 0;
  for (const record of records) {
    if (record.checkStatus === 'followed') followedCount += 1;
    else if (record.checkStatus === 'violated') violatedCount += 1;
    else if (record.checkStatus === 'not_checked') notCheckedCount += 1;
    else if (record.checkStatus === 'not_applicable') notApplicableCount += 1;
  }

  return {
    followedCount,
    violatedCount,
    notCheckedCount,
    notApplicableCount,
    evaluatedCount: followedCount + violatedCount,
    adherenceRate: toAnalyticsMetric(
      ruleAdherenceRate(records.map((record) => ({ status: record.checkStatus }))),
    ),
  };
}

export interface MistakeMetricRecord {
  readonly tradeId: string;
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
}

export interface MistakeCountModel {
  readonly mistakeTypeId: string;
  readonly key: string;
  readonly label: string;
  readonly tradeCount: number;
}

export function composeMistakeAnalytics(
  records: readonly MistakeMetricRecord[],
): readonly MistakeCountModel[] {
  const counts = new Map<string, MistakeCountModel>();
  const seenPairs = new Set<string>();
  for (const record of records) {
    const pairKey = `${record.tradeId}:${record.mistakeTypeId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const current = counts.get(record.mistakeTypeId);
    counts.set(record.mistakeTypeId, {
      mistakeTypeId: record.mistakeTypeId,
      key: record.key,
      label: record.label,
      tradeCount: (current?.tradeCount ?? 0) + 1,
    });
  }
  return [...counts.values()].sort(
    (a, b) => b.tradeCount - a.tradeCount || a.key.localeCompare(b.key),
  );
}

// ---------------------------------------------------------------------------
// Phase 13H — behavioral-dimension shared shapes
//
// Every behavioral dimension below (Setup Adherence, Condition, Confidence,
// Emotion) is composed from TWO independently-fetched record arrays — one
// Trader-eligible (closed, `actual_r`/`trader_outcome`/`exited_at`, dated by
// `exited_at`), one System-eligible (`system_status = 'resolved'`,
// `system_r`/`system_outcome`/`system_exited_at`, dated by `system_exited_at`)
// — exactly mirroring `composeTraderAnalytics`/`composeSystemAnalytics`'s own
// independence. A Trade may contribute to neither, either, or both sides of
// any given bucket/level/group; nothing here ever intersects the two
// populations (that intersection is exclusively `composeComparisonAnalytics`,
// for the paired Execution Gap).
// ---------------------------------------------------------------------------

/** One axis's (Trader's or System's) independent sample for one behavioral bucket/level/group. */
export interface DimensionAxisSummary {
  readonly tradeCount: number;
  readonly averageR: AnalyticsMetric;
  readonly winRate: AnalyticsMetric;
}

function summarizeAxis(
  records: readonly { r: string; outcome: OutcomeValue }[],
): DimensionAxisSummary {
  return {
    tradeCount: records.length,
    averageR: toAnalyticsMetric(averageR(records.map((r) => r.r))),
    winRate: toAnalyticsMetric(winRate(records)),
  };
}

// ---------------------------------------------------------------------------
// Phase 13H — Setup Adherence
// ---------------------------------------------------------------------------

/** Reused for both the Trader-eligible and System-eligible reads — `r`/`outcome` already normalized to the calling axis at the service boundary. */
export interface SetupAdherenceMetricRecord {
  readonly tradeId: string;
  readonly metCount: number;
  readonly totalCount: number;
  readonly r: string;
  readonly outcome: OutcomeValue;
}

export interface SetupAdherenceBucketModel {
  readonly bucket: SetupAdherenceBucketId;
  readonly trader: DimensionAxisSummary;
  readonly system: DimensionAxisSummary;
}

export interface SetupAdherenceAnalyticsModel {
  /** Trader-eligible sample count — the population the primary/secondary metrics below are computed over. */
  readonly sampleCount: number;
  /** Primary period metric (§8) — `AVG(per-Trade adherence)` over the Trader-eligible population, each Trade weighted equally. Unchanged by this completion patch. */
  readonly averageAdherence: AnalyticsMetric;
  /** Secondary metric (§9) — `SUM(met)/SUM(applicable)`, Trader-eligible population. Never labeled interchangeably with `averageAdherence`. Unchanged by this completion patch. */
  readonly conditionsMetRate: AnalyticsMetric;
  /** Each bucket is a Trade's OWN adherence ratio; the Trader/System sub-populations that fall into it are independently eligible (§3). */
  readonly buckets: readonly SetupAdherenceBucketModel[];
}

function bucketAdherenceByAxis(
  records: readonly SetupAdherenceMetricRecord[],
): Map<SetupAdherenceBucketId, DimensionAxisSummary> {
  const grouped = new Map<SetupAdherenceBucketId, { r: string; outcome: OutcomeValue }[]>();
  for (const bucket of SETUP_ADHERENCE_BUCKETS) grouped.set(bucket, []);
  for (const record of records) {
    if (record.totalCount <= 0) continue;
    const ratio = new CalcDecimal(record.metCount).dividedBy(record.totalCount);
    const bucket = setupAdherenceBucket(ratio);
    grouped.get(bucket)?.push({ r: record.r, outcome: record.outcome });
  }
  const summarized = new Map<SetupAdherenceBucketId, DimensionAxisSummary>();
  for (const bucket of SETUP_ADHERENCE_BUCKETS) {
    summarized.set(bucket, summarizeAxis(grouped.get(bucket) ?? []));
  }
  return summarized;
}

export function composeSetupAdherenceAnalytics(
  traderRecords: readonly SetupAdherenceMetricRecord[],
  systemRecords: readonly SetupAdherenceMetricRecord[],
): SetupAdherenceAnalyticsModel {
  const counts = traderRecords.map((record) => ({
    metCount: record.metCount,
    totalCount: record.totalCount,
  }));
  const traderBuckets = bucketAdherenceByAxis(traderRecords);
  const systemBuckets = bucketAdherenceByAxis(systemRecords);

  return {
    sampleCount: traderRecords.length,
    averageAdherence: toAnalyticsMetric(averageSetupAdherence(counts)),
    conditionsMetRate: toAnalyticsMetric(conditionsMetRate(counts)),
    buckets: SETUP_ADHERENCE_BUCKETS.map((bucket) => ({
      bucket,
      // Non-null: bucketAdherenceByAxis seeds every bucket id up front.
      trader: traderBuckets.get(bucket) as DimensionAxisSummary,
      system: systemBuckets.get(bucket) as DimensionAxisSummary,
    })),
  };
}

// ---------------------------------------------------------------------------
// Phase 13H — Condition-level analytics
// ---------------------------------------------------------------------------

/** Reused for both the Trader-eligible and System-eligible reads. */
export interface ConditionMetricRecord {
  readonly tradeId: string;
  readonly setupId: string;
  readonly conditionKey: string;
  readonly label: string;
  readonly checkStatus: 'met' | 'not_met' | string;
  readonly r: string;
  readonly outcome: OutcomeValue;
  readonly occurredAt: string;
}

export interface ConditionAxisSummary {
  readonly met: DimensionAxisSummary;
  readonly notMet: DimensionAxisSummary;
}

export interface ConditionAnalyticsModel {
  readonly setupId: string;
  readonly conditionKey: string;
  /** The most-recent-by-exit snapshot label for this (setupId, conditionKey) group, across whichever axis has the latest occurrence — §12: a stable current display label, grouping stays by identity, never a silent pretense that historical labels were always identical. */
  readonly label: string;
  readonly trader: ConditionAxisSummary;
  readonly system: ConditionAxisSummary;
}

interface ConditionGroupState {
  setupId: string;
  conditionKey: string;
  label: string;
  latestOccurredAt: string;
  traderMet: { r: string; outcome: OutcomeValue }[];
  traderNotMet: { r: string; outcome: OutcomeValue }[];
  systemMet: { r: string; outcome: OutcomeValue }[];
  systemNotMet: { r: string; outcome: OutcomeValue }[];
}

function conditionGroupKey(setupId: string, conditionKey: string): string {
  return `${setupId}:${conditionKey}`;
}

function ensureConditionGroup(
  groups: Map<string, ConditionGroupState>,
  record: ConditionMetricRecord,
): ConditionGroupState {
  const key = conditionGroupKey(record.setupId, record.conditionKey);
  let group = groups.get(key);
  if (group === undefined) {
    group = {
      setupId: record.setupId,
      conditionKey: record.conditionKey,
      label: record.label,
      latestOccurredAt: record.occurredAt,
      traderMet: [],
      traderNotMet: [],
      systemMet: [],
      systemNotMet: [],
    };
    groups.set(key, group);
  }
  if (record.occurredAt >= group.latestOccurredAt) {
    group.label = record.label;
    group.latestOccurredAt = record.occurredAt;
  }
  return group;
}

/**
 * Groups by (setupId, conditionKey) — the stable identity that survives
 * Setup Version copy-on-write (§11/§12). Does NOT require a Trade to appear
 * in both axes: a Trade present only in `systemRecords` still contributes to
 * that Condition's `system` summary with zero effect on `trader`, and vice
 * versa (§4).
 */
export function composeConditionAnalytics(
  traderRecords: readonly ConditionMetricRecord[],
  systemRecords: readonly ConditionMetricRecord[],
): readonly ConditionAnalyticsModel[] {
  const groups = new Map<string, ConditionGroupState>();

  for (const record of traderRecords) {
    const group = ensureConditionGroup(groups, record);
    const entry = { r: record.r, outcome: record.outcome };
    if (record.checkStatus === 'met') group.traderMet.push(entry);
    else if (record.checkStatus === 'not_met') group.traderNotMet.push(entry);
  }
  for (const record of systemRecords) {
    const group = ensureConditionGroup(groups, record);
    const entry = { r: record.r, outcome: record.outcome };
    if (record.checkStatus === 'met') group.systemMet.push(entry);
    else if (record.checkStatus === 'not_met') group.systemNotMet.push(entry);
  }

  return [...groups.values()]
    .map((group) => ({
      setupId: group.setupId,
      conditionKey: group.conditionKey,
      label: group.label,
      trader: { met: summarizeAxis(group.traderMet), notMet: summarizeAxis(group.traderNotMet) },
      system: { met: summarizeAxis(group.systemMet), notMet: summarizeAxis(group.systemNotMet) },
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.conditionKey.localeCompare(b.conditionKey));
}

// ---------------------------------------------------------------------------
// Phase 13H — Confidence analytics
// ---------------------------------------------------------------------------

export const CONFIDENCE_ANALYTICS_LEVELS = [0, 25, 50, 75, 100] as const;

/** Reused for both the Trader-eligible and System-eligible reads. */
export interface ConfidenceMetricRecord {
  readonly tradeId: string;
  readonly confidence: number;
  readonly r: string;
  readonly outcome: OutcomeValue;
}

export interface ConfidenceLevelModel {
  readonly level: (typeof CONFIDENCE_ANALYTICS_LEVELS)[number];
  readonly trader: DimensionAxisSummary;
  readonly system: DimensionAxisSummary;
}

export interface ConfidenceAnalyticsModel {
  /** Trader-eligible sample count — the population `averageConfidence` is computed over. */
  readonly sampleCount: number;
  /**
   * Only Trades where Confidence was recorded — `NULL` is excluded, `0` is a
   * real recorded value and is included. Deliberately stays scoped to the
   * Trader-eligible population as the one concise primary KPI (§5) rather
   * than duplicating into Trader/System variants; the per-level breakdown
   * below is where both axes are independently truthful.
   */
  readonly averageConfidence: AnalyticsMetric;
  readonly levels: readonly ConfidenceLevelModel[];
}

function groupConfidenceByLevel(
  records: readonly ConfidenceMetricRecord[],
): Map<number, { r: string; outcome: OutcomeValue }[]> {
  const byLevel = new Map<number, { r: string; outcome: OutcomeValue }[]>();
  for (const level of CONFIDENCE_ANALYTICS_LEVELS) byLevel.set(level, []);
  for (const record of records) {
    byLevel.get(record.confidence)?.push({ r: record.r, outcome: record.outcome });
  }
  return byLevel;
}

export function composeConfidenceAnalytics(
  traderRecords: readonly ConfidenceMetricRecord[],
  systemRecords: readonly ConfidenceMetricRecord[],
): ConfidenceAnalyticsModel {
  const traderByLevel = groupConfidenceByLevel(traderRecords);
  const systemByLevel = groupConfidenceByLevel(systemRecords);

  const averageConfidence: AnalyticsMetric =
    traderRecords.length === 0
      ? { status: 'unavailable', reason: 'no_confidence_recorded' }
      : toAnalyticsMetric(
          averageR(traderRecords.map((record) => (record.confidence / 100).toFixed(4))),
        );

  return {
    sampleCount: traderRecords.length,
    averageConfidence,
    levels: CONFIDENCE_ANALYTICS_LEVELS.map((level) => ({
      level,
      trader: summarizeAxis(traderByLevel.get(level) ?? []),
      system: summarizeAxis(systemByLevel.get(level) ?? []),
    })),
  };
}

// ---------------------------------------------------------------------------
// Phase 13H — Emotion analytics
// ---------------------------------------------------------------------------

/** Reused for both the Trader-eligible and System-eligible reads. */
export interface EmotionMetricRecord {
  readonly tradeId: string;
  readonly key: string;
  readonly label: string;
  readonly r: string;
  readonly outcome: OutcomeValue;
}

export interface EmotionGroupModel {
  readonly key: string;
  readonly label: string;
  /**
   * Independent Trader/System samples for this Emotion group. A
   * multi-Emotion Trade belongs to every one of its Emotion groups (§16) —
   * the SUM of every group's `trader.tradeCount` may legitimately exceed the
   * unique Trader-eligible Trade count overall, and `trader`/`system` counts
   * are never presented as shares of one combined total.
   */
  readonly trader: DimensionAxisSummary;
  readonly system: DimensionAxisSummary;
}

interface EmotionGroupState {
  label: string;
  entries: { r: string; outcome: OutcomeValue }[];
}

function groupEmotionsByKey(
  records: readonly EmotionMetricRecord[],
): Map<string, EmotionGroupState> {
  const groups = new Map<string, EmotionGroupState>();
  for (const record of records) {
    let group = groups.get(record.key);
    if (group === undefined) {
      group = { label: record.label, entries: [] };
      groups.set(record.key, group);
    }
    group.entries.push({ r: record.r, outcome: record.outcome });
  }
  return groups;
}

/**
 * Groups by canonical Emotion key. Multi-Emotion Trades intentionally appear
 * in multiple groups (§16); recorded-zero and not-recorded Trades never
 * appear in any group (§15). Does NOT require a Trade to appear in both
 * axes — a Trade present only in `systemRecords` still contributes to that
 * Emotion's `system` summary with zero effect on `trader`, and vice versa.
 */
export function composeEmotionAnalytics(
  traderRecords: readonly EmotionMetricRecord[],
  systemRecords: readonly EmotionMetricRecord[],
): readonly EmotionGroupModel[] {
  const traderGroups = groupEmotionsByKey(traderRecords);
  const systemGroups = groupEmotionsByKey(systemRecords);
  const keys = new Set([...traderGroups.keys(), ...systemGroups.keys()]);

  return [...keys]
    .map((key) => {
      const trader = traderGroups.get(key);
      const system = systemGroups.get(key);
      return {
        key,
        label: trader?.label ?? system?.label ?? key,
        trader: summarizeAxis(trader?.entries ?? []),
        system: summarizeAxis(system?.entries ?? []),
      };
    })
    .sort(
      (a, b) =>
        b.trader.tradeCount + b.system.tradeCount - (a.trader.tradeCount + a.system.tradeCount) ||
        a.key.localeCompare(b.key),
    );
}

export interface AnalyticsScopeModel {
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
  readonly timezone: string;
}

export interface AnalyticsSnapshotInput {
  readonly scope: AnalyticsScopeModel;
  readonly trader: readonly TraderMetricRecord[];
  readonly system: readonly SystemMetricRecord[];
  /** Phase 14C §19 — a pure passthrough count, never a formula input. See `AnalyticsSnapshot.systemPendingCount`. */
  readonly systemPendingCount: number;
  readonly comparison: readonly ComparisonMetricRecord[];
  readonly rules: readonly RuleMetricRecord[];
  readonly mistakes: readonly MistakeMetricRecord[];
  readonly setupAdherence: readonly SetupAdherenceMetricRecord[];
  readonly setupAdherenceSystem: readonly SetupAdherenceMetricRecord[];
  readonly conditions: readonly ConditionMetricRecord[];
  readonly conditionsSystem: readonly ConditionMetricRecord[];
  readonly confidence: readonly ConfidenceMetricRecord[];
  readonly confidenceSystem: readonly ConfidenceMetricRecord[];
  readonly emotions: readonly EmotionMetricRecord[];
  readonly emotionsSystem: readonly EmotionMetricRecord[];
}

export interface AnalyticsSnapshot {
  readonly scope: AnalyticsScopeModel;
  readonly trader: PerformanceAnalyticsModel;
  readonly system: PerformanceAnalyticsModel;
  /**
   * Count of `system_status = 'pending'` Trades in the current
   * Account/Strategy/Setup scope (Phase 14C §19) — NEVER date-bounded (a
   * pending Trade has no `system_exited_at`), and NEVER a member of
   * `system`'s own eligible population or any formula. Purely a truthful
   * "how many are waiting" disclosure alongside System Performance.
   */
  readonly systemPendingCount: number;
  readonly comparison: ComparisonAnalyticsModel;
  readonly rules: RuleAnalyticsModel;
  readonly mistakes: readonly MistakeCountModel[];
  readonly setupAdherence: SetupAdherenceAnalyticsModel;
  readonly conditions: readonly ConditionAnalyticsModel[];
  readonly confidence: ConfidenceAnalyticsModel;
  readonly emotions: readonly EmotionGroupModel[];
}

export function composeAnalyticsSnapshot(input: AnalyticsSnapshotInput): AnalyticsSnapshot {
  return {
    scope: input.scope,
    trader: composeTraderAnalytics(input.trader),
    system: composeSystemAnalytics(input.system),
    systemPendingCount: input.systemPendingCount,
    comparison: composeComparisonAnalytics(input.comparison),
    rules: composeRuleAnalytics(input.rules),
    mistakes: composeMistakeAnalytics(input.mistakes),
    setupAdherence: composeSetupAdherenceAnalytics(
      input.setupAdherence,
      input.setupAdherenceSystem,
    ),
    conditions: composeConditionAnalytics(input.conditions, input.conditionsSystem),
    confidence: composeConfidenceAnalytics(input.confidence, input.confidenceSystem),
    emotions: composeEmotionAnalytics(input.emotions, input.emotionsSystem),
  };
}

export interface DashboardOverview {
  readonly scope: AnalyticsScopeModel;
  readonly trader: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
  readonly system: Pick<
    PerformanceAnalyticsModel,
    'sampleCount' | 'totalR' | 'expectancyR' | 'winRate' | 'profitFactor'
  >;
  readonly comparison: ComparisonAnalyticsModel;
  readonly systemPendingCount: number;
}

/** Selects the Phase 09D headline subset without recalculating any metric. */
export function composeDashboardOverview(snapshot: AnalyticsSnapshot): DashboardOverview {
  const selectAxis = (axis: PerformanceAnalyticsModel) => ({
    sampleCount: axis.sampleCount,
    totalR: axis.totalR,
    expectancyR: axis.expectancyR,
    winRate: axis.winRate,
    profitFactor: axis.profitFactor,
  });
  return {
    scope: snapshot.scope,
    trader: selectAxis(snapshot.trader),
    system: selectAxis(snapshot.system),
    comparison: snapshot.comparison,
    systemPendingCount: snapshot.systemPendingCount,
  };
}
