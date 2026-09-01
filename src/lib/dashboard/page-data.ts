import {
  composeSystemAnalytics,
  composeTraderAnalytics,
  toAnalyticsMetric,
  type AnalyticsMetric,
  type AnalyticsScopeModel,
  type ComparisonMetricRecord,
  type PerformanceAnalyticsModel,
  type SystemMetricRecord,
  type TraderMetricRecord,
} from '@/lib/analytics/metrics';
import { averageR, selectTraderEligible } from '@/lib/calc/aggregate';
import { executionGapR, isComparisonEligible } from '@/lib/calc/attribution';
import { dayWinRate, type DayWinRateSummary } from '@/lib/calc/day-win-rate';
import { netPnl, type NetPnlAvailability } from '@/lib/calc/net-pnl';
import type {
  OutcomeValue,
  SystemStatus,
  TradeDirection,
  TradeStatus,
} from '@/lib/trades/constants';
import type { AccountMode } from '@/lib/trading-accounts/constants';

import {
  composeExecutionComparison,
  type DashboardExecutionComparison,
} from './execution-comparison';
import type { DashboardFilterState } from './filters';

export interface DashboardAccountSummary {
  readonly id: string;
  readonly name: string;
  readonly accountMode: AccountMode;
  readonly baseCurrency: string;
  readonly startingBalance: string;
}

export type DashboardAccountContext =
  | { readonly kind: 'all' }
  | {
      readonly kind: 'account';
      readonly source: 'active' | 'explicit';
      readonly account: DashboardAccountSummary;
    };

export interface DashboardAttentionCounts {
  readonly openTrades: number;
  readonly pendingSystemOutcomes: number;
  readonly unclassifiedTrades: number;
  readonly reviewsPending: number;
  readonly needsExecutionDetails: number;
}

export interface DashboardRecentTradeRecord {
  readonly tradeId: string;
  readonly occurredAt: string;
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly tradingAccountName: string;
  readonly status: TradeStatus;
  readonly traderOutcome: OutcomeValue | null;
  readonly actualR: string | null;
  readonly actualExitedAt: string | null;
  readonly systemStatus: SystemStatus;
  readonly systemOutcome: OutcomeValue | null;
  readonly systemR: string | null;
  readonly systemExitedAt: string | null;
  readonly strategyName: string | null;
  readonly setupName: string | null;
}

export type DashboardRecentExecutionGap =
  | { readonly status: 'available'; readonly value: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'actual_incomplete' | 'system_incomplete' | 'both_incomplete';
    }
  | { readonly status: 'error'; readonly reason: 'data_integrity_error' };

export interface DashboardRecentTrade {
  readonly tradeId: string;
  readonly occurredAt: string;
  readonly symbol: string;
  readonly direction: TradeDirection;
  readonly tradingAccountName: string;
  readonly status: TradeStatus;
  readonly systemStatus: SystemStatus;
  readonly strategyName: string | null;
  readonly setupName: string | null;
  readonly actualR: string | null;
  readonly systemR: string | null;
  readonly executionGapR: DashboardRecentExecutionGap;
}

/**
 * The Dashboard's slice of a performance axis.
 *
 * WIDER THAN WHAT THE CARD NOW RENDERS, DELIBERATELY. The System vs Trader
 * card was reduced to three visible metrics (Total R, Win Rate, Avg Win /
 * Loss), but `averageR`, `expectancyR`, `profitFactor`, `maximumDrawdownR`
 * and the outcome composition stay on this projection: they are canonical
 * figures the analytics model already computes for both axes, several other
 * readers consume this type, and pruning a DTO because one presentation
 * stopped rendering a field is exactly the kind of coupling that makes the
 * next surface re-plumb work that was already done. Presentation decides what
 * is SHOWN; this decides what is available.
 *
 * `payoffRatio` joins the slice here because the card now shows it — it is
 * `lib/calc`'s own primitive, computed identically for both axes by
 * `composePerformanceAxis`, never re-derived downstream.
 */
export type DashboardPerformanceData = Pick<
  PerformanceAnalyticsModel,
  | 'sampleCount'
  | 'outcomeCounts'
  | 'totalR'
  | 'winRate'
  | 'averageR'
  | 'expectancyR'
  | 'profitFactor'
  | 'maximumDrawdownR'
  | 'payoffRatio'
  /*
    `equityCurve` joins the slice because the Basic KPI band's Total R card
    draws it as a cumulative-R sparkline. It is `lib/calc`'s own
    `equityCurveR`, already computed for BOTH axes by `composePerformanceAxis`
    over each axis's frozen population, in each axis's own canonical order —
    so the sparkline beside a Total R figure is that same figure's history and
    cannot be a second series computed a second way. Never re-accumulated
    downstream; a React render is not a place to sum a financial series.
  */
  | 'equityCurve'
>;

export interface DashboardPageData {
  readonly scope: AnalyticsScopeModel;
  readonly filters: DashboardFilterState;
  readonly account: DashboardAccountContext;
  readonly availability: {
    readonly trader: 'available' | 'empty';
    readonly system: 'available' | 'empty';
    /** Mirrors `comparison.status` — D5A adds `error` so a failed R parse is not reported as "nothing paired". */
    readonly comparison: 'available' | 'empty' | 'error';
  };
  readonly coverage: {
    readonly traderTradeCount: number;
    readonly systemTradeCount: number;
    readonly pairedTradeCount: number;
    readonly monetaryResultCount: number;
  };
  readonly basic: {
    readonly netPnl: NetPnlAvailability;
    readonly tradeWin: {
      readonly rate: AnalyticsMetric;
      readonly tradeCount: number;
      readonly wins: number;
      readonly breakEvens: number;
      readonly losses: number;
    };
    /**
     * AVERAGE PLANNED REWARD PER 1R OF PLANNED RISK — the PLAN axis, and the
     * one figure on this band that is not a result.
     *
     * `average` is `lib/calc`'s own `averageR` over the persisted
     * `trades.planned_r` snapshots of the Trader-eligible population; it never
     * reads Actual execution, System resolution, realized P&L, or an exit
     * price. `tradeCount` is how many of those Trades actually carried a
     * Planned R, which is a genuinely smaller population than
     * `coverage.traderTradeCount`: a Trade with no Target (or no plan at all)
     * is EXCLUDED, never counted as a `0` plan. Callers must report a zero
     * `tradeCount` as unavailable rather than printing `averageR`'s
     * `no_trades`, which would claim the range holds no Trades at all.
     */
    readonly plannedRr: {
      readonly average: AnalyticsMetric;
      readonly tradeCount: number;
    };
    /*
      THE THREE FIGURES BELOW NO LONGER HAVE A CARD, AND ARE STILL PUBLISHED.

      Profit Factor, Day Win % and Avg Win / Loss were retired from the Basic
      KPI band in favour of Total R, Avg Planned RR and Avg R / Trade. They
      remain canonical Trader-population figures composed here exactly as
      before — the same reason `DashboardPerformanceData` keeps the metrics its
      card stopped rendering. Presentation decides what is SHOWN; this decides
      what is available.
    */
    readonly profitFactor: AnalyticsMetric;
    readonly dayWinRate: AnalyticsMetric<DayWinRateSummary>;
    readonly averageWinLoss: {
      readonly averageWinR: AnalyticsMetric;
      readonly averageLossR: AnalyticsMetric;
      readonly payoffRatio: AnalyticsMetric;
    };
  };
  readonly system: DashboardPerformanceData;
  readonly trader: DashboardPerformanceData;
  /**
   * Population C only. `summary` is D2's frozen comparison model, unchanged;
   * D5A adds the paired trade series, its timezone-local daily rollup, and
   * the Gap distribution alongside it. Both plotted series describe the SAME
   * paired Trade universe — never independent Population A totals set against
   * independent Population B totals.
   */
  readonly comparison: DashboardExecutionComparison;
  readonly attention: {
    /** Operational backlog is workspace-wide and intentionally ignores Dashboard filters. */
    readonly scope: 'workspace_operational';
    readonly counts: DashboardAttentionCounts;
  };
  readonly recentTrades: {
    /** Uses the Dashboard identities/range with lifecycle `occurred_at`, not a D1 metric date axis. */
    readonly scope: 'dashboard_filters';
    readonly dateAxis: 'occurred_at';
    readonly items: readonly DashboardRecentTrade[];
  };
}

/**
 * The canonical Trader analytics record plus the one PLAN field the Dashboard
 * reads.
 *
 * Widened here rather than on `TraderMetricRecord` itself because Planned R is
 * not a Trader-performance input: no analytics formula over the Trader axis
 * takes it, and adding it there would invite exactly the blurring of PLAN and
 * ACTUAL this product exists to prevent. `selectTraderEligible` is generic
 * over its input, so eligibility still runs on the canonical contract and this
 * extra field simply rides along.
 */
export interface DashboardTraderMetricRecord extends TraderMetricRecord {
  /** `trades.planned_r`; `null` for a Trade whose plan sets no reward target. */
  readonly plannedR: string | null;
}

export interface DashboardPageCompositionInput {
  readonly scope: AnalyticsScopeModel;
  readonly filters: DashboardFilterState;
  readonly account: DashboardAccountContext;
  readonly trader: readonly DashboardTraderMetricRecord[];
  readonly system: readonly SystemMetricRecord[];
  readonly comparison: readonly ComparisonMetricRecord[];
  readonly attention: DashboardAttentionCounts;
  readonly recentTrades: readonly DashboardRecentTradeRecord[];
}

const selectPerformance = (axis: PerformanceAnalyticsModel): DashboardPerformanceData => ({
  sampleCount: axis.sampleCount,
  outcomeCounts: axis.outcomeCounts,
  totalR: axis.totalR,
  winRate: axis.winRate,
  averageR: axis.averageR,
  expectancyR: axis.expectancyR,
  profitFactor: axis.profitFactor,
  maximumDrawdownR: axis.maximumDrawdownR,
  payoffRatio: axis.payoffRatio,
  equityCurve: axis.equityCurve,
});

export function composeRecentTrade(record: DashboardRecentTradeRecord): DashboardRecentTrade {
  const actualComplete =
    record.status === 'closed' &&
    record.actualR !== null &&
    record.traderOutcome !== null &&
    record.actualExitedAt !== null;
  const systemComplete =
    record.systemStatus === 'resolved' &&
    record.systemR !== null &&
    record.systemOutcome !== null &&
    record.systemExitedAt !== null;

  let gap: DashboardRecentExecutionGap;
  if (
    isComparisonEligible({
      ...record,
      deletedAt: null,
    })
  ) {
    const result = executionGapR(record.actualR, record.systemR);
    gap = result.ok
      ? { status: 'available', value: result.value }
      : { status: 'error', reason: 'data_integrity_error' };
  } else {
    gap = {
      status: 'unavailable',
      reason:
        !actualComplete && !systemComplete
          ? 'both_incomplete'
          : actualComplete
            ? 'system_incomplete'
            : 'actual_incomplete',
    };
  }

  return {
    tradeId: record.tradeId,
    occurredAt: record.occurredAt,
    symbol: record.symbol,
    direction: record.direction,
    tradingAccountName: record.tradingAccountName,
    status: record.status,
    systemStatus: record.systemStatus,
    strategyName: record.strategyName,
    setupName: record.setupName,
    actualR: record.actualR,
    systemR: record.systemR,
    executionGapR: gap,
  };
}

/**
 * Average Planned RR over the Trades in scope that actually carry a plan.
 *
 * NO NEW FORMULA. `planned_r` is already the canonical per-Trade reward-per-1R
 * snapshot — `plannedR`/`moneyPlannedR` in `lib/calc/trade.ts`, persisted at
 * compute time — and the mean of a set of R values is `lib/calc`'s `averageR`.
 * This function only chooses the population.
 *
 * THE POPULATION IS TRADER-ELIGIBLE ∩ HAS A PLANNED R, and both halves matter.
 * Trader-eligible keeps this card on the same closed-Trade universe, the same
 * Actual `exited_at` date axis, and the same Account/Strategy/Setup/Version
 * scope as every other figure in the band, so the five cards describe one set
 * of Trades. The Planned R filter then drops Trades that planned no reward at
 * all: a Trade with no Target has no ratio to average, and counting it as `0`
 * would report a plan the trader never made.
 */
function composePlannedRr(records: readonly DashboardTraderMetricRecord[]): {
  readonly average: AnalyticsMetric;
  readonly tradeCount: number;
} {
  const values = records
    .map((record) => record.plannedR)
    .filter((value): value is string => value !== null);
  return { average: toAnalyticsMetric(averageR(values)), tradeCount: values.length };
}

/** Pure D2 route-level composer. Widgets consume this DTO and never raw DAL rows. */
export function composeDashboardPageData(input: DashboardPageCompositionInput): DashboardPageData {
  const traderRecords = selectTraderEligible(input.trader);
  const traderFull = composeTraderAnalytics(input.trader);
  const systemFull = composeSystemAnalytics(input.system);
  const comparison = composeExecutionComparison(input.comparison, input.scope.timezone);
  const monetaryResultCount = traderRecords.filter((record) => record.netPnlMinor !== null).length;

  return {
    scope: input.scope,
    filters: input.filters,
    account: input.account,
    availability: {
      trader: traderFull.sampleCount === 0 ? 'empty' : 'available',
      system: systemFull.sampleCount === 0 ? 'empty' : 'available',
      comparison: comparison.status,
    },
    coverage: {
      traderTradeCount: traderFull.sampleCount,
      systemTradeCount: systemFull.sampleCount,
      pairedTradeCount: comparison.summary.comparableCount,
      monetaryResultCount,
    },
    basic: {
      netPnl: netPnl(
        traderRecords.map((record) => ({
          netPnlMinor: record.netPnlMinor,
          baseCurrency: record.baseCurrency,
        })),
      ),
      tradeWin: {
        rate: traderFull.winRate,
        tradeCount: traderFull.sampleCount,
        wins: traderFull.outcomeCounts.wins,
        breakEvens: traderFull.outcomeCounts.breakEvens,
        losses: traderFull.outcomeCounts.losses,
      },
      plannedRr: composePlannedRr(traderRecords),
      profitFactor: traderFull.profitFactor,
      dayWinRate: toAnalyticsMetric(
        dayWinRate(
          traderRecords.map((record) => ({
            actualR: record.actualR as string,
            exitedAt: new Date(record.exitedAt),
          })),
          input.scope.timezone,
        ),
      ),
      averageWinLoss: {
        averageWinR: traderFull.averageWinR,
        averageLossR: traderFull.averageLossR,
        payoffRatio: traderFull.payoffRatio,
      },
    },
    system: selectPerformance(systemFull),
    trader: selectPerformance(traderFull),
    comparison,
    attention: { scope: 'workspace_operational', counts: input.attention },
    recentTrades: {
      scope: 'dashboard_filters',
      dateAxis: 'occurred_at',
      items: input.recentTrades.map(composeRecentTrade),
    },
  };
}
