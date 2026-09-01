/**
 * D5A read-only validation against the deterministic visual fixture.
 *
 * WRITES NOTHING. It opens the same database the seed script targets, reads
 * the two fixture Accounts, runs the real `composeDashboardPageData`, and
 * prints the Population C facts D5A is contracted to produce. Verification
 * that mutates what it verifies is not verification, so this script contains
 * no INSERT, UPDATE, DELETE or DDL and never opens a write transaction.
 *
 * Run: `pnpm validate:visual-dashboard-d5`
 */
import postgres from 'postgres';

import type { ComparisonMetricRecord, SystemMetricRecord } from '@/lib/analytics/metrics';
import {
  composeDashboardPageData,
  type DashboardPageData,
  type DashboardRecentTradeRecord,
  type DashboardTraderMetricRecord,
} from '@/lib/dashboard/page-data';
import type { OutcomeValue, SystemStatus, TradeStatus } from '@/lib/trades/constants';

import {
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_POPULATED_ACCOUNT_NAME,
} from './visual-dashboard-fixture';

function safeJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, candidate) => (typeof candidate === 'bigint' ? candidate.toString() : candidate),
    2,
  );
}

function metricValue(metric: { readonly status: string; readonly value?: unknown }) {
  return metric.status === 'available' ? metric.value : metric;
}

function accountScope(accountId: string, timezone: string) {
  return {
    datePreset: 'all' as const,
    dateBounds: { kind: 'all' as const, start: null, endExclusive: null },
    accountScope: { kind: 'account' as const, accountId, source: 'explicit' as const },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    timezone,
  };
}

function filters(accountId: string) {
  return {
    datePreset: 'all' as const,
    customDateRange: null,
    accountScope: { kind: 'account' as const, accountId },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    unitMode: 'r' as const,
    dimensions: {
      symbol: null,
      side: null,
      session: null,
      timeframe: null,
      ruleAdherence: null,
      mistake: null,
      emotion: null,
    },
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    throw new Error('STOP: DATABASE_URL is not set. Run with --env-file=.env.local.');
  }
  const targetEmail = (process.env.VISUAL_TEST_EMAIL ?? VISUAL_FIXTURE_EMAIL).trim().toLowerCase();
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const [user] = await sql`select id from users where lower(email) = ${targetEmail} limit 2`;
    if (user === undefined) throw new Error(`STOP: no user for ${targetEmail}.`);

    const memberships = await sql`
      select wm.workspace_id, up.timezone,
             (up.active_trading_account_id is not null
              and ta.workspace_id = wm.workspace_id) as owns_active_account
      from workspace_members wm
      left join user_preferences up on up.user_id = wm.user_id
      left join trading_accounts ta on ta.id = up.active_trading_account_id
      where wm.user_id = ${user.id}
      order by owns_active_account desc nulls last, wm.workspace_id
    `;
    const active = memberships.filter((row) => row.owns_active_account === true);
    const membership = active.length === 1 ? active[0] : memberships[0];
    if (membership === undefined) throw new Error('STOP: workspace cannot be resolved.');
    const workspaceId = membership.workspace_id as string;
    const timezone = membership.timezone as string;

    const accounts = await sql`
      select id, name, account_mode, base_currency, starting_balance
      from trading_accounts
      where workspace_id = ${workspaceId}
        and name in (${VISUAL_POPULATED_ACCOUNT_NAME}, ${VISUAL_EMPTY_ACCOUNT_NAME})
    `;
    const byName = new Map(accounts.map((row) => [row.name as string, row]));
    const populated = byName.get(VISUAL_POPULATED_ACCOUNT_NAME);
    const empty = byName.get(VISUAL_EMPTY_ACCOUNT_NAME);
    if (populated === undefined || empty === undefined) {
      throw new Error(
        'STOP: visual fixture Accounts are not seeded. Run pnpm seed:visual-dashboard.',
      );
    }

    const attentionRows = await sql`
      select
        count(*) filter (where status = 'open')::int as open_trades,
        count(*) filter (where system_status = 'pending')::int as pending_system_outcomes,
        count(*) filter (where strategy_id is null)::int as unclassified_trades,
        count(*) filter (where status = 'closed' and review_notes is null)::int as reviews_pending,
        0::int as needs_execution_details
      from trades
      where workspace_id = ${workspaceId} and deleted_at is null
    `;

    const loadPage = async (
      accountId: string,
      zone: string = timezone,
    ): Promise<DashboardPageData> => {
      const traderRaw = await sql`
        select t.id as trade_id, t.status, t.actual_r, t.trader_outcome,
               t.exited_at, t.net_pnl_minor::text, t.planned_r, ta.base_currency
        from trades t
        join trading_accounts ta on ta.id = t.trading_account_id
        where t.workspace_id = ${workspaceId} and t.trading_account_id = ${accountId}
          and t.status = 'closed' and t.deleted_at is null
          and t.actual_r is not null and t.trader_outcome is not null and t.exited_at is not null
      `;
      const systemRaw = await sql`
        select id as trade_id, system_status, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountId}
          and system_status = 'resolved' and deleted_at is null
          and system_r is not null and system_outcome is not null and system_exited_at is not null
      `;
      /*
        POPULATION A ∪ B, mirroring `selectComparisonCandidateRecords`.

        This query used to spell the eligibility rule itself
        (`status = 'closed' and system_status = 'resolved'`), which made it a
        THIRD copy of a predicate that already existed in the DAL and in
        `isComparisonEligible`. It also meant this validator could never see
        an excluded Trade, so the one number it exists to check — why the
        paired totals differ from the card totals — was structurally always
        zero here. It now hands the composer candidates and lets
        `isComparisonEligible` do the narrowing, exactly as production does.

        No date bounds: this validator reads the fixture over all time, so the
        per-axis anchoring the DAL applies has nothing to gate.
      */
      const comparisonRaw = await sql`
        select id as trade_id, status, actual_r, trader_outcome, exited_at,
               system_status, system_r, system_outcome, system_exited_at
        from trades
        where workspace_id = ${workspaceId} and trading_account_id = ${accountId}
          and deleted_at is null
          and (
            (status = 'closed' and actual_r is not null
              and trader_outcome is not null and exited_at is not null)
            or (system_status = 'resolved' and system_r is not null
              and system_outcome is not null and system_exited_at is not null)
          )
      `;

      const trader: DashboardTraderMetricRecord[] = traderRaw.map((row) => ({
        tradeId: row.trade_id as string,
        status: row.status as TradeStatus,
        deletedAt: null,
        actualR: row.actual_r as string,
        traderOutcome: row.trader_outcome as OutcomeValue,
        exitedAt: (row.exited_at as Date).toISOString(),
        netPnlMinor: row.net_pnl_minor as string,
        baseCurrency: row.base_currency as string,
        plannedR: row.planned_r as string | null,
      }));
      const system: SystemMetricRecord[] = systemRaw.map((row) => ({
        tradeId: row.trade_id as string,
        systemStatus: row.system_status as SystemStatus,
        deletedAt: null,
        systemR: row.system_r as string,
        systemOutcome: row.system_outcome as OutcomeValue,
        systemExitedAt: (row.system_exited_at as Date).toISOString(),
      }));
      // Nullable throughout: a candidate is complete on at least one axis, so
      // whichever axis is incomplete is exactly what comes back null.
      const comparison: ComparisonMetricRecord[] = comparisonRaw.map((row) => ({
        tradeId: row.trade_id as string,
        status: row.status as TradeStatus,
        deletedAt: null,
        actualR: (row.actual_r as string | null) ?? null,
        traderOutcome: (row.trader_outcome as OutcomeValue | null) ?? null,
        actualExitedAt: (row.exited_at as Date | null)?.toISOString() ?? null,
        systemStatus: row.system_status as SystemStatus,
        systemR: (row.system_r as string | null) ?? null,
        systemOutcome: (row.system_outcome as OutcomeValue | null) ?? null,
        systemExitedAt: (row.system_exited_at as Date | null)?.toISOString() ?? null,
      }));
      const recentTrades: readonly DashboardRecentTradeRecord[] = [];
      const account = accountId === (populated.id as string) ? populated : empty;

      return composeDashboardPageData({
        scope: accountScope(accountId, zone),
        filters: filters(accountId),
        account: {
          kind: 'account',
          source: 'explicit',
          account: {
            id: accountId,
            name: account.name as string,
            accountMode: account.account_mode as 'live',
            baseCurrency: account.base_currency as string,
            startingBalance: account.starting_balance as string,
          },
        },
        trader,
        system,
        comparison,
        attention: {
          openTrades: attentionRows[0]?.open_trades as number,
          pendingSystemOutcomes: attentionRows[0]?.pending_system_outcomes as number,
          unclassifiedTrades: attentionRows[0]?.unclassified_trades as number,
          reviewsPending: attentionRows[0]?.reviews_pending as number,
          needsExecutionDetails: 0,
        },
        recentTrades,
      });
    };

    const populatedPage = await loadPage(populated.id as string);
    // Same paired population, different configured analytics zone. The daily
    // buckets must re-derive from the local date while every total stays put.
    const bangkokPage = await loadPage(populated.id as string, 'Asia/Bangkok');
    const emptyPage = await loadPage(empty.id as string);
    const comparison = populatedPage.comparison;

    // Partial closes must contribute exactly one series point each.
    const partialRows = await sql`
      select count(*)::int as partial_close_trades,
             count(*) filter (where paired)::int as paired_partial_close_trades
      from (
        select t.id,
               count(te.id)::int as leg_count,
               (t.status = 'closed' and t.system_status = 'resolved'
                and t.actual_r is not null and t.system_r is not null
                and t.exited_at is not null and t.system_exited_at is not null) as paired
        from trades t
        join trade_exits te on te.trade_id = t.id
        where t.workspace_id = ${workspaceId}
          and t.trading_account_id = ${populated.id}
          and t.deleted_at is null
        group by t.id, t.status, t.system_status, t.actual_r, t.system_r, t.exited_at, t.system_exited_at
      ) legs
      where leg_count > 1
    `;
    const partialIds = await sql`
      select t.id
      from trades t
      join trade_exits te on te.trade_id = t.id
      where t.workspace_id = ${workspaceId}
        and t.trading_account_id = ${populated.id}
        and t.deleted_at is null
      group by t.id
      having count(te.id) > 1
    `;
    const partialIdSet = new Set(partialIds.map((row) => row.id as string));

    const report = {
      target: {
        email: targetEmail,
        workspaceId,
        timezone,
        databaseHost: new URL(databaseUrl).host,
      },
      readOnly: true,
      populations: {
        note: 'A-only/B-only are EXCLUSIVE counts; canonical totals include the paired 64.',
        traderPopulationATotal: populatedPage.coverage.traderTradeCount,
        systemPopulationBTotal: populatedPage.coverage.systemTradeCount,
        pairedPopulationC: populatedPage.coverage.pairedTradeCount,
        aOnly: populatedPage.coverage.traderTradeCount - populatedPage.coverage.pairedTradeCount,
        bOnly: populatedPage.coverage.systemTradeCount - populatedPage.coverage.pairedTradeCount,
      },
      independentTotals: {
        traderTotalR: metricValue(populatedPage.trader.totalR),
        systemTotalR: metricValue(populatedPage.system.totalR),
        note: 'Independent A/B totals are NOT expected to equal the paired totals below.',
      },
      comparisonStatus: comparison.status,
      paired:
        comparison.status !== 'available'
          ? null
          : {
              count: comparison.summary.comparableCount,
              systemTotalR: metricValue(comparison.summary.pairedSystemTotalR),
              actualTotalR: metricValue(comparison.summary.pairedActualTotalR),
              totalExecutionGapR: metricValue(comparison.summary.executionGapR),
              averageExecutionGapR: metricValue(comparison.summary.averageExecutionGapR),
              systemEdgeCaptured: metricValue(comparison.summary.systemEdgeCaptured),
              systemEdgeCapturedPercent:
                comparison.summary.systemEdgeCaptured.status === 'available'
                  ? `${(Number(comparison.summary.systemEdgeCaptured.value) * 100).toFixed(2)}%`
                  : comparison.summary.systemEdgeCaptured,
              /*
                THE TWO AXES OVER ONE POPULATION, AND WHAT WAS LEFT OUT.

                Printed side by side with the System and Trader cards' own
                figures, these are the numbers that show why a merged card
                cannot simply reuse them: the cards count Populations B and A,
                these count the intersection, and the difference is the six
                Trades the exclusions block names.
              */
              pairedAxes: {
                system: {
                  sampleCount: comparison.summary.pairedSystemAxis.sampleCount,
                  totalR: metricValue(comparison.summary.pairedSystemAxis.totalR),
                  winRate: metricValue(comparison.summary.pairedSystemAxis.winRate),
                  payoffRatio: metricValue(comparison.summary.pairedSystemAxis.payoffRatio),
                  outcomeCounts: comparison.summary.pairedSystemAxis.outcomeCounts,
                },
                actual: {
                  sampleCount: comparison.summary.pairedActualAxis.sampleCount,
                  totalR: metricValue(comparison.summary.pairedActualAxis.totalR),
                  winRate: metricValue(comparison.summary.pairedActualAxis.winRate),
                  payoffRatio: metricValue(comparison.summary.pairedActualAxis.payoffRatio),
                  outcomeCounts: comparison.summary.pairedActualAxis.outcomeCounts,
                },
                denominatorsMatch:
                  comparison.summary.pairedSystemAxis.sampleCount ===
                  comparison.summary.pairedActualAxis.sampleCount,
              },
              exclusions: comparison.exclusions,
              distribution: {
                underperformed: comparison.distribution.underperformedCount,
                matched: comparison.distribution.matchedCount,
                outperformed: comparison.distribution.outperformedCount,
                minimumExecutionGapR: metricValue(comparison.distribution.minimumExecutionGapR),
                maximumExecutionGapR: metricValue(comparison.distribution.maximumExecutionGapR),
              },
              tradeSeries: {
                length: comparison.tradeSeries.length,
                first: comparison.tradeSeries[0],
                last: comparison.tradeSeries.at(-1),
              },
              dailySeries: {
                length: comparison.dailySeries.length,
                first: comparison.dailySeries[0],
                last: comparison.dailySeries.at(-1),
                totalPairedTrades: comparison.dailySeries.reduce(
                  (total, point) => total + point.pairedTradeCount,
                  0,
                ),
              },
              reconciliation: {
                pairedActualMinusPairedSystem:
                  comparison.summary.pairedActualTotalR.status === 'available' &&
                  comparison.summary.pairedSystemTotalR.status === 'available'
                    ? (
                        Number(comparison.summary.pairedActualTotalR.value) -
                        Number(comparison.summary.pairedSystemTotalR.value)
                      ).toFixed(4)
                    : null,
                finalTradeCumulativeGapR:
                  comparison.tradeSeries.at(-1)?.cumulativeExecutionGapR ?? null,
                finalDailyCumulativeGapR:
                  comparison.dailySeries.at(-1)?.cumulativeExecutionGapR ?? null,
                summaryTotalGapR: metricValue(comparison.summary.executionGapR),
                distributionCountsSumToPairedCount:
                  comparison.distribution.underperformedCount +
                    comparison.distribution.matchedCount +
                    comparison.distribution.outperformedCount ===
                  comparison.summary.comparableCount,
                dailyCountsSumToPairedCount:
                  comparison.dailySeries.reduce(
                    (total, point) => total + point.pairedTradeCount,
                    0,
                  ) === comparison.summary.comparableCount,
                seriesLengthEqualsPairedCount:
                  comparison.tradeSeries.length === comparison.summary.comparableCount,
                everyTradePointHoldsIdentity: comparison.tradeSeries.every(
                  (point) =>
                    Math.abs(
                      Number(point.cumulativeExecutionGapR) -
                        (Number(point.cumulativeActualR) - Number(point.cumulativeSystemR)),
                    ) < 1e-9,
                ),
                everyDailyPointHoldsIdentity: comparison.dailySeries.every(
                  (point) =>
                    Math.abs(
                      Number(point.cumulativeExecutionGapR) -
                        (Number(point.cumulativeActualR) - Number(point.cumulativeSystemR)),
                    ) < 1e-9,
                ),
              },
              partialCloses: {
                partialCloseTrades: partialRows[0]?.partial_close_trades ?? 0,
                pairedPartialCloseTrades: partialRows[0]?.paired_partial_close_trades ?? 0,
                seriesPointsForPartialCloseTrades: comparison.tradeSeries.filter((point) =>
                  partialIdSet.has(point.tradeId),
                ).length,
                oneSeriesPointPerPartialCloseTrade: comparison.tradeSeries.every(
                  (point, _index, all) =>
                    all.filter((other) => other.tradeId === point.tradeId).length === 1,
                ),
              },
            },
      timezone: {
        configured: timezone,
        configuredDailyBuckets:
          comparison.status === 'available' ? comparison.dailySeries.length : null,
        configuredFirstBucket:
          comparison.status === 'available' ? comparison.dailySeries[0]?.date : null,
        bangkokDailyBuckets:
          bangkokPage.comparison.status === 'available'
            ? bangkokPage.comparison.dailySeries.length
            : null,
        bangkokFirstBucket:
          bangkokPage.comparison.status === 'available'
            ? bangkokPage.comparison.dailySeries[0]?.date
            : null,
        totalsUnchangedAcrossZones:
          metricValue(bangkokPage.comparison.summary.executionGapR) ===
          metricValue(populatedPage.comparison.summary.executionGapR),
      },
      visualEmpty: {
        comparisonStatus: emptyPage.comparison.status,
        reason: 'reason' in emptyPage.comparison ? emptyPage.comparison.reason : null,
        pairedCount: emptyPage.comparison.summary.comparableCount,
        traderTradeCount: emptyPage.coverage.traderTradeCount,
        systemTradeCount: emptyPage.coverage.systemTradeCount,
        availability: emptyPage.availability.comparison,
      },
    };

    console.log(safeJson(report));
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Visual fixture D5 validation failed.');
  process.exitCode = 1;
});
