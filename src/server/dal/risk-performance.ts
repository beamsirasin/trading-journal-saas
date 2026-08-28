import 'server-only';

import { and, asc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import type { AnalyticsFilterInput } from '@/lib/analytics/filters';
import type { ModeledBalanceTradeInput } from '@/lib/dashboard/risk-performance';
import { systemClock } from '@/lib/time';
import { getDb } from '@/server/db/client';
import { trades } from '@/server/db/schema';

import {
  resolveAnalyticsQueryContext,
  type AnalyticsFilterErrorCode,
  type AnalyticsReadOptions,
  type AnalyticsReadResult,
  type DashboardRawData,
} from './analytics';

export const RISK_PERFORMANCE_MAJOR_PROJECTIONS = ['closed_actual_money_history'] as const;
export const RISK_PERFORMANCE_MAJOR_PROJECTION_COUNT = RISK_PERFORMANCE_MAJOR_PROJECTIONS.length;

export interface RiskPerformanceRawData {
  readonly filters: DashboardRawData['filters'];
  readonly account: DashboardRawData['account'];
  readonly asOf: Date;
  /**
   * One narrow row per closed Trade: ID, Actual `exited_at`, and authoritative
   * Trade-level `net_pnl_minor`. No Exit-leg join, R field, System field, or
   * Analytics snapshot data is selected.
   */
  readonly trades: readonly ModeledBalanceTradeInput[];
}

export type RiskPerformanceReadResult = AnalyticsReadResult<RiskPerformanceRawData>;
export type RiskPerformanceReadErrorCode = AnalyticsFilterErrorCode;

/**
 * Separate D7A server-driven boundary. It reuses the authenticated Dashboard
 * scope resolver, then performs at most ONE focused historical balance read.
 * Strategy/Setup/Version identities are still validated by the resolver but
 * deliberately do not enter this Account-level projection's WHERE clause.
 */
export async function getRiskPerformanceRawData(
  input: AnalyticsFilterInput | unknown,
  options: AnalyticsReadOptions = {},
): Promise<RiskPerformanceReadResult> {
  const context = await resolveAnalyticsQueryContext(input, options);
  if (!context.ok) return context;

  const asOf = options.referenceInstant ?? systemClock.now();
  if (context.data.account.kind === 'all') {
    return {
      ok: true,
      data: {
        filters: context.data.filters,
        account: context.data.account,
        asOf,
        trades: [],
      },
    };
  }

  const account = context.data.account.account;
  const rows = await getDb()
    .select({
      tradeId: trades.id,
      // Preserve PostgreSQL's microsecond precision. JavaScript Date would
      // truncate it to milliseconds and could falsely group distinct closes.
      actualExitedAt: sql<string>`to_char(${trades.exitedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      netPnlMinor: trades.netPnlMinor,
    })
    .from(trades)
    .where(
      and(
        eq(trades.workspaceId, context.data.workspaceId),
        eq(trades.tradingAccountId, account.id),
        eq(trades.status, 'closed'),
        isNull(trades.deletedAt),
        isNotNull(trades.exitedAt),
        lt(trades.exitedAt, asOf),
      ),
    )
    .orderBy(asc(trades.exitedAt));

  return {
    ok: true,
    data: {
      filters: context.data.filters,
      account: context.data.account,
      asOf,
      trades: rows.map((row) => ({
        tradeId: row.tradeId,
        actualExitedAt: row.actualExitedAt,
        netPnlMinor: row.netPnlMinor,
        baseCurrency: account.baseCurrency,
      })),
    },
  };
}
