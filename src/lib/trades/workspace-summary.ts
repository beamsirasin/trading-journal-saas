import type { AnalyticsUnavailableReason } from '@/lib/analytics/metrics';
import {
  neutralMetric,
  plainValue,
  signedMetric,
  type MetricDisplayValue,
} from '@/lib/dashboard/metric-display';
import type { DashboardPageData } from '@/lib/dashboard/page-data';
import { formatMoney, fromMinorUnits, type CurrencyCode } from '@/lib/money';

/**
 * THE TRADES WORKSPACE'S FOUR SUMMARY FIGURES.
 *
 * FOUR, NOT FIVE, AND NOT THE DASHBOARD'S FIVE. This page is a workspace, not
 * a second Dashboard: the table is the content and this strip is orientation.
 * It answers only "how many, how much, how many R, how often" for whatever
 * the toolbar currently has in scope, and it deliberately drops Avg Planned RR
 * and Avg R / Trade — both are readings of figures already present here, and a
 * reader who wants them has a Dashboard.
 *
 * NOT ONE FORMULA LIVES IN THIS FILE. Every figure is selected from the
 * canonical `DashboardPageData` the Dashboard service already composed:
 * `basic.netPnl` is `lib/calc`'s `netPnl`, `trader.totalR` is its `totalR`
 * over the Trader population, and `basic.tradeWin.rate` is its trade win rate.
 * Nothing is summed, averaged, or re-rounded here (CLAUDE.md §6) — this module
 * turns canonical states into display strings and nothing else.
 *
 * WHICH POPULATION THESE DESCRIBE, STATED PLAINLY. Under All Trades and
 * Closed Trades all four describe the ELIGIBLE Trader population inside the
 * current Account / Date Range / Filters scope — the closed, complete Trades
 * canonical analytics can compute over. The table below lists every Trade in
 * that same scope, so under All Trades it can legitimately show more rows than
 * `tradeCount` counts. That is why the Trades card prints its own count rather
 * than letting a reader infer one from the row count.
 *
 * UNDER OPEN TRADES, THREE OF THE FOUR ARE WITHHELD. An open position has no
 * settled result: there is no realized P&L to total, no final R to sum, and no
 * outcome to count as a win. The canonical Trader population excludes it by
 * construction, so reporting `0.00R` there would not be a small inaccuracy —
 * it would be a claim that a trader currently holding risk has made nothing.
 * The three result figures therefore report an explicit reason and only the
 * count is answered, from the listed population itself (CLAUDE.md section 6:
 * never a silent zero).
 */
export const TRADES_SUMMARY_KEYS = ['tradeCount', 'netPnl', 'totalR', 'winRate'] as const;

export type TradesSummaryKey = (typeof TRADES_SUMMARY_KEYS)[number];

/**
 * The canonical analytics reasons plus the three monetary-availability ones
 * `netPnl` owns. Identical to the Basic KPI band's vocabulary minus
 * `no_planned_rr`, which belongs to a card this strip does not carry — so
 * every reason here already resolves under `dashboard.real.unavailable.*`.
 */
export type TradesSummaryUnavailableReason =
  | AnalyticsUnavailableReason
  | 'incomplete'
  | 'mixed_currency'
  | 'unsupported_currency_scale'
  /**
   * THIS PAGE'S OWN REASON, not a canonical analytics one: the selected
   * population is open positions, which have no settled result to measure. It
   * is a statement about the QUESTION being asked, not a failure of a metric
   * over a population — reporting it as `no_trades` would claim the scope
   * holds no Trades at all while the table beneath listed them.
   */
  | 'open_positions';

export type TradesSummaryValue = MetricDisplayValue<TradesSummaryUnavailableReason>;

export interface TradesSummaryModel {
  readonly key: TradesSummaryKey;
  readonly value: TradesSummaryValue;
}

/**
 * Which population the workspace is currently showing.
 *
 * `settled` covers All Trades and Closed Trades alike, because the canonical
 * Trader population is the settled one either way and the four figures mean
 * exactly what they have always meant. `open` carries its own count, because
 * no analytics read describes open positions and the paged list cannot count
 * itself.
 */
export type TradesSummaryScope =
  { readonly kind: 'settled' } | { readonly kind: 'open'; readonly tradeCount: number };

const SETTLED_SCOPE: TradesSummaryScope = { kind: 'settled' };

const EMPTY: TradesSummaryValue = { status: 'empty' };

function formatNetPnl(currency: CurrencyCode, totalMinor: string): TradesSummaryValue {
  let amountMinor: bigint;
  try {
    amountMinor = BigInt(totalMinor);
  } catch {
    return { status: 'error' };
  }
  const money = fromMinorUnits(amountMinor, currency);
  if (!money.ok) return { status: 'error' };
  const formatted = formatMoney(money.value, { style: 'symbol' });
  return {
    status: 'available',
    text: amountMinor > 0n ? `+${formatted}` : formatted,
    tone: amountMinor > 0n ? 'positive' : amountMinor < 0n ? 'negative' : 'neutral',
  };
}

export function composeTradesSummary(
  data: DashboardPageData,
  scope: TradesSummaryScope = SETTLED_SCOPE,
): readonly TradesSummaryModel[] {
  if (scope.kind === 'open') {
    const unmeasurable: TradesSummaryValue = {
      status: 'unavailable',
      reason: 'open_positions',
    };
    return TRADES_SUMMARY_KEYS.map((key) => ({
      key,
      value: key === 'tradeCount' ? plainValue(String(scope.tradeCount)) : unmeasurable,
    }));
  }

  const populationEmpty = data.availability.trader === 'empty';
  const { basic, trader } = data;

  /*
    THE COUNT IS A COUNT, NOT A METRIC. It has no unavailable state of its
    own — zero eligible Trades is a truthful `0`, not "not available" — so it
    is the one figure here that never reports `empty`. Everything beside it
    does, because a Net P&L or a Win Rate over nothing is not zero, it is
    undefined.
  */
  const tradeCount: TradesSummaryValue = plainValue(String(data.coverage.traderTradeCount));

  const netPnl: TradesSummaryValue = populationEmpty
    ? EMPTY
    : basic.netPnl.status === 'empty'
      ? EMPTY
      : basic.netPnl.status === 'unavailable'
        ? { status: 'unavailable', reason: basic.netPnl.reason }
        : formatNetPnl(basic.netPnl.currency, basic.netPnl.totalMinor);

  // The ACTUAL, realized Trader total — never the System axis, and never the
  // paired subset. Signed, because "did this make or lose" is the whole
  // content of the figure.
  const totalR: TradesSummaryValue = populationEmpty ? EMPTY : signedMetric(trader.totalR, 'r');

  // Neutral by design: a high Win Rate is not a verdict (CLAUDE.md §1), and
  // colouring it would teach exactly the lesson this product exists to undo.
  const winRate: TradesSummaryValue = populationEmpty
    ? EMPTY
    : neutralMetric(basic.tradeWin.rate, 'percent');

  const values: Record<TradesSummaryKey, TradesSummaryValue> = {
    tradeCount,
    netPnl,
    totalR,
    winRate,
  };

  return TRADES_SUMMARY_KEYS.map((key) => ({ key, value: values[key] }));
}
