import { calendarDateIn, isValidTimeZone, type CalendarDate } from '@/lib/time';

import { CalcDecimal, type CalcDecimalValue } from './decimal';
import { classifyOutcome } from './trade';
import { calcErr, calcOk, type CalcResult } from './types';

/**
 * A LOCAL TRADING DAY'S VERDICT, AND THE ONE PLACE THAT DECIDES IT.
 *
 * Two surfaces classify a day's total R: the Day Win % KPI (`dayWinRate`)
 * and the Calendar's day cells (`composeCalendarPerformanceMonth`). They had
 * a copy of the rule each, and both copies compared the total to zero with a
 * strict `> 0`.
 *
 * A TRADE'S R IS NOT CLASSIFIED THAT WAY, AND A DAY TOTAL IS THE SAME
 * QUANTITY. `classifyOutcome` puts a Trade inside `BREAK_EVEN_TOLERANCE_R`
 * (0.0500R) into `break_even`, never comparing to zero — CLAUDE.md §6 is
 * explicit that break-even is a tolerance band and that `== 0` is unsafe. A
 * day total is a SUM OF THOSE SAME R VALUES: same unit, same source, same
 * axis. Under the strict rule a day holding one +0.0300R Trade was a winning
 * day while the Trade that produced it was a break-even Trade — the same
 * figure contradicting itself between the Calendar cell and the Trade badge
 * on one screen.
 *
 * So the band applies here too, and this function is the only thing that
 * says so. It delegates to `classifyOutcome` rather than re-reading the
 * constant, which is what makes "the same rule" true by construction instead
 * of by convention.
 *
 * DELIBERATELY NOT THE RULE `composeExecutionComparison` USES. That composer
 * classifies a paired GAP — `actualR - systemR`, a difference between two
 * axes — as matched only on an exact zero, and its own comment explains why:
 * the tolerance was defined to judge a Trade's own outcome, and borrowing it
 * there would silently reclassify a real -0.04R execution difference as
 * "matched the System". Both files are right, because they classify
 * different quantities. Neither should be changed to match the other; see
 * the note in `execution-comparison.ts` beside
 * `ExecutionComparisonDistribution`.
 *
 * THE BAND DOES NOT SCALE WITH THE NUMBER OF TRADES IN THE DAY. It is the
 * same 0.0500R whether the day holds one Trade or nine. A band that widened
 * with volume would be a rule no one could state to a trader, and
 * `BREAK_EVEN_TOLERANCE_R` is a Calculation Engine Version 1 global constant
 * (CLAUDE.md A1), not a per-context parameter.
 */
export type TradingDayClassification = 'winning' | 'break_even' | 'losing';

export function classifyDayTotalR(total: CalcDecimalValue): TradingDayClassification {
  // `classifyOutcome` owns the band and the constant. Its `win`/`loss` map
  // onto a day's `winning`/`losing` one to one, so this is a rename rather
  // than a second classification.
  const outcome = classifyOutcome(total.toFixed());
  /* istanbul ignore next -- the input is an already-parsed decimal, so the only failure modes of `classifyOutcome` (null and unparseable) cannot occur here. */
  if (!outcome.ok) return 'break_even';
  return outcome.value === 'win' ? 'winning' : outcome.value === 'loss' ? 'losing' : 'break_even';
}

/**
 * Buckets records into local trading days in the user's configured timezone.
 *
 * The other half of what the two surfaces were each doing on their own. A
 * Trade closed 23:30 in Bangkok belongs to that Bangkok day (CLAUDE.md §7),
 * and which day that is must not depend on which surface is asking.
 *
 * Insertion order is preserved inside each day; callers that need
 * chronological days sort the keys, which are `YYYY-MM-DD` and therefore
 * sort lexicographically.
 */
export function groupByLocalDay<T>(
  records: readonly T[],
  timeZone: string,
  instantOf: (record: T) => Date,
): CalcResult<Map<CalendarDate, T[]>> {
  if (!isValidTimeZone(timeZone)) return calcErr('invalid_timezone');

  const byDate = new Map<CalendarDate, T[]>();
  for (const record of records) {
    const instant = instantOf(record);
    if (Number.isNaN(instant.getTime())) return calcErr('invalid_timestamp');
    const date = calendarDateIn(instant, timeZone);
    if (!date.ok) {
      return calcErr(
        date.error.code === 'invalid_timezone' ? 'invalid_timezone' : 'invalid_timestamp',
      );
    }
    const bucket = byDate.get(date.value);
    if (bucket === undefined) byDate.set(date.value, [record]);
    else bucket.push(record);
  }

  return calcOk(byDate);
}

/** Sums a day's R values at full precision; rounding happens once, later. */
export function sumDayR(values: readonly CalcDecimalValue[]): CalcDecimalValue {
  let total = new CalcDecimal(0);
  for (const value of values) total = total.plus(value);
  return total;
}
