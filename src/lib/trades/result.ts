import type { OutcomeValue, TradeStatus } from './constants';

/**
 * WHAT HAPPENED, IN ONE WORD — the Trades table's Result column.
 *
 * The two axes stay separate (CLAUDE.md §1). This is the TRADER axis alone:
 * it reads `trader_outcome`, the stored classification of what the trader
 * actually got, and never infers anything from the System side. The System's
 * own outcome has its own presentation inside Trade Details and is never
 * folded into this cell.
 *
 * `unresolved` is a real state, not an error: a Trade can be closed while its
 * outcome classification is absent (a legacy row, or one whose result was
 * never computable). Printing `BE` for it would be a lie about a break-even,
 * and printing `LOSS` would be worse.
 */
export type TradeResultKind = OutcomeValue | 'open' | 'planned' | 'canceled' | 'unresolved';

export interface TradeResultInput {
  readonly status: TradeStatus;
  readonly traderOutcome: OutcomeValue | null;
}

export function deriveTradeResult(trade: TradeResultInput): TradeResultKind {
  if (trade.status === 'open') return 'open';
  if (trade.status === 'planned') return 'planned';
  if (trade.status === 'canceled') return 'canceled';
  return trade.traderOutcome ?? 'unresolved';
}
