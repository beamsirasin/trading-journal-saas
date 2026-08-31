import { isTradeAttentionKind, type TradeAttentionKind } from './constants';

export const DEFAULT_TRADES_VIEW = 'log' as const;

export type TradesView = 'calendar' | 'log';

/**
 * WHICH NEEDS ATTENTION BUCKET THE LIST IS SHOWING.
 *
 * This was a single-member union (`'system-pending' | null`), which is why
 * four of the five counts on the Dashboard's Needs Attention panel had
 * nowhere to link: the panel published five numbers and the Trades page could
 * only express one of them.
 *
 * The members ARE `TradeAttentionKind` rather than a parallel list, so a
 * bucket cannot exist in the counting layer without a URL that reaches it, or
 * the reverse. `reviews-pending` is deliberately not linked FROM the panel
 * (see the note there) but is accepted here — a bucket that can be counted
 * should be reachable by anyone who types the URL.
 */
export type TradesAttention = TradeAttentionKind | null;

/** URL input is untrusted; unknown and repeated values return to the operational Log. */
export function parseTradesView(value: string | string[] | undefined): TradesView {
  return value === 'calendar' || value === 'log' ? value : DEFAULT_TRADES_VIEW;
}

export function parseTradesAttention(value: string | string[] | undefined): TradesAttention {
  // A repeated `?attention=` yields an array, which is not a bucket. Rejecting
  // it rather than taking the first member keeps a hand-edited URL from
  // silently choosing one of two conflicting intents.
  if (typeof value !== 'string') return null;
  return isTradeAttentionKind(value) ? value : null;
}
