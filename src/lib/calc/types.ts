/**
 * The one result shape every pure calculation in `src/lib/calc/` returns.
 * `NaN`, `Infinity`, and a thrown divide-by-zero are all forbidden outputs
 * (`docs/calculation-spec.md` §6) — a calculation that cannot produce a
 * meaningful number returns `{ ok: false, reason }` instead, and no raw
 * `Error` instance is ever exposed through this type. A thrown exception
 * from this module signals a genuine programming bug (e.g. a malformed
 * compile-time constant), never a routine "bad input" — routine bad input
 * is always a `CalcResult` failure.
 */
export type CalcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: CalcFailureReason };

/**
 * The closed failure-reason set for Phase 07C's calculations. Each member is
 * justified by a specific function in `risk.ts`/`trade.ts` — see that
 * function's own doc comment for exactly which reason it returns and why.
 * Not the full reason set every future `src/lib/calc/` module will ever
 * need (Phase 07D's aggregate/attribution/equity calculations may justify
 * more); this set covers only what Phase 07C actually implements.
 */
export const CALC_FAILURE_REASONS = [
  'missing_input',
  'invalid_decimal',
  'invalid_direction',
  'zero_risk',
  'invalid_risk_direction',
  'invalid_target_direction',
  'invalid_initial_risk',
  'invalid_system_cost',
  'unresolved_system_outcome',
  'system_no_trade',
] as const;

export type CalcFailureReason = (typeof CALC_FAILURE_REASONS)[number];

export function isCalcFailureReason(value: unknown): value is CalcFailureReason {
  return typeof value === 'string' && (CALC_FAILURE_REASONS as readonly string[]).includes(value);
}

export function calcOk<T>(value: T): CalcResult<T> {
  return { ok: true, value };
}

/** `CalcResult<never>` structurally satisfies any `CalcResult<T>` — a failure carries no value to type-narrow. */
export function calcErr(reason: CalcFailureReason): CalcResult<never> {
  return { ok: false, reason };
}
