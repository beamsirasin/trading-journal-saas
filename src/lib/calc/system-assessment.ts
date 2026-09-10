/**
 * SYSTEM ASSESSMENT — the confirmed counterfactual, and what may be trusted.
 *
 * THIS FILE OWNS THREE THINGS AND NO ARITHMETIC. Dependency snapshots, staleness
 * and analytics eligibility. Every R figure it touches was computed by
 * `trade.ts` — `resolveSystemGrossR`, `systemRFromCanonicalGross`,
 * `classifyOutcome` against `BREAK_EVEN_TOLERANCE_R` — and persisted. There is
 * deliberately no second calculation engine here; a second one is how two
 * surfaces start disagreeing about the same trade.
 *
 * THE PRINCIPLE IT PORTS FROM THE ACCEPTED PROTOTYPE. A confirmed System result
 * is FROZEN. It was a judgement about which rule would have fired, made against
 * a particular set of plan facts; changing those facts does not re-make the
 * judgement, it merely re-runs the arithmetic. So the confirmed figures stay
 * exactly as confirmed, the facts they rested on are stored beside them, and a
 * later divergence is reported as `needs_review` rather than silently producing
 * a number nobody assessed.
 *
 * FOUR STATUSES, AND THE TWO THAT MUST NOT MERGE. `pending` means nobody has
 * completed the assessment; `cannot_determine` means somebody did and there is
 * not enough reliable information to establish a result. They carry opposite
 * information and neither is the other. `cannot_determine` is NOT pending.
 */

import type { SystemResolutionKind, SystemStatus } from '@/lib/trades/constants';

import { resolveSystemGrossR, type ResolveSystemGrossRInput } from './trade';
import type { CalcResult } from './types';

/**
 * WHAT A CONFIRMED ASSESSMENT RESTED ON — basis-scoped, never the whole Trade.
 *
 * Only the facts the chosen resolution actually READ are recorded. A
 * `money_custom` assessment is the trader's own R figure and does not depend on
 * the planned target, so correcting that target must not flag it; a
 * `money_target` assessment divides by planned risk and reward and must be
 * flagged when either moves.
 *
 * DELIBERATELY ABSENT: reflection, notes, emotions, mistakes, actual P&L, actual
 * exits, `updated_at`. None of them can change what following the rules would
 * have produced, and a staleness signal that fires on an edited note is a signal
 * traders learn to dismiss.
 *
 * STRUCTURED, NOT HASHED. A hash can say THAT something changed; only the fields
 * can say WHAT, and the reader has to be told which fact moved before they can
 * decide whether the conclusion still holds.
 */
export interface SystemDependencySnapshot {
  /** Snapshot format, so a later field addition is detectable rather than silent. */
  readonly v: 1;
  readonly resolutionKind: SystemResolutionKind | null;
  readonly exitReason: string | null;
  /** Immutable pinned versions — the rules that applied. */
  readonly strategyVersionId: string | null;
  readonly setupVersionId: string | null;
  /** Planned figures, present ONLY where the basis divides by them. */
  readonly plannedRiskMinor: string | null;
  readonly plannedRewardMinor: string | null;
  readonly plannedEntry: string | null;
  readonly plannedStop: string | null;
}

/** The Trade facts a snapshot may draw on. Strings so `numeric`/`bigint` compare exactly. */
export interface SystemDependencyInput {
  readonly systemResolutionKind: SystemResolutionKind | null;
  readonly systemExitReason: string | null;
  readonly strategyVersionId: string | null;
  readonly setupVersionId: string | null;
  readonly plannedRiskMinor: bigint | string | null;
  readonly plannedRewardMinor: bigint | string | null;
  readonly plannedEntry: string | null;
  readonly plannedStop: string | null;
}

const text = (value: bigint | string | null): string | null =>
  value === null ? null : String(value);

/** Which planned figures the given resolution genuinely reads. */
function basisReads(kind: SystemResolutionKind | null): {
  risk: boolean;
  reward: boolean;
  prices: boolean;
} {
  switch (kind) {
    // Gross R is `plannedReward / plannedRisk` — both are inputs.
    case 'money_target':
      return { risk: true, reward: true, prices: false };
    // Gross R is exactly -1 by the definition of R against the INITIAL risk, so
    // the risk DEFINITION is a dependency even though no division occurs: if the
    // recorded risk changes, -1R refers to a different amount of money.
    case 'money_stop':
      return { risk: true, reward: false, prices: false };
    // Gross R is 0. It still rests on there being a plan at all.
    case 'money_break_even':
      return { risk: true, reward: false, prices: false };
    // The trader typed the R directly. It depends on neither figure — flagging
    // it when an unrelated target is corrected would be crying wolf.
    case 'money_custom':
      return { risk: false, reward: false, prices: false };
    // Direction-aware geometry over the planned entry and stop.
    case 'price_exit':
      return { risk: false, reward: false, prices: true };
    // `no_trade` and unresolved: the rules are the whole evidence.
    default:
      return { risk: false, reward: false, prices: false };
  }
}

export function buildSystemDependencySnapshot(
  input: SystemDependencyInput,
): SystemDependencySnapshot {
  const reads = basisReads(input.systemResolutionKind);
  return {
    v: 1,
    resolutionKind: input.systemResolutionKind,
    exitReason: input.systemExitReason,
    strategyVersionId: input.strategyVersionId,
    setupVersionId: input.setupVersionId,
    plannedRiskMinor: reads.risk ? text(input.plannedRiskMinor) : null,
    plannedRewardMinor: reads.reward ? text(input.plannedRewardMinor) : null,
    plannedEntry: reads.prices ? input.plannedEntry : null,
    plannedStop: reads.prices ? input.plannedStop : null,
  };
}

/** The single fact that moved, or `null` when the snapshot still holds. */
export function changedDependency(
  confirmed: SystemDependencySnapshot,
  current: SystemDependencySnapshot,
): keyof SystemDependencySnapshot | null {
  const fields: readonly (keyof SystemDependencySnapshot)[] = [
    'resolutionKind',
    'exitReason',
    'strategyVersionId',
    'setupVersionId',
    'plannedRiskMinor',
    'plannedRewardMinor',
    'plannedEntry',
    'plannedStop',
  ];
  for (const field of fields) {
    if (confirmed[field] !== current[field]) return field;
  }
  return null;
}

/**
 * Parses a persisted `jsonb` snapshot, or `null` when there is none or it is not
 * a shape this version understands.
 *
 * AN UNREADABLE SNAPSHOT IS NOT A CURRENT ONE. A future `v: 2` written by newer
 * code and read by older code returns `null` here, which routes the assessment
 * to `not_available` rather than to a comparison made against fields this
 * version cannot see.
 */
export function parseSystemDependencySnapshot(value: unknown): SystemDependencySnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<SystemDependencySnapshot>;
  if (candidate.v !== 1) return null;
  return {
    v: 1,
    resolutionKind: candidate.resolutionKind ?? null,
    exitReason: candidate.exitReason ?? null,
    strategyVersionId: candidate.strategyVersionId ?? null,
    setupVersionId: candidate.setupVersionId ?? null,
    plannedRiskMinor: candidate.plannedRiskMinor ?? null,
    plannedRewardMinor: candidate.plannedRewardMinor ?? null,
    plannedEntry: candidate.plannedEntry ?? null,
    plannedStop: candidate.plannedStop ?? null,
  };
}

/**
 * WHETHER AN ASSESSMENT MAY ENTER TRUSTED SYSTEM-VS-ACTUAL ANALYTICS.
 *
 * DERIVED, NEVER PERSISTED. A stored eligibility would itself go stale the
 * moment a dependency moved, and then there would be two things to keep in
 * agreement instead of one.
 *
 * `eligible`      — confirmed, dependencies current, net R and outcome known.
 *                   The ONLY state admitted to a paired comparison.
 * `gross_only`    — confirmed and current, gross R known, cost unknown. Real and
 *                   reportable as a gross figure; never subtracted from a net
 *                   Actual R.
 * `needs_review`  — a confirmed assessment whose dependencies have since
 *                   changed. Checked BEFORE the result shape, so a stale
 *                   `no_trade` is excluded too: a stale finding is no more
 *                   trustworthy than a stale magnitude.
 * `no_trade`      — a confirmed finding, current. Belongs in a no-trade rate and
 *                   in every monetary metric; belongs in no paired comparison,
 *                   because there is no counterfactual result to differ from.
 * `not_available` — pending, cannot_determine, or a confirmed row with no
 *                   dependency snapshot at all. The last case is the legacy
 *                   pre-migration row: still readable, still exportable, never
 *                   new-model comparison evidence.
 */
export type SystemAnalyticsEligibility =
  'eligible' | 'gross_only' | 'needs_review' | 'no_trade' | 'not_available';

export interface SystemEligibilityInput {
  readonly systemStatus: SystemStatus | string;
  readonly systemResolvedAt: Date | string | null;
  readonly systemDependencySnapshot: unknown;
  readonly systemGrossR: string | null;
  readonly systemR: string | null;
  readonly systemOutcome: string | null;
  /** The Trade's dependency facts as they stand NOW. */
  readonly current: SystemDependencyInput;
}

/**
 * Whether the confirmed resolution kind is still supported by the current Plan
 * representation. Value-level dependencies remain basis-scoped in the snapshot:
 * for example, changing Money Risk does not alter a typed custom R. Losing the
 * Money representation altogether is different — that old resolution can no
 * longer be explicitly reconfirmed against the current Price-only Plan.
 */
function resolutionPlanIsCurrent(current: SystemDependencyInput): boolean {
  if (current.systemResolutionKind === 'price_exit') {
    return current.plannedEntry !== null && current.plannedStop !== null;
  }
  if (current.systemResolutionKind?.startsWith('money_')) {
    return (
      current.plannedEntry === null &&
      current.plannedStop === null &&
      current.plannedRiskMinor !== null
    );
  }
  return true;
}

/**
 * The current-input counterpart to the frozen confirmed gross result.
 *
 * This is deliberately a read-only preview. It delegates every calculation to
 * the canonical engine in `trade.ts`, returns `null` for findings with no
 * magnitude, and has no persistence side effect. A caller may show the result
 * as "current inputs would calculate ...", but only the explicit System
 * resolution/correction services may promote it into confirmed columns.
 */
export interface CurrentSystemGrossRPreviewInput extends Omit<
  ResolveSystemGrossRInput,
  'resolutionKind'
> {
  readonly systemStatus: SystemStatus | string;
  readonly systemResolutionKind: SystemResolutionKind | null;
}

export function currentSystemGrossRPreview(
  input: CurrentSystemGrossRPreviewInput,
): CalcResult<string> | null {
  const { systemStatus, systemResolutionKind, ...current } = input;
  if (systemStatus !== 'resolved' || systemResolutionKind === null) return null;
  return resolveSystemGrossR({ ...current, resolutionKind: systemResolutionKind });
}

export function systemAnalyticsEligibility(
  input: SystemEligibilityInput,
): SystemAnalyticsEligibility {
  if (input.systemStatus === 'pending') return 'not_available';
  if (
    input.systemStatus !== 'resolved' &&
    input.systemStatus !== 'no_trade' &&
    input.systemStatus !== 'cannot_determine'
  ) {
    return 'not_available';
  }
  // Never confirmed, or confirmed before dependency snapshots existed.
  if (input.systemResolvedAt === null) return 'not_available';
  const confirmed = parseSystemDependencySnapshot(input.systemDependencySnapshot);
  if (confirmed === null) return 'not_available';

  if (!resolutionPlanIsCurrent(input.current)) return 'needs_review';
  const current = buildSystemDependencySnapshot(input.current);
  if (changedDependency(confirmed, current) !== null) return 'needs_review';

  if (input.systemStatus === 'no_trade') return 'no_trade';
  if (input.systemStatus === 'cannot_determine') return 'not_available';
  if (input.systemR !== null && input.systemOutcome !== null) return 'eligible';
  return input.systemGrossR === null ? 'not_available' : 'gross_only';
}

/**
 * TRUSTED PAIRED COMPARISON — the new-model gate.
 *
 * Deliberately SEPARATE from `isComparisonEligible` in `attribution.ts`, which
 * remains the legacy/read-compatibility predicate that every existing analytics
 * population is built on. Changing that one in place would silently redefine
 * every historical figure the product has ever shown; this one is additive and
 * is what new System-vs-Actual work must ask.
 */
export function isTrustedSystemComparison(input: SystemEligibilityInput): boolean {
  return systemAnalyticsEligibility(input) === 'eligible';
}
