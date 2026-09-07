/**
 * PROTOTYPE PRESENTATION RULES.
 *
 * Derivations the redesigned journal needs in order to be judged: what the
 * Status column says, which enrichment the Filters panel can search for, and how
 * a signed figure is toned. All of it is presentation — nothing here computes a financial
 * value. Money and R are formatted by the product's OWN helpers
 * (`formatTradeMoney`, `formatR`), so the prototype prints the same strings the
 * real table does rather than a second, prettier arithmetic.
 */

import { formatR, formatTradeMoney } from '@/components/trades/trade-format';

import type { PrototypeTrade } from './fixtures';

/**
 * WHICH ENRICHMENT A TRADE IS MISSING — for the FILTERS, and nowhere else.
 *
 * This used to drive a Follow-up column in every journal composition, so an
 * ordinary valid trade with no review note carried a coloured "Add review note"
 * link in its row, and a journal of 25 such trades read as a list of 25 chores.
 * A record that is missing only OPTIONAL enrichment is not incomplete; it is
 * finished, and saying otherwise in every row teaches a trader that their
 * journal is permanently behind.
 *
 * The rows no longer show any of this. The Filters panel still offers it,
 * because a trader who opens Filters and asks for trades with no rule
 * comparison is deliberately looking for work — the difference between an
 * offer and a nag is who started the conversation.
 *
 * `complete_details` is the one genuinely FACTUAL gap in the set: a settled
 * trade whose money was never recorded. It is named for what is missing rather
 * than judged as a defective record.
 */
export type FollowUp =
  'complete_details' | 'add_system_result' | 'add_review_note' | 'add_strategy' | 'none';

export const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  complete_details: 'Add P&L',
  add_system_result: 'Add rule comparison',
  add_review_note: 'Add review note',
  add_strategy: 'Add strategy',
  none: '—',
};

export const STATUS_LABEL: Record<PrototypeTrade['lifecycle'], string> = {
  open: 'Open',
  partially_closed: 'Partially closed',
  closed: 'Closed',
  canceled: 'Canceled',
};

export const OUTCOME_LABEL: Record<NonNullable<PrototypeTrade['outcome']>, string> = {
  win: 'Win',
  loss: 'Loss',
  break_even: 'Break-even',
  unresolved: 'No result',
};

/** Sign-driven, never value-driven: a figure's tone comes from the string the engine produced. */
export type FigureTone = 'positive' | 'negative' | 'flat' | 'unavailable';

export function toneForDecimal(value: string | null): FigureTone {
  if (value === null) return 'unavailable';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'unavailable';
  if (numeric === 0) return 'flat';
  return numeric > 0 ? 'positive' : 'negative';
}

/**
 * A signed money string with its currency code.
 *
 * The leading `+` is added here rather than by `formatMoney`, matching the
 * existing mobile list: a gain reads `+420.00 USD`, a loss keeps the minus the
 * formatter already produced, and zero carries no sign at all.
 */
export function signedMoney(minor: string | null, currency: string): string | null {
  const formatted = formatTradeMoney(minor, currency);
  if (formatted === null || minor === null) return null;
  const numeric = Number(minor);
  return Number.isFinite(numeric) && numeric > 0 ? `+${formatted}` : formatted;
}

export function signedR(value: string | null): string | null {
  return formatR(value);
}

/**
 * WHICH KIND OF ABSENCE a missing monetary result is.
 *
 * `not_recorded` — the trade has a settled or partially settled result and its
 * money was never captured. This is a gap in the record, and it is what the
 * summary's "P&L incomplete" counts.
 *
 * `not_available` — an open or canceled position has no monetary result YET.
 * Printing "Not recorded" there accuses the trader of forgetting something that
 * has not happened.
 *
 * Lives here rather than inside one renderer because all three journal
 * compositions have to agree about it, and the mobile list got it wrong for
 * exactly as long as it made the decision for itself.
 */
export function moneyAbsenceKind(trade: {
  readonly lifecycle: string;
}): 'not_recorded' | 'not_available' {
  return trade.lifecycle === 'closed' || trade.lifecycle === 'partially_closed'
    ? 'not_recorded'
    : 'not_available';
}

/** `40%` — the closed fraction of the original position, from basis points. */
export function closedPercentLabel(closedBps: number): string {
  const percent = closedBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}

export const CONFIDENCE_STEPS = [0, 25, 50, 75, 100] as const;

export const CONFIDENCE_LABEL: Record<number, string> = {
  0: 'Very low',
  25: 'Low',
  50: 'Neutral',
  75: 'High',
  100: 'Very high',
};

/**
 * The collapsed summary an optional section shows once it holds something.
 *
 * `null` means the section is genuinely untouched and its header stays a plain
 * invitation — "Strategy", not "Strategy · Not assigned", which would read as a
 * defect rather than an option not taken.
 */
export function contextSummary(trade: PrototypeTrade): string | null {
  const parts: string[] = [];
  if (trade.confidence !== null) {
    parts.push(`${CONFIDENCE_LABEL[trade.confidence] ?? 'Not recorded'} confidence`);
  }
  if (trade.emotions !== null) {
    parts.push(trade.emotions.length === 0 ? 'None of these' : trade.emotions.join(', '));
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

export function strategySummary(trade: PrototypeTrade): string | null {
  if (trade.strategy === null) return null;
  return trade.setup === null ? trade.strategy : `${trade.strategy} / ${trade.setup}`;
}
