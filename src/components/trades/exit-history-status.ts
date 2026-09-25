import { meaningfulExit, percentToBps, type AfterTradeDraft } from './after-trade-draft';

/**
 * HOW COMPLETE THE EXIT HISTORY IS — never whether the Trade is open.
 *
 * Record Closed reconstructs a Trade that is already closed; its exit history
 * is optional supporting detail under an authoritative Final Net P&L. This
 * reads what the recorded exits themselves say, so Step 5 can show it without
 * being expanded:
 *
 * - `kind` tells a full close in one exit apart from partial / several exits;
 * - `accountedBps` is the share of the original position the exits account
 *   for — an All remaining exit closes whatever was left, so it accounts for
 *   the whole position; otherwise every exit must state its percentage, and a
 *   single unstated one makes the share unknown (`null`) rather than a guess;
 * - `completeness` is the trader's own explicit answer, passed through as is.
 *
 * Nothing here is stored or sent; it is presentation of the draft.
 */
export interface ExitHistoryStatus {
  readonly count: number;
  readonly kind: 'none' | 'single_full' | 'partial';
  readonly accountedBps: number | null;
  readonly completeness: AfterTradeDraft['completeness'];
}

export function exitHistoryStatus(
  exits: AfterTradeDraft['exits'],
  completeness: AfterTradeDraft['completeness'],
): ExitHistoryStatus {
  const recorded = exits.filter(meaningfulExit);
  if (recorded.length === 0) {
    return { count: 0, kind: 'none', accountedBps: null, completeness };
  }
  let accountedBps: number | null;
  if (recorded.some((exit) => exit.scope === 'all_remaining')) {
    accountedBps = 10_000;
  } else {
    let sum = 0;
    let known = true;
    for (const exit of recorded) {
      const bps = percentToBps(exit.closedPercent);
      if (typeof bps !== 'number') {
        known = false;
        break;
      }
      sum += bps;
    }
    accountedBps = known ? sum : null;
  }
  return {
    count: recorded.length,
    kind: recorded.length === 1 && accountedBps === 10_000 ? 'single_full' : 'partial',
    accountedBps,
    completeness,
  };
}

/** A share in basis points as a percentage, with no trailing zeros: 6000 → "60", 3333 → "33.33". */
export function formatShare(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}
