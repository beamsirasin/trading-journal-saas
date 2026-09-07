/**
 * PROTOTYPE PRESENTATION RULES.
 *
 * Derivations the redesigned journal needs in order to be judged: which single
 * follow-up a row offers, what the Status column says, and how a signed figure
 * is toned. All of it is presentation — nothing here computes a financial
 * value. Money and R are formatted by the product's OWN helpers
 * (`formatTradeMoney`, `formatR`), so the prototype prints the same strings the
 * real table does rather than a second, prettier arithmetic.
 */

import { formatR, formatTradeMoney } from '@/components/trades/trade-format';

import type { PrototypeTrade } from './fixtures';

/**
 * The single action a row may offer, in priority order (spec §C).
 *
 * `none` is a quiet em dash and is NOT inferred to mean "reviewed" — the
 * absence of an outstanding item is not evidence that a review happened.
 */
export type FollowUp =
  'complete_details' | 'add_system_result' | 'add_review_note' | 'add_strategy' | 'none';

/** Which detail tab the follow-up opens. */
export const FOLLOW_UP_TAB: Record<
  Exclude<FollowUp, 'none'>,
  'overview' | 'execution' | 'review'
> = {
  complete_details: 'execution',
  add_system_result: 'review',
  add_review_note: 'review',
  add_strategy: 'overview',
};

export const FOLLOW_UP_LABEL: Record<FollowUp, string> = {
  complete_details: 'Complete details',
  add_system_result: 'Add system result',
  add_review_note: 'Add review note',
  add_strategy: 'Add strategy',
  none: '—',
};

/**
 * THREE TONES, AND THE THIRD ONE WAS EARNED BY LOOKING AT THE PAGE.
 *
 * `attention` (amber) is for a record that is broken AS A RECORD — a legacy row
 * whose own facts are missing. Nothing else qualifies.
 *
 * `action` (the primary accent) is for adding the system result. It began as a
 * second amber, and on a real page of 25 rows that put three or four warning-
 * coloured links in one column, which read as "four things are wrong here"
 * rather than "here is the product's central action". Resolving the system
 * outcome is what makes attribution possible at all; it deserves to look like
 * the offer it is, not like a defect.
 *
 * `neutral` is depth the trader simply has not added — a strategy, a review
 * note. Missing optional information must never be styled as an error
 * (spec §B5).
 */
export type FollowUpTone = 'attention' | 'action' | 'neutral' | 'quiet';

export const FOLLOW_UP_TONE: Record<FollowUp, FollowUpTone> = {
  complete_details: 'attention',
  add_system_result: 'action',
  add_review_note: 'neutral',
  add_strategy: 'neutral',
  none: 'quiet',
};

export function deriveFollowUp(trade: PrototypeTrade): FollowUp {
  if (trade.legacy || trade.lifecycle === 'needs_details') return 'complete_details';

  const isClosed = trade.lifecycle === 'closed';

  // Suppressed while the position is open: an unresolved system result is not
  // yet actionable, because the trade the system is being compared against has
  // not finished happening.
  if (isClosed && trade.systemState === 'pending') return 'add_system_result';
  if (isClosed && !trade.hasReviewNote) return 'add_review_note';
  if (trade.strategy === null && trade.lifecycle !== 'canceled') return 'add_strategy';

  return 'none';
}

export const STATUS_LABEL: Record<PrototypeTrade['lifecycle'], string> = {
  open: 'Open',
  partially_closed: 'Partially closed',
  closed: 'Closed',
  needs_details: 'Needs details',
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
