import { CalcDecimal, parseCalcDecimal, toCanonicalR, type CalcDecimalValue } from './decimal';
import { classifyDayTotalR, groupByLocalDay, sumDayR } from './trading-day';
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
 * analytics timezone, sums each local day's R at full precision, then
 * classifies each day with `classifyDayTotalR` — the SAME break-even band a
 * Trade's own R is judged by, and the same function the Calendar's day cells
 * use. It counted positive/zero/negative days with a strict `> 0` until that
 * rule was unified; see `trading-day.ts` for why the band belongs here and
 * why the Execution Gap distribution deliberately keeps an exact zero. Open-only days never enter because callers
 * supply the already eligible closed Actual population.
 */
export function dayWinRate(
  trades: readonly DayWinTrade[],
  timeZone: string,
): CalcResult<DayWinRateSummary> {
  if (trades.length === 0) return calcErr('no_trading_days');

  const grouped = groupByLocalDay(trades, timeZone, (trade) => trade.exitedAt);
  if (!grouped.ok) return grouped;

  let winningDayCount = 0;
  let breakEvenDayCount = 0;
  let losingDayCount = 0;
  for (const dayTrades of grouped.value.values()) {
    const values: CalcDecimalValue[] = [];
    for (const trade of dayTrades) {
      const r = parseCalcDecimal(trade.actualR);
      if (r === null) return calcErr('invalid_decimal');
      values.push(r);
    }
    // The band, not a comparison to zero — `classifyDayTotalR` owns the rule
    // and the Calendar's day cells read the same function.
    const classification = classifyDayTotalR(sumDayR(values));
    if (classification === 'winning') winningDayCount += 1;
    else if (classification === 'losing') losingDayCount += 1;
    else breakEvenDayCount += 1;
  }

  const eligibleDayCount = grouped.value.size;
  return calcOk({
    eligibleDayCount,
    winningDayCount,
    breakEvenDayCount,
    losingDayCount,
    rate: toCanonicalR(new CalcDecimal(winningDayCount).dividedBy(eligibleDayCount)),
  });
}
