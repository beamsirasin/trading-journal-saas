import type { TradeAttentionKind } from './constants';
import type { TradeDetailsTab } from './details-tabs';

/**
 * THE REVIEW COLUMN'S STATE — one actionable journal state per Trade, derived
 * from fields the domain already stores.
 *
 * NOTHING HERE IS INVENTED. Each non-reviewed state is one of the five Needs
 * Attention buckets (`TRADE_ATTENTION_KINDS`), evaluated against exactly the
 * fact its SQL predicate tests in `server/dal/trades.ts`:
 *
 *   needs_details        status = 'planned'
 *   needs_system_result  system_status = 'pending'
 *   unclassified         strategy_id IS NULL
 *   needs_review         status = 'closed' AND review_notes IS NULL
 *
 * That correspondence is the point: the Dashboard's Needs Attention panel
 * counts a Trade, this column names the same Trade the same way, and clicking
 * either lands on the same bucket. `attentionKind` is published per state so
 * a caller can link to the list filter without a second mapping table, and so
 * a test can assert the two vocabularies stay in step.
 *
 * `reviewed` is the residual, and it is a genuine statement rather than a
 * default: every actionable state above has been ruled out.
 *
 * ONE STATE PER TRADE, IN A FIXED ORDER. A Trade can satisfy several
 * predicates at once (a planned Trade is also unclassified and unreviewed);
 * showing three flags in one cell tells a beginner to do three things when
 * only the first is possible yet. The order below is the order the work can
 * actually be done in: you cannot record a System result for a Trade you
 * never entered, and you cannot review one whose result is not settled.
 *
 * NO SCORE IS PRODUCED. This is a qualitative state, never a numeric
 * completeness or discipline rating (CLAUDE.md §6/A2).
 */
export const TRADE_REVIEW_STATES = [
  'needs_details',
  'needs_system_result',
  'unclassified',
  'needs_review',
  'reviewed',
] as const;

export type TradeReviewState = (typeof TRADE_REVIEW_STATES)[number];

/** The minimal projection this derivation reads — never the whole Trade. */
export interface TradeReviewStateInput {
  readonly status: 'planned' | 'open' | 'closed' | 'canceled';
  readonly systemStatus: 'pending' | 'resolved' | 'no_trade';
  readonly strategyName: string | null;
  readonly hasReviewNotes: boolean;
}

export function deriveTradeReviewState(trade: TradeReviewStateInput): TradeReviewState {
  if (trade.status === 'planned') return 'needs_details';
  if (trade.systemStatus === 'pending') return 'needs_system_result';
  if (trade.strategyName === null) return 'unclassified';
  if (trade.status === 'closed' && !trade.hasReviewNotes) return 'needs_review';
  return 'reviewed';
}

/**
 * Which Trade Details tab a state's work is actually done in — so clicking an
 * actionable Review cell lands on the tab that can clear it, rather than on a
 * generic overview the reader then has to navigate out of.
 *
 * Execution owns "this Trade was never entered". Plan owns both the System
 * counterfactual and the Strategy/Setup classification, which is where those
 * two live in this product's IA. Review owns the Post-Trade Review note.
 */
export const TRADE_REVIEW_STATE_TAB: Record<TradeReviewState, TradeDetailsTab> = {
  needs_details: 'execution',
  needs_system_result: 'plan',
  unclassified: 'plan',
  needs_review: 'review',
  reviewed: 'overview',
};

/**
 * The Needs Attention bucket a state corresponds to — `null` for `reviewed`,
 * which is the absence of a bucket rather than a bucket of its own.
 */
export const TRADE_REVIEW_STATE_ATTENTION: Record<TradeReviewState, TradeAttentionKind | null> = {
  needs_details: 'needs-details',
  needs_system_result: 'system-pending',
  unclassified: 'unclassified',
  needs_review: 'reviews-pending',
  reviewed: null,
};

/** Whether the state asks the reader to do something. Drives tone, never colour alone. */
export function isActionableReviewState(state: TradeReviewState): boolean {
  return state !== 'reviewed';
}
