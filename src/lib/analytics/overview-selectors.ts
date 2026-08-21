import Decimal from 'decimal.js';

import type {
  ComparisonAnalyticsModel,
  ConfidenceAnalyticsModel,
  ConfidenceLevelModel,
  EmotionGroupModel,
  FrameworkPerformanceAnalyticsModel,
  SetupPerformanceAnalyticsModel,
  SetupPerformanceModel,
  StrategyPerformanceModel,
} from './metrics';

/**
 * Analytics Overview (Phase 15C) presentation-layer selectors.
 *
 * These pick ONE observation out of data the server has ALREADY composed
 * (`AnalyticsSnapshot`, via `lib/analytics/metrics.ts`) — no new calculation,
 * no new DAL query, no new statistical method. Phase 15C §35 is explicit
 * that no server/DAL composition may be added this phase; everything below
 * operates purely on values already returned by `composeAnalyticsSnapshot`,
 * the same way `analytics-page.tsx`'s existing `buildScopeLabels` already
 * derives UI-only text from already-composed data.
 *
 * Every selector returns `null` when no truthful observation exists — the
 * caller must render "No strong pattern yet." (or the closer domain-specific
 * fallback) rather than inventing one (brief §8/§26).
 */

/** Trader-side only (Phase 13H's established primary behavioral axis — see Confidence/Setup Adherence's own headline KPI convention). */
export interface StrongestConfidenceObservation {
  readonly level: ConfidenceLevelModel['level'];
  readonly averageR: string;
  readonly tradeCount: number;
}

export function selectStrongestConfidenceLevel(
  confidence: ConfidenceAnalyticsModel,
): StrongestConfidenceObservation | null {
  let best: StrongestConfidenceObservation | null = null;
  let bestValue: Decimal | null = null;
  for (const level of confidence.levels) {
    if (level.trader.tradeCount === 0) continue;
    if (level.trader.averageR.status !== 'available') continue;
    const value = new Decimal(level.trader.averageR.value);
    if (bestValue === null || value.greaterThan(bestValue)) {
      bestValue = value;
      best = {
        level: level.level,
        averageR: level.trader.averageR.value,
        tradeCount: level.trader.tradeCount,
      };
    }
  }
  return best;
}

export interface EmotionObservation {
  readonly key: string;
  readonly label: string;
  readonly averageR: string;
  readonly tradeCount: number;
}

function eligibleEmotionEntries(
  emotions: readonly EmotionGroupModel[],
): { emotion: EmotionGroupModel; value: Decimal }[] {
  const entries: { emotion: EmotionGroupModel; value: Decimal }[] = [];
  for (const emotion of emotions) {
    if (emotion.trader.tradeCount === 0) continue;
    if (emotion.trader.averageR.status !== 'available') continue;
    entries.push({ emotion, value: new Decimal(emotion.trader.averageR.value) });
  }
  return entries;
}

/** The Trader-eligible Emotion group with the highest average R. */
export function selectStrongestEmotion(
  emotions: readonly EmotionGroupModel[],
): EmotionObservation | null {
  const entries = eligibleEmotionEntries(emotions);
  if (entries.length === 0) return null;
  const best = entries.reduce((a, b) => (b.value.greaterThan(a.value) ? b : a));
  return {
    key: best.emotion.key,
    label: best.emotion.label,
    averageR:
      best.emotion.trader.averageR.status === 'available'
        ? best.emotion.trader.averageR.value
        : '0',
    tradeCount: best.emotion.trader.tradeCount,
  };
}

/**
 * A genuinely underperforming Emotion group (negative average R), distinct
 * from the strongest group — never manufactured from "the worse of two
 * otherwise-fine groups" (brief §17's "no strong pattern yet" preference
 * over forced insight). Returns `null` when there is no second distinct
 * group, or when the worst group is not actually negative.
 */
export function selectEmotionConcern(
  emotions: readonly EmotionGroupModel[],
  excludeKey: string | null,
): EmotionObservation | null {
  const entries = eligibleEmotionEntries(emotions).filter(
    (entry) => entry.emotion.key !== excludeKey,
  );
  if (entries.length === 0) return null;
  const worst = entries.reduce((a, b) => (b.value.lessThan(a.value) ? b : a));
  if (!worst.value.lessThan(0)) return null;
  return {
    key: worst.emotion.key,
    label: worst.emotion.label,
    averageR:
      worst.emotion.trader.averageR.status === 'available'
        ? worst.emotion.trader.averageR.value
        : '0',
    tradeCount: worst.emotion.trader.tradeCount,
  };
}

/**
 * "Best observed" — never "Best" alone (brief §8/§12): `composeStrategyPerformance`/
 * `composeSetupPerformance` already sort by Trader average R descending, so
 * the first entry IS the best-observed one; this only guards the "no Trader
 * data at all" case (a System-only top entry, or an entirely empty list),
 * where there is nothing truthful to call "best observed".
 */
export function selectBestObservedStrategy(
  performance: FrameworkPerformanceAnalyticsModel,
): StrategyPerformanceModel | null {
  const top = performance.strategies[0];
  return top !== undefined && top.trader.tradeCount > 0 ? top : null;
}

export function selectBestObservedSetup(
  performance: SetupPerformanceAnalyticsModel,
): SetupPerformanceModel | null {
  const top = performance.setups[0];
  return top !== undefined && top.trader.tradeCount > 0 ? top : null;
}

export type ExecutionGapTone = 'behind' | 'ahead' | 'even';

export interface ExecutionGapObservation {
  readonly tone: ExecutionGapTone;
  readonly comparableCount: number;
}

/**
 * Classifies the PAIRED (never global-total) Execution Gap for the Overview
 * insight sentence — `null` when the paired population is empty or the
 * metric is otherwise unavailable, which callers must treat as "no truthful
 * comparison exists," never as a zero gap (brief §7).
 */
export function selectExecutionGapObservation(
  comparison: ComparisonAnalyticsModel,
): ExecutionGapObservation | null {
  if (comparison.comparableCount === 0) return null;
  if (comparison.averageExecutionGapR.status !== 'available') return null;
  const value = new Decimal(comparison.averageExecutionGapR.value);
  const tone: ExecutionGapTone = value.isZero() ? 'even' : value.isNegative() ? 'behind' : 'ahead';
  return { tone, comparableCount: comparison.comparableCount };
}
