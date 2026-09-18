import type { OutcomeValue, TradeStatus } from './constants';
import { tradeOutcomeEvidence } from './record-evidence';

/**
 * WHAT HAPPENED, IN ONE WORD — the Trades table's Result column.
 *
 * The two axes stay separate (CLAUDE.md §1). This is the TRADER axis alone:
 * it reads the Trader Outcome the record may actually claim
 * (`record-evidence.ts`), and never infers anything from the System side. The
 * System's own outcome has its own presentation inside Trade Details and is
 * never folded into this cell.
 *
 * `unresolved` is a real state, not an error: a legacy Trade can be closed
 * while its outcome classification is absent. Printing `BE` for it would be a
 * lie about a break-even, and printing `LOSS` would be worse.
 *
 * `outcome_unanswered` is a different real state: an Add Trade contract row
 * whose Trader Outcome is the trader's to choose and has not been chosen
 * (contract §12). A stored `trader_outcome` there that the trader did not
 * select was derived from R under the pre-contract rules, so showing it as WIN
 * or LOSS would attribute to the trader a judgement they never made. A
 * selected outcome is shown as the trader's own.
 */
export type TradeResultKind =
  OutcomeValue | 'open' | 'planned' | 'canceled' | 'unresolved' | 'outcome_unanswered';

export interface TradeResultInput {
  readonly status: TradeStatus;
  readonly traderOutcome: OutcomeValue | null;
  readonly traderOutcomeSelected: boolean;
  readonly recordingContract: string | null;
}

export function deriveTradeResult(trade: TradeResultInput): TradeResultKind {
  if (trade.status === 'open') return 'open';
  if (trade.status === 'planned') return 'planned';
  if (trade.status === 'canceled') return 'canceled';
  const evidence = tradeOutcomeEvidence(trade);
  if (evidence.status === 'unavailable') {
    return evidence.reason === 'outcome_not_selected' ? 'outcome_unanswered' : 'unresolved';
  }
  return evidence.outcome;
}
