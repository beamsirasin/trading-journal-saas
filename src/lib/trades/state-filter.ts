import { z } from 'zod';

import type { TradeStatus } from './constants';

/**
 * THE TRADES WORKSPACE'S TOP-LEVEL POPULATION.
 *
 * Three states, and they are not a new domain concept: each one is either the
 * whole workspace population or exactly one value of the canonical
 * `trades.status` lifecycle (`TRADE_STATUSES`, mirrored by the database's own
 * `trades_status_check`). Nothing here re-derives "open" or "closed" from a
 * display label, an outcome, a P&L sign, or a date — the status column is the
 * product's one authority on where a Trade is in its life, and this module
 * only chooses which value of it to ask for.
 *
 * WHAT EACH STATE MEANS, AND WHAT IT DELIBERATELY LEAVES OUT:
 *
 *   all      every Trade in the current scope — planned, open, closed and
 *            canceled alike. The default, because a journal's resting state is
 *            the whole journal.
 *
 *   open     `status = 'open'` ONLY. A PLANNED Trade is not an open position:
 *            it was never entered, there is no exposure, and counting it as
 *            open would tell a trader they are in a market they are not in.
 *            `planned` has its own Needs Attention bucket ("needs-details")
 *            and its own Result badge; it is not folded in here.
 *
 *   closed   `status = 'closed'` ONLY — the settled population, whatever its
 *            outcome (win, loss or break-even). `canceled` is excluded: a
 *            Trade that was called off never produced a result and is not a
 *            completed Trade, only a terminal one.
 *
 * The Trader analytics population is a subset of `closed` by construction,
 * which is why the summary figures are meaningful under `all` and `closed` and
 * are honestly withheld under `open` rather than reported as zero.
 */
export const TRADES_STATE_FILTERS = ['all', 'open', 'closed'] as const;

export type TradesStateFilter = (typeof TRADES_STATE_FILTERS)[number];

/** The resting state: the whole journal, narrowed by nothing but the toolbar. */
export const DEFAULT_TRADES_STATE_FILTER: TradesStateFilter = 'all';

export const TradesStateFilterSchema = z.enum(TRADES_STATE_FILTERS);

/**
 * Parses an untrusted `?state=`. Anything absent, repeated, or unrecognised
 * resolves to {@link DEFAULT_TRADES_STATE_FILTER} rather than failing the
 * page: showing a reader the whole journal is never wrong, only wider than
 * they asked for, and the control itself will show which state is applied.
 */
export function parseTradesStateFilter(value: string | string[] | undefined): TradesStateFilter {
  if (typeof value !== 'string') return DEFAULT_TRADES_STATE_FILTER;
  const result = TradesStateFilterSchema.safeParse(value);
  return result.success ? result.data : DEFAULT_TRADES_STATE_FILTER;
}

/**
 * The canonical `trades.status` value a state narrows to, or `null` for "do
 * not narrow at all".
 *
 * Returning the domain's own `TradeStatus` — rather than a bespoke predicate —
 * is what keeps this a routing decision instead of a second definition of the
 * Trade lifecycle. The DAL applies it as an ordinary equality on the status
 * column, exactly as it already does for `systemStatus`.
 */
export function tradesStateFilterStatus(state: TradesStateFilter): TradeStatus | null {
  return state === 'all' ? null : state;
}
