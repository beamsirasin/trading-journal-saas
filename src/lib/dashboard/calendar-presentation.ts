import type { CalendarDay, CalendarMode, CalendarMonthModel } from './calendar';

/**
 * The SIGN a cell shows, decoupled from the vocabulary it uses.
 *
 * Actual/System days are winning/break-even/losing; Gap days are
 * outperformed/matched/underperformed. Those are genuinely different claims —
 * a day the account lost money on can still be a day the Trader outperformed
 * the System — so the words never merge. What the two DO share is a direction,
 * and that is all a colour is allowed to encode.
 *
 * Keeping the tone separate from the wording is what lets one Calendar render
 * all three modes without a mode ever borrowing another's vocabulary.
 */
export type CalendarDayTone = 'positive' | 'neutral' | 'negative';

export function calendarDayTone(day: CalendarDay): CalendarDayTone {
  if (day.mode === 'gap') {
    if (day.classification === 'outperformed') return 'positive';
    if (day.classification === 'underperformed') return 'negative';
    return 'neutral';
  }
  if (day.classification === 'winning') return 'positive';
  if (day.classification === 'losing') return 'negative';
  return 'neutral';
}

/** The one R figure a cell leads with: the day's total, or its Gap. */
export function calendarDayPrimaryR(day: CalendarDay): string {
  return day.mode === 'gap' ? day.gapR : day.totalR;
}

/** How many Trades the cell counted — paired Trades in `gap`. */
export function calendarDayTradeCount(day: CalendarDay): number {
  return day.mode === 'gap' ? day.pairedTradeCount : day.eligibleTradeCount;
}

/**
 * The i18n key for a day's own classification, namespaced by mode so no
 * caller can accidentally label a Gap day "winning".
 */
export function calendarDayClassificationKey(day: CalendarDay): string {
  return `${day.mode === 'gap' ? 'gap' : 'performance'}.${day.classification}`;
}

/**
 * Whether a month model has days a reader can actually open.
 *
 * `empty` and `error` are deliberately distinct upstream and stay distinct
 * here: this only answers "is there a grid worth interacting with", and never
 * collapses a failed R parse into "no Trades yet".
 */
export function calendarMonthDays(month: CalendarMonthModel): readonly CalendarDay[] {
  return month.status === 'available' ? month.days : [];
}

export const CALENDAR_MODE_ORDER: readonly CalendarMode[] = ['actual', 'system', 'gap'];
