import { CalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * One Trade's recorded Setup Condition snapshot counts. `totalCount` is the
 * number of Conditions the pinned Setup Version had (`applicable`);
 * `metCount` is how many were snapshotted `met`. A Trade with zero
 * snapshot rows — historical "not recorded" or a genuinely zero-Condition
 * Setup Version ("not configured") — is never represented here; both
 * excluded upstream (Phase 13G's three-state disclosure), never coerced to
 * `totalCount: 0` or a fake `0%`.
 */
export interface SetupAdherenceCounts {
  readonly metCount: number;
  readonly totalCount: number;
}

/**
 * Per-Trade Setup Adherence (§7) = `met / applicable`. `totalCount` must be
 * strictly positive — the caller is responsible for excluding "not
 * recorded"/"not configured" Trades before calling this.
 */
export function setupAdherenceRatio(counts: SetupAdherenceCounts): CalcResult<string> {
  if (counts.totalCount <= 0) return calcErr('no_conditions_applicable');
  return calcOk(toCanonicalR(new CalcDecimal(counts.metCount).dividedBy(counts.totalCount)));
}

/**
 * `Average Setup Adherence` (§8) — the PRIMARY period metric —
 * `AVG(per-Trade setupAdherence)`, each Trade weighted equally regardless of
 * how many Conditions its own Setup has. `(50% + 90%) / 2 = 70%`, never
 * `SUM(met)/SUM(applicable)` (that is {@link conditionsMetRate}, a
 * deliberately distinct, separately-labeled secondary metric — §7/§9).
 */
export function averageSetupAdherence(
  records: readonly SetupAdherenceCounts[],
): CalcResult<string> {
  if (records.length === 0) return calcErr('no_conditions_applicable');
  let sum = new CalcDecimal(0);
  for (const record of records) {
    if (record.totalCount <= 0) return calcErr('no_conditions_applicable');
    sum = sum.plus(new CalcDecimal(record.metCount).dividedBy(record.totalCount));
  }
  return calcOk(toCanonicalR(sum.dividedBy(records.length)));
}

/**
 * `Conditions Met Rate` (§9) — the SECONDARY metric — `SUM(met) /
 * SUM(applicable)`, weighting each individual Condition equally rather than
 * each Trade, so a Setup with more Conditions contributes more
 * observations. Deliberately never labeled interchangeably with
 * {@link averageSetupAdherence}.
 */
export function conditionsMetRate(records: readonly SetupAdherenceCounts[]): CalcResult<string> {
  if (records.length === 0) return calcErr('no_conditions_applicable');
  let met = 0;
  let total = 0;
  for (const record of records) {
    met += record.metCount;
    total += record.totalCount;
  }
  if (total === 0) return calcErr('no_conditions_applicable');
  return calcOk(toCanonicalR(new CalcDecimal(met).dividedBy(total)));
}

/** Setup Adherence performance buckets (§10) — exact, never reduced for small screens (presentation may adapt display only). */
export const SETUP_ADHERENCE_BUCKETS = ['0-24', '25-49', '50-74', '75-99', '100'] as const;
export type SetupAdherenceBucketId = (typeof SETUP_ADHERENCE_BUCKETS)[number];

/** Assigns one Trade's own Setup Adherence ratio to its descriptive bucket — pure, deterministic, boundary-inclusive on the lower edge. */
export function setupAdherenceBucket(ratio: CalcDecimalValue): SetupAdherenceBucketId {
  const percent = ratio.times(100);
  if (percent.greaterThanOrEqualTo(100)) return '100';
  if (percent.greaterThanOrEqualTo(75)) return '75-99';
  if (percent.greaterThanOrEqualTo(50)) return '50-74';
  if (percent.greaterThanOrEqualTo(25)) return '25-49';
  return '0-24';
}
