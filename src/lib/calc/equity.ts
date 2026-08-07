import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * One R-bearing record eligible for a cumulative-R sequence — the caller's
 * job is to supply the correct occurrence timestamp for the axis this curve
 * represents: `exited_at` for a Trader curve, `system_exited_at` for a
 * System curve. Never `created_at`/`updated_at`/`system_resolved_at` — none
 * of those describe *when the position's outcome actually happened*, only
 * bookkeeping metadata about the row itself.
 */
export interface EquityInputRecord {
  readonly id: string;
  readonly occurredAt: Date;
  readonly r: string;
}

export interface EquityPoint {
  readonly tradeId: string;
  readonly occurredAt: Date;
  /** Canonical 4dp cumulative R at this point in the sorted sequence. */
  readonly cumulativeR: string;
}

interface RawEquityPoint {
  readonly id: string;
  readonly occurredAt: Date;
  /** Raw, UNROUNDED running total — never itself a persisted/returned value; see `buildRawSequence`'s own comment. */
  readonly cumulativeR: CalcDecimalValue;
}

/**
 * Sorts a copy of `records` deterministically — occurrence timestamp
 * ascending, then `id` ascending as a stable tie-breaker — and returns the
 * running RAW (unrounded) cumulative R at each point. Never trusts caller
 * array order (`docs/calculation-spec.md`'s determinism requirement); never
 * mutates the input array.
 *
 * Shared, unrounded, internal building block for both {@link equityCurveR}
 * (which rounds each point for external consumption) and
 * {@link maximumDrawdownR} (which must run its own peak-tracking arithmetic
 * against the raw, full-precision sequence — rounding each point first
 * would let per-point rounding error compound into the drawdown result,
 * exactly the "do not round intermediate sums" rule this file must not
 * violate).
 */
function buildRawSequence(
  records: readonly EquityInputRecord[],
): CalcResult<readonly RawEquityPoint[]> {
  if (records.length === 0) return calcErr('no_trades');

  const sorted = [...records].sort((a, b) => {
    const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (byTime !== 0) return byTime;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const points: RawEquityPoint[] = [];
  let running = new CalcDecimal(0);
  for (const record of sorted) {
    const parsed = parseCalcDecimal(record.r);
    if (parsed === null) return calcErr('invalid_decimal');
    running = running.plus(parsed);
    points.push({ id: record.id, occurredAt: record.occurredAt, cumulativeR: running });
  }
  return calcOk(points);
}

/**
 * The cumulative-R sequence, one point per input record — never date-
 * bucketed (that is Phase 09's job over real query results, not this pure
 * engine's). `[+2R, -1R, +3R]` (already in occurrence order) produces
 * `[+2, +1, +4]`, matching the Phase 07D brief's own worked example.
 */
export function equityCurveR(
  records: readonly EquityInputRecord[],
): CalcResult<readonly EquityPoint[]> {
  const raw = buildRawSequence(records);
  if (!raw.ok) return raw;
  return calcOk(
    raw.value.map((point) => ({
      tradeId: point.id,
      occurredAt: point.occurredAt,
      cumulativeR: toCanonicalR(point.cumulativeR),
    })),
  );
}

/**
 * Peak-to-trough drawdown on cumulative R, returned as a non-negative R
 * magnitude. The running peak is SEEDED at `0` before the first point is
 * processed — the conceptual "initial equity point is 0R" the Phase 07D
 * brief requires — so a sequence that opens with a loss still measures a
 * real drawdown against that starting flat line, not against its own first
 * (already-negative) point. Verified against all four of the brief's own
 * worked examples, including the deep peak-to-trough case
 * (`[+2R, -4R, +1R]` -> cumulative `+2, -2, -1` -> drawdown `4R`, not `3R`).
 *
 * This is a single scalar maximum, not a point-by-point drawdown series —
 * Phase 07D's own brief asks only for "Maximum drawdown in R," not a full
 * series; a series (if ever needed) is a trivial extension of the same
 * internal loop, deferred until an actual caller needs it.
 *
 * Account-equity currency drawdown is a separate, later metric — this
 * function operates on R only.
 */
export function maximumDrawdownR(records: readonly EquityInputRecord[]): CalcResult<string> {
  const raw = buildRawSequence(records);
  if (!raw.ok) return raw;

  let peak = new CalcDecimal(0);
  let maxDrawdown = new CalcDecimal(0);
  for (const point of raw.value) {
    if (point.cumulativeR.greaterThan(peak)) peak = point.cumulativeR;
    const drawdown = peak.minus(point.cumulativeR);
    if (drawdown.greaterThan(maxDrawdown)) maxDrawdown = drawdown;
  }
  return calcOk(toCanonicalR(maxDrawdown));
}
