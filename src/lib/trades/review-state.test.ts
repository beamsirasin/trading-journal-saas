import { describe, expect, it } from 'vitest';

import { TRADE_ATTENTION_KINDS } from './constants';
import {
  deriveTradeReviewState,
  isActionableReviewState,
  TRADE_REVIEW_STATE_ATTENTION,
  TRADE_REVIEW_STATE_TAB,
  TRADE_REVIEW_STATES,
  type TradeReviewStateInput,
} from './review-state';

function trade(overrides: Partial<TradeReviewStateInput> = {}): TradeReviewStateInput {
  return {
    status: 'closed',
    systemStatus: 'resolved',
    strategyName: 'Elliott Wave',
    hasReviewNotes: true,
    ...overrides,
  };
}

describe('deriveTradeReviewState — each state tests exactly its bucket predicate', () => {
  it('needs details when the Trade was never entered', () => {
    expect(deriveTradeReviewState(trade({ status: 'planned' }))).toBe('needs_details');
  });

  it('needs a system result while the System axis is pending', () => {
    expect(deriveTradeReviewState(trade({ systemStatus: 'pending' }))).toBe('needs_system_result');
  });

  it('is unclassified with no Strategy', () => {
    expect(deriveTradeReviewState(trade({ strategyName: null }))).toBe('unclassified');
  });

  it('needs review for a closed Trade with no review note', () => {
    expect(deriveTradeReviewState(trade({ hasReviewNotes: false }))).toBe('needs_review');
  });

  it('is reviewed once every actionable state has been ruled out', () => {
    expect(deriveTradeReviewState(trade())).toBe('reviewed');
  });
});

describe('deriveTradeReviewState — one state per Trade, in workable order', () => {
  it('reports the only job that can actually be done first', () => {
    // This Trade satisfies four predicates at once. Naming all four would ask
    // a beginner to do four things when only the first is even possible.
    const everything = trade({
      status: 'planned',
      systemStatus: 'pending',
      strategyName: null,
      hasReviewNotes: false,
    });
    expect(deriveTradeReviewState(everything)).toBe('needs_details');
  });

  it('does not ask for a review on a Trade that is still open', () => {
    // `reviews-pending` is `status = 'closed' AND review_notes IS NULL`; an
    // open position has nothing settled to review yet.
    expect(deriveTradeReviewState(trade({ status: 'open', hasReviewNotes: false }))).toBe(
      'reviewed',
    );
  });

  it('does not ask for a review on a canceled Trade', () => {
    expect(deriveTradeReviewState(trade({ status: 'canceled', hasReviewNotes: false }))).toBe(
      'reviewed',
    );
  });

  it('treats a System marked no_trade as settled, not pending', () => {
    expect(deriveTradeReviewState(trade({ systemStatus: 'no_trade' }))).toBe('reviewed');
  });
});

describe('the review vocabulary stays in step with the attention vocabulary', () => {
  it('maps every actionable state onto a real Needs Attention bucket', () => {
    for (const state of TRADE_REVIEW_STATES) {
      const bucket = TRADE_REVIEW_STATE_ATTENTION[state];
      if (isActionableReviewState(state)) {
        expect(bucket).not.toBeNull();
        expect(TRADE_ATTENTION_KINDS).toContain(bucket);
      } else {
        // "Reviewed" is the absence of a bucket, not a bucket of its own.
        expect(bucket).toBeNull();
      }
    }
  });

  it('covers four of the five buckets, leaving only the one this column cannot express', () => {
    // `open` is a lifecycle fact, not a journal job: an open position is not
    // waiting on the trader to write anything, so the Review column has no
    // actionable state for it. It stays reachable through the panel's own link.
    const covered = TRADE_REVIEW_STATES.map((state) => TRADE_REVIEW_STATE_ATTENTION[state]).filter(
      (bucket) => bucket !== null,
    );
    expect(new Set(covered)).toEqual(
      new Set(['needs-details', 'system-pending', 'unclassified', 'reviews-pending']),
    );
  });

  it('sends each actionable state to a tab that can actually clear it', () => {
    expect(TRADE_REVIEW_STATE_TAB.needs_details).toBe('execution');
    expect(TRADE_REVIEW_STATE_TAB.needs_system_result).toBe('plan');
    expect(TRADE_REVIEW_STATE_TAB.unclassified).toBe('plan');
    expect(TRADE_REVIEW_STATE_TAB.needs_review).toBe('review');
  });
});
