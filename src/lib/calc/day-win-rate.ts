import { calendarDateIn, isValidTimeZone, type CalendarDate } from '@/lib/time';

import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { calcErr, calcOk, type CalcResult } from './types';

export interface DayWinTrade {
  readonly actualR: string;
  readonly exitedAt: Date;
}

export interface DayWinRateSummary {
  readonly eligibleDayCount: number;
  readonly winningDayCount: number;
  readonly breakEvenDayCount: number;
  readonly losingDayCount: number;
  /** Winning local days / every eligible local day; break-even days remain in the denominator. */
  readonly rate: string;
}

/**
 * Groups Population-A Trades by Actual `exited_at` in the persisted user
 * analytics timezone, sums each local day's R at full precision, then counts
 * positive/zero/negative days. Open-only days never enter because callers
 * supply the already eligible closed Actual population.
 */
export function dayWinRate(
  trades: readonly DayWinTrade[],
  timeZone: string,
): CalcResult<DayWinRateSummary> {
  if (!isValidTimeZone(timeZone)) return calcErr('invalid_timezone');
  if (trades.length === 0) return calcErr('no_trading_days');

  const totals = new Map<CalendarDate, CalcDecimalValue>();
  for (const trade of trades) {
    const date = calendarDateIn(trade.exitedAt, timeZone);
    if (!date.ok)
      return calcErr(
        date.error.code === 'invalid_timezone' ? 'invalid_timezone' : 'invalid_timestamp',
      );
    const r = parseCalcDecimal(trade.actualR);
    if (r === null) return calcErr('invalid_decimal');
    totals.set(date.value, (totals.get(date.value) ?? new CalcDecimal(0)).plus(r));
  }

  let winningDayCount = 0;
  let breakEvenDayCount = 0;
  let losingDayCount = 0;
  for (const total of totals.values()) {
    if (total.greaterThan(0)) winningDayCount += 1;
    else if (total.lessThan(0)) losingDayCount += 1;
    else breakEvenDayCount += 1;
  }

  const eligibleDayCount = totals.size;
  return calcOk({
    eligibleDayCount,
    winningDayCount,
    breakEvenDayCount,
    losingDayCount,
    rate: toCanonicalR(new CalcDecimal(winningDayCount).dividedBy(eligibleDayCount)),
  });
}
