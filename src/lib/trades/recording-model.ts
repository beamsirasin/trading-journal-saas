/**
 * Phase 15G.5A recording-model primitives.
 *
 * These helpers deliberately contain no database or UI concerns. Persisted
 * Plan authority is inferred from mutually-exclusive columns for canonical
 * rows; historical rows may still be `dual` and remain readable.
 */

export const RECORDING_TIMINGS = ['at_entry', 'after_trade'] as const;
export type RecordingTiming = (typeof RECORDING_TIMINGS)[number];

export const SYSTEM_PLAN_BASES = ['price', 'money'] as const;
export type SystemPlanBasis = (typeof SYSTEM_PLAN_BASES)[number];

export type PersistedSystemPlanBasis = SystemPlanBasis | 'dual' | null;

export interface SystemPlanFields {
  readonly plannedEntry?: string | null | undefined;
  readonly plannedStop?: string | null | undefined;
  readonly plannedTarget?: string | null | undefined;
  readonly plannedPositionSize?: string | null | undefined;
  readonly plannedRiskMinor?: bigint | null | undefined;
  readonly plannedRewardMinor?: bigint | null | undefined;
}

export function inferPersistedSystemPlanBasis(fields: SystemPlanFields): PersistedSystemPlanBasis {
  const hasPrice =
    fields.plannedEntry != null ||
    fields.plannedStop != null ||
    fields.plannedTarget != null ||
    fields.plannedPositionSize != null;
  const hasMoney = fields.plannedRiskMinor != null || fields.plannedRewardMinor != null;

  if (hasPrice && hasMoney) return 'dual';
  if (hasPrice) return 'price';
  if (hasMoney) return 'money';
  return null;
}

export type NewWritePlanAuthorityError =
  'system_plan_basis_required' | 'system_plan_basis_without_plan' | 'conflicting_plan_basis';

export type NewWritePlanAuthorityResult =
  | { readonly ok: true; readonly systemPlanBasis: SystemPlanBasis | null }
  | { readonly ok: false; readonly code: NewWritePlanAuthorityError };

/**
 * Canonical new-write authority validation. It never discards fields: a
 * caller that submits data from the non-selected representation is rejected.
 * `allowInferredBasis` exists only for the pre-15G.5A service compatibility
 * facade; action/UI writes supply the basis explicitly.
 */
export function validateNewWritePlanAuthority(
  fields: SystemPlanFields,
  systemPlanBasis: SystemPlanBasis | null | undefined,
  options: { readonly allowInferredBasis?: boolean } = {},
): NewWritePlanAuthorityResult {
  const persistedBasis = inferPersistedSystemPlanBasis(fields);

  if (persistedBasis === null) {
    return systemPlanBasis == null
      ? { ok: true, systemPlanBasis: null }
      : { ok: false, code: 'system_plan_basis_without_plan' };
  }
  if (persistedBasis === 'dual') return { ok: false, code: 'conflicting_plan_basis' };
  if (systemPlanBasis == null) {
    return options.allowInferredBasis
      ? { ok: true, systemPlanBasis: persistedBasis }
      : { ok: false, code: 'system_plan_basis_required' };
  }
  if (systemPlanBasis !== persistedBasis) {
    return { ok: false, code: 'conflicting_plan_basis' };
  }
  return { ok: true, systemPlanBasis };
}

export type CompletedTradeTimestampError = 'entered_after_exited' | 'exited_in_future';

export type CompletedTradeTimestampResult =
  { readonly ok: true } | { readonly ok: false; readonly code: CompletedTradeTimestampError };

/** Future completed-create invariant. Zero-duration Trades are valid. */
export function validateCompletedTradeTimestamps(input: {
  readonly enteredAt: Date;
  readonly exitedAt: Date;
  readonly now: Date;
}): CompletedTradeTimestampResult {
  if (input.enteredAt.getTime() > input.exitedAt.getTime()) {
    return { ok: false, code: 'entered_after_exited' };
  }
  if (input.exitedAt.getTime() > input.now.getTime()) {
    return { ok: false, code: 'exited_in_future' };
  }
  return { ok: true };
}

/**
 * Conservative retrospective marker at the application's canonical
 * millisecond precision. PostgreSQL may store microseconds, but the `Date`
 * read model cannot represent them. Equality therefore means "not provably
 * retrospective" and returns false; only a strictly later millisecond does.
 */
export function isRecordedRetrospectively(input: {
  readonly createdAt: Date;
  readonly exitedAt: Date | null;
}): boolean {
  return input.exitedAt !== null && input.createdAt.getTime() > input.exitedAt.getTime();
}
