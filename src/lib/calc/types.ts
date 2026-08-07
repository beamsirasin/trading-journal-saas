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
 * The closed failure-reason set for `src/lib/calc/`'s calculations. Each
 * member is justified by a specific function — see that function's own doc
 * comment for exactly which reason it returns and why.
 *
 * The first ten (through `system_no_trade`) are Phase 07C's per-trade
 * reasons (`risk.ts`/`trade.ts`). The remaining seven are Phase 07D's
 * aggregate/attribution/equity reasons (`aggregate.ts`/`attribution.ts`/
 * `equity.ts`) — a genuinely new failure state each: an empty eligible
 * population is not a legitimate zero sample (`no_trades`), a ratio with an
 * empty numerator-defining subset has nothing to average
 * (`no_wins`/`no_losses`), every R exactly zero is neither a profit nor a
 * loss (`no_profit_or_loss`), a non-positive System edge makes execution
 * efficiency undefined rather than merely large (`system_has_no_edge`), an
 * empty paired population cannot be compared (`no_comparable_trades`), and
 * a Rule with only `not_applicable`/`not_checked` checks has no objectively
 * evaluated adherence to report (`no_rule_checks`).
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
  'no_trades',
  'no_wins',
  'no_losses',
  'no_profit_or_loss',
  'system_has_no_edge',
  'no_comparable_trades',
  'no_rule_checks',
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
