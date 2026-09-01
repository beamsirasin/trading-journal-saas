import type { OutcomeValue } from './constants';

/**
 * THE ATTRIBUTION QUADRANT, FOR ONE TRADE.
 *
 * This is CLAUDE.md section 1's central distinction, reduced to the one
 * sentence a beginner can act on: did the SYSTEM work, and did the TRADER
 * capture it? Every cell is a real, representable combination of two
 * INDEPENDENTLY STORED outcomes — `system_outcome` and `trader_outcome` — and
 * neither is ever inferred from the other or from realized profit.
 *
 * All nine combinations are named, not four. Break-even is a first-class
 * outcome in this product (an explicit tolerance-banded classification, never
 * an equality test against zero), so a system that broke even under a trader
 * who won is a genuine, distinct fact and gets its own reading rather than
 * being rounded into "win" or "loss" to fit a two-by-two grid.
 *
 * NO SCORE IS PRODUCED, AND NO ADVICE IS GIVEN. The key names a state; the
 * copy behind it describes what happened in plain words. There is no
 * Discipline Score here, no penalty weighting, and no allocation of a Trade's
 * gap across its mistakes — none of those has an approved formula
 * (CLAUDE.md section 6 / A2).
 *
 * `null` whenever either axis is unresolved. A Trade whose System outcome has
 * not been recorded has no attribution story yet, and inventing one from the
 * trader side alone is exactly the confusion this product exists to remove.
 */
export type TradeAttributionQuadrant =
  | 'win_win'
  | 'win_break_even'
  | 'win_loss'
  | 'break_even_win'
  | 'break_even_break_even'
  | 'break_even_loss'
  | 'loss_win'
  | 'loss_break_even'
  | 'loss_loss';

export interface TradeAttributionQuadrantInput {
  readonly systemOutcome: OutcomeValue | null;
  readonly traderOutcome: OutcomeValue | null;
}

export function deriveTradeAttributionQuadrant(
  trade: TradeAttributionQuadrantInput,
): TradeAttributionQuadrant | null {
  if (trade.systemOutcome === null || trade.traderOutcome === null) return null;
  return `${trade.systemOutcome}_${trade.traderOutcome}` as TradeAttributionQuadrant;
}
