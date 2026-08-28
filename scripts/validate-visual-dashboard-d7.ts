/**
 * D7A read-only validation against the deterministic visual fixture.
 *
 * WRITES NOTHING. It reads parent Trade rows only, composes the canonical
 * modeled-balance DTO for All/90D/30D, and verifies that Exit legs never
 * become independent balance realizations.
 */
import postgres from 'postgres';

import { resolveAnalyticsDateBounds, type AnalyticsDatePreset } from '@/lib/analytics/filters';
import {
  composeRiskPerformance,
  type AvailableRiskPerformanceData,
  type ModeledBalanceTradeInput,
} from '@/lib/dashboard/risk-performance';

import {
  VISUAL_EMPTY_ACCOUNT_NAME,
  VISUAL_FIXTURE_EMAIL,
  VISUAL_FIXTURE_REFERENCE_INSTANT,
  VISUAL_POPULATED_ACCOUNT_NAME,
} from './visual-dashboard-fixture';

interface FixtureAccount {
  readonly id: string;
  readonly name: string;
  readonly base_currency: string;
  readonly starting_balance: string;
}

function summarizePlan(explainRows: readonly Record<string, unknown>[]) {
  const document = (
    explainRows[0]?.['QUERY PLAN'] as readonly Record<string, unknown>[] | undefined
  )?.[0];
  if (document === undefined) throw new Error('STOP: missing Risk Performance JSON EXPLAIN.');
  const plan = document.Plan as Record<string, unknown>;
  const nodeTypes = new Set<string>();
  function visit(node: Record<string, unknown>) {
    nodeTypes.add(node['Node Type'] as string);
    for (const child of (node.Plans as readonly Record<string, unknown>[] | undefined) ?? []) {
      visit(child);
    }
  }
  visit(plan);
  return {
    planningMs: document['Planning Time'],
    executionMs: document['Execution Time'],
    rows: plan['Actual Rows'],
    loops: plan['Actual Loops'],
    nodeTypes: [...nodeTypes],
    sharedHitBlocks: plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: plan['Shared Read Blocks'] ?? 0,
  };
}

function requireAvailable(
  label: string,
  value: ReturnType<typeof composeRiskPerformance>,
): AvailableRiskPerformanceData {
  if (value.status !== 'available') {
    throw new Error(`${label}: expected available Risk Performance, got ${JSON.stringify(value)}`);
  }
  return value;
}

function summary(value: AvailableRiskPerformanceData) {
  return {
    openingBalanceMinor: value.openingBalanceMinor,
    endingBalanceMinor: value.endingBalanceMinor,
    periodNetPnlMinor: value.periodNetPnlMinor,
    peakBalanceMinor: value.peakBalanceMinor,
    currentDrawdown: value.currentDrawdown,
    maxDrawdown: value.maxDrawdown,
    closedTradeCount: value.closedTradeCount,
    seriesPointCount: value.series.length,
    checkedClosedTradeCount: value.completeness.checkedClosedTradeCount,
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
      select id, name, base_currency, starting_balance::text
      from trading_accounts
      where workspace_id = ${workspaceId}
        and name in (${VISUAL_POPULATED_ACCOUNT_NAME}, ${VISUAL_EMPTY_ACCOUNT_NAME})
    `;
    const byName = new Map(accounts.map((row) => [row.name as string, row as FixtureAccount]));
    const populated = byName.get(VISUAL_POPULATED_ACCOUNT_NAME);
    const empty = byName.get(VISUAL_EMPTY_ACCOUNT_NAME);
    if (populated === undefined || empty === undefined) {
      throw new Error('STOP: visual fixture Accounts are not seeded.');
    }

    async function loadTrades(
      account: FixtureAccount,
    ): Promise<readonly ModeledBalanceTradeInput[]> {
      const rows = await sql`
        select id, exited_at, net_pnl_minor::text
        from trades
        where workspace_id = ${workspaceId}
          and trading_account_id = ${account.id}
          and status = 'closed'
          and deleted_at is null
          and exited_at is not null
          and exited_at < ${VISUAL_FIXTURE_REFERENCE_INSTANT}
        order by exited_at asc
      `;
      return rows.map((row) => ({
        tradeId: row.id as string,
        actualExitedAt: row.exited_at as Date,
        netPnlMinor: row.net_pnl_minor as string | null,
        baseCurrency: account.base_currency,
      }));
    }

    function compose(
      account: FixtureAccount,
      trades: readonly ModeledBalanceTradeInput[],
      datePreset: AnalyticsDatePreset,
    ) {
      const resolved = resolveAnalyticsDateBounds(
        datePreset,
        timezone,
        VISUAL_FIXTURE_REFERENCE_INSTANT,
      );
      if (!resolved.ok) throw new Error(`STOP: ${datePreset} bounds failed: ${resolved.code}`);
      return composeRiskPerformance({
        scope: {
          datePreset,
          dateBounds: resolved.bounds,
          account: {
            kind: 'account',
            accountId: account.id,
            source: 'explicit',
            baseCurrency: account.base_currency,
            startingBalance: account.starting_balance,
          },
          strategyId: null,
          setupId: null,
          strategyVersionId: null,
        },
        asOf: VISUAL_FIXTURE_REFERENCE_INSTANT,
        trades,
      });
    }

    const [populatedTrades, emptyTrades] = await Promise.all([
      loadTrades(populated),
      loadTrades(empty),
    ]);
    const explainRows = await sql`
      explain (analyze, buffers, format json)
      select id, exited_at, net_pnl_minor
      from trades
      where workspace_id = ${workspaceId}
        and trading_account_id = ${populated.id}
        and status = 'closed'
        and deleted_at is null
        and exited_at is not null
        and exited_at < ${VISUAL_FIXTURE_REFERENCE_INSTANT}
      order by exited_at asc
    `;
    const queryPlan = summarizePlan(explainRows);
    const populatedAll = requireAvailable(
      'Visual — Populated All',
      compose(populated, populatedTrades, 'all'),
    );
    const populated90 = requireAvailable(
      'Visual — Populated 90D',
      compose(populated, populatedTrades, '90d'),
    );
    const populated30 = requireAvailable(
      'Visual — Populated 30D',
      compose(populated, populatedTrades, '30d'),
    );
    const emptyAll = requireAvailable('Visual — Empty All', compose(empty, emptyTrades, 'all'));

    if (
      populatedAll.startingBalanceMinor !== '1000000' ||
      populatedAll.periodNetPnlMinor !== '231000' ||
      populatedAll.endingBalanceMinor !== '1231000' ||
      populatedAll.closedTradeCount !== 66
    ) {
      throw new Error(
        `STOP: populated All reconciliation failed: ${JSON.stringify(summary(populatedAll))}`,
      );
    }
    if (
      emptyAll.openingBalanceMinor !== '1000000' ||
      emptyAll.endingBalanceMinor !== '1000000' ||
      emptyAll.currentDrawdown.amountMinor !== '0' ||
      emptyAll.maxDrawdown.amountMinor !== '0' ||
      emptyAll.closedTradeCount !== 0
    ) {
      throw new Error(
        `STOP: empty Account reconciliation failed: ${JSON.stringify(summary(emptyAll))}`,
      );
    }

    const [partial] = await sql`
      select count(*)::int as partial_trade_count,
             coalesce(sum(exit_count), 0)::int as partial_exit_count
      from (
        select t.id, count(te.id)::int as exit_count
        from trades t
        join trade_exits te on te.trade_id = t.id and te.workspace_id = t.workspace_id
        where t.workspace_id = ${workspaceId}
          and t.trading_account_id = ${populated.id}
          and t.status = 'closed'
          and t.deleted_at is null
        group by t.id
        having count(te.id) > 1
      ) partials
    `;
    if (partial?.partial_trade_count !== 10 || partial.partial_exit_count !== 24) {
      throw new Error(`STOP: partial-close fixture drifted: ${JSON.stringify(partial)}`);
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          timezone,
          asOf: VISUAL_FIXTURE_REFERENCE_INSTANT.toISOString(),
          queryArchitecture: {
            dashboardCoreMajorReads: 5,
            riskPerformanceMajorReads: 1,
            riskProjectionColumns: ['id', 'exited_at', 'net_pnl_minor'],
            populatedRowsReturned: populatedTrades.length,
            emptyRowsReturned: emptyTrades.length,
            fixtureExplain: queryPlan,
          },
          empty: summary(emptyAll),
          populated: {
            all: summary(populatedAll),
            '90d': summary(populated90),
            '30d': summary(populated30),
          },
          partialClose: {
            tradeCount: partial.partial_trade_count,
            exitLegCount: partial.partial_exit_count,
            balanceEventCount: populatedAll.closedTradeCount,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await sql.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
