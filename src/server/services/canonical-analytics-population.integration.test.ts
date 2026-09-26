import Decimal from 'decimal.js';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseDashboardFilterState } from '@/lib/dashboard/filters';
import {
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { activePaidPeriod } from '@/test/entitlement-fixtures';
import { withRequiredCloseAnswers } from '@/test/final-close';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import { createCompletedTrade } from './trade-completed';
import { addTradeExit } from './trade-execution';
import { recordContractExit } from './trade-exit-contract';
import { closeTrade, createTrade, openTrade, resolveSystemTrade } from './trade-management';

/**
 * CANONICAL ANALYTICS NEVER SILENTLY MIX LEGACY AND ADD TRADE v1 EVIDENCE
 * (Add Trade contract §25, §28).
 *
 * One Account holds both kinds of Trade, written through the real services:
 *
 *   contract A  Risk at Entry 100.00, Net +150.00 → Actual R +1.5000, and a
 *               System result resolved through the legacy System flow (+2R)
 *   contract B  Risk at Entry 100.00, Net  -50.00 → Actual R -0.5000
 *   legacy L1   Money: Actual Risk 50.00 as 1R, Net +100.00 → legacy R +2.0000,
 *               plus a legacy System result (+3R)
 *   legacy L2   Price mode: R from price geometry
 *
 * Contract A and B close through the contract Final Close with Final Net P&L
 * stated and the Trader Outcome left Unanswered; both legacy rows carry an
 * outcome DERIVED from R on close.
 *
 * What must hold: canonical R reads contract A and B only; no outcome metric
 * reads a derived outcome; no System, paired or Gap figure exists; every
 * excluded row is disclosed as coverage, never as a zero or a loss; and Net
 * P&L, which is money with no legacy form, still reads every closed Trade.
 */

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({ api: { getSession: async () => currentSession } }),
}));

const { getAnalyticsSnapshot } = await import('./analytics');
const { getDashboardPageData } = await import('./dashboard');
const { getDashboardCalendarMonthInZone, getDashboardDayReview } =
  await import('./dashboard-calendar');
const { getDashboardInsightData } = await import('./dashboard-insights');

const db = getTestDb();
const REFERENCE = new Date('2026-08-20T12:00:00.000Z');
const READ = { referenceInstant: REFERENCE } as const;

let userId: string;
let workspaceId: string;
let accountId: string;
const ids: Record<'contractA' | 'contractB' | 'legacyMoney' | 'legacyPrice', string> = {
  contractA: '',
  contractB: '',
  legacyMoney: '',
  legacyPrice: '',
};

function must<T extends { ok: boolean }>(result: T, what: string): T {
  if (!result.ok) throw new Error(`${what} failed: ${JSON.stringify(result)}`);
  return result;
}

async function contractTrade(params: {
  netPnlMinor: bigint;
  exitedAt: Date;
  withTarget?: boolean;
}): Promise<string> {
  const created = must(
    await createTrade(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      symbol: 'XAUUSD',
      direction: 'long',
      recordingTiming: 'at_entry',
      recordingContract: 'add_trade_v1',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      plannedRiskState: 'defined',
      enteredAt: new Date(params.exitedAt.getTime() - 60 * 60 * 1000),
      enteredAtSource: 'trader',
      ...(params.withTarget === true
        ? { targetState: 'fixed' as const, plannedRewardMinor: 20_000n }
        : {}),
    }),
    'contract create',
  );
  if (!created.ok) throw new Error('unreachable');
  must(
    await recordContractExit(
      workspaceId,
      userId,
      created.tradeId,
      await withRequiredCloseAnswers(created.tradeId, {
        mutationKey: crypto.randomUUID(),
        scope: 'all_remaining',
        exitPrice: '2410',
        finalPnlMinor: params.netPnlMinor,
        finalExitedAt: params.exitedAt,
      }),
    ),
    'contract close',
  );
  // These fixtures stand for Trades closed before decision 59 gated the close
  // on an outcome: the outcome stays Unanswered, as those closes stored it.
  await db
    .update(trades)
    .set({ traderOutcome: null, traderOutcomeSelectedAt: null })
    .where(eq(trades.id, created.tradeId));
  return created.tradeId;
}

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      name: 'Canonical analytics',
      email: `canonical-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user insert failed');
  userId = user.id;
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'Canonical', slug: `canonical-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace insert failed');
  workspaceId = workspace.id;
  await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name: 'Mixed history',
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
    })
    .returning({ id: tradingAccounts.id });
  if (account === undefined) throw new Error('account insert failed');
  accountId = account.id;
  await db.insert(userPreferences).values({
    userId,
    activeWorkspaceId: workspaceId,
    activeTradingAccountId: accountId,
    timezone: 'UTC',
  });
  await db.insert(workspaceEntitlements).values({
    workspaceId,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    ...activePaidPeriod(),
  });
  currentSession = {
    user: {
      id: userId,
      name: 'Canonical analytics',
      email: `${userId}@example.test`,
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date('2027-01-01T00:00:00Z') },
  };

  // Contract A: canonical Actual R, plus a System result from the legacy flow.
  ids.contractA = await contractTrade({
    netPnlMinor: 15_000n,
    exitedAt: new Date('2026-08-03T10:00:00Z'),
    withTarget: true,
  });
  must(
    await resolveSystemTrade(workspaceId, userId, ids.contractA, {
      resolutionKind: 'money_target',
      systemExitedAt: new Date('2026-08-03T11:00:00Z'),
      systemCostR: '0',
    }),
    'contract System resolve',
  );

  // Contract B: canonical Actual R, no System result.
  ids.contractB = await contractTrade({
    netPnlMinor: -5_000n,
    exitedAt: new Date('2026-08-04T10:00:00Z'),
  });

  // Legacy Money: Actual Risk (50.00) was the 1R baseline, so this R is legacy R.
  const legacyMoney = must(
    await createTrade(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      symbol: 'EURUSD',
      direction: 'long',
      systemPlanBasis: 'money',
      plannedRiskMinor: 10_000n,
      plannedRewardMinor: 30_000n,
    }),
    'legacy money create',
  );
  if (!legacyMoney.ok) throw new Error('unreachable');
  ids.legacyMoney = legacyMoney.tradeId;
  must(
    await openTrade(workspaceId, userId, ids.legacyMoney, {
      actualResultMode: 'money',
      actualInitialRiskMinor: 5_000n,
      enteredAt: new Date('2026-08-03T08:00:00Z'),
    }),
    'legacy money open',
  );
  must(
    await closeTrade(workspaceId, userId, ids.legacyMoney, {
      actualExit: '1.1100',
      netPnlMinor: 10_000n,
      exitedAt: new Date('2026-08-03T09:00:00Z'),
    }),
    'legacy money close',
  );
  must(
    await resolveSystemTrade(workspaceId, userId, ids.legacyMoney, {
      resolutionKind: 'money_target',
      systemExitedAt: new Date('2026-08-03T12:00:00Z'),
      systemCostR: '0',
    }),
    'legacy System resolve',
  );

  // Legacy Price mode: R from price geometry.
  const legacyPrice = must(
    await createTrade(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      symbol: 'GBPUSD',
      direction: 'long',
      plannedEntry: '1.1000000000',
      plannedStop: '1.0950000000',
      plannedTarget: '1.1100000000',
    }),
    'legacy price create',
  );
  if (!legacyPrice.ok) throw new Error('unreachable');
  ids.legacyPrice = legacyPrice.tradeId;
  must(
    await openTrade(workspaceId, userId, ids.legacyPrice, {
      actualResultMode: 'price',
      actualEntry: '1.1000000000',
      actualInitialStop: '1.0950000000',
      enteredAt: new Date('2026-08-05T08:00:00Z'),
    }),
    'legacy price open',
  );
  // Price mode closes through its Exit legs and carries no money result at all.
  must(
    await addTradeExit(workspaceId, userId, ids.legacyPrice, {
      mutationKey: crypto.randomUUID(),
      closedBps: 10_000,
      exitPrice: '1.1100000000',
      exitedAt: new Date('2026-08-05T09:00:00Z'),
    }),
    'legacy price exit',
  );
}, 120_000);

afterAll(async () => {
  currentSession = null;
  await db.delete(workspaces).where(inArray(workspaces.id, [workspaceId]));
  await db.delete(users).where(eq(users.id, userId));
  await closeDb();
  await closeTestDb();
});

function dashboardFilters() {
  const parsed = parseDashboardFilterState({ account: accountId, range: 'all' });
  if (!parsed.ok) throw new Error(parsed.code);
  return parsed.state;
}

describe('canonical analytics population — mixed legacy and Add Trade v1 history', () => {
  it('the fixture really is mixed: legacy rows carry legacy R, outcomes and System results', async () => {
    // Guards every exclusion below from passing on an empty fixture.
    const rows = await db.query.trades.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.workspaceId, workspaceId),
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(ids.contractA)).toMatchObject({
      recordingContract: 'add_trade_v1',
      actualR: '1.5000',
      finalPnlSource: 'manual_total',
      traderOutcome: null,
      systemStatus: 'resolved',
      systemR: '2.0000',
    });
    expect(byId.get(ids.contractB)).toMatchObject({
      recordingContract: 'add_trade_v1',
      actualR: '-0.5000',
      finalPnlSource: 'manual_total',
      traderOutcome: null,
    });
    expect(byId.get(ids.legacyMoney)).toMatchObject({
      recordingContract: null,
      actualR: '2.0000',
      traderOutcome: 'win',
      systemStatus: 'resolved',
      systemR: '3.0000',
    });
    expect(byId.get(ids.legacyPrice)).toMatchObject({
      recordingContract: null,
      actualResultMode: 'price',
      traderOutcome: 'win',
    });
    expect(byId.get(ids.legacyPrice)?.actualR).not.toBeNull();
  });

  it('Actual R: legacy and Price-mode R never enter canonical R metrics', async () => {
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    const { trader } = result.data;
    // Contract A (+1.5) and B (-0.5) only. With either legacy row mixed in,
    // Total R would be 3.5 or more.
    expect(trader.sampleCount).toBe(2);
    expect(trader.totalR).toEqual({ status: 'available', value: '1.0000' });
    expect(trader.averageR).toEqual({ status: 'available', value: '0.5000' });
    expect(trader.equityCurve).toMatchObject({
      status: 'available',
      value: [{ tradeId: ids.contractA }, { tradeId: ids.contractB }],
    });
  });

  it('Trader Win Rate: a derived outcome is never counted, and absence is not a loss', async () => {
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    const { trader } = result.data;
    // The legacy rows' outcomes were derived from R and the contract rows'
    // are Unanswered. None may reach Win Rate: not as 50%, not as 0%, not as losses.
    expect(trader.winRate).toEqual({ status: 'unavailable', reason: 'no_outcomes_answered' });
    expect(trader.averageWinR).toEqual({ status: 'unavailable', reason: 'no_outcomes_answered' });
    expect(trader.averageLossR).toEqual({ status: 'unavailable', reason: 'no_outcomes_answered' });
    expect(trader.payoffRatio).toEqual({ status: 'unavailable', reason: 'no_outcomes_answered' });
    expect(trader.outcomeCounts).toBeNull();

    const dashboard = await getDashboardPageData(dashboardFilters(), READ);
    if (!dashboard.ok) throw new Error(dashboard.code);
    expect(dashboard.data.basic.tradeWin).toEqual({
      rate: { status: 'unavailable', reason: 'no_outcomes_answered' },
      tradeCount: 2,
      outcomes: null,
    });
  });

  it('System: a legacy System R never becomes a canonical System Result', async () => {
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    // Two resolved System results exist (one on a contract row). Neither is
    // canonical, so the System axis has no sample rather than +5R.
    expect(result.data.system.sampleCount).toBe(0);
    expect(result.data.system.totalR).toEqual({ status: 'unavailable', reason: 'no_trades' });

    const month = await getDashboardCalendarMonthInZone(
      dashboardFilters(),
      { mode: 'system', year: 2026, month: 8 },
      'UTC',
      READ,
    );
    if (!month.ok) throw new Error(month.code);
    expect(month.data.status).toBe('empty');
  });

  it('Paired: a legacy System result cannot pair with a canonical Actual R', async () => {
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    // Contract A has a canonical Actual R AND a (legacy) System R. Pairing them
    // would report an Execution Gap of -0.5R.
    expect(result.data.comparison.comparableCount).toBe(0);
    expect(result.data.comparison.executionGapR).toEqual({
      status: 'unavailable',
      reason: 'no_comparable_trades',
    });
    expect(result.data.comparison.systemEdgeCaptured).toEqual({
      status: 'unavailable',
      reason: 'no_comparable_trades',
    });

    const dashboard = await getDashboardPageData(dashboardFilters(), READ);
    if (!dashboard.ok) throw new Error(dashboard.code);
    expect(dashboard.data.comparison.status).toBe('empty');
    // Recent Trades and Day Review rows never show a paired Gap either.
    for (const row of dashboard.data.recentTrades.items) {
      expect(row.systemR).toBeNull();
      expect(row.executionGapR.status).not.toBe('available');
    }

    const gap = await getDashboardCalendarMonthInZone(
      dashboardFilters(),
      { mode: 'gap', year: 2026, month: 8 },
      'UTC',
      READ,
    );
    if (!gap.ok) throw new Error(gap.code);
    expect(gap.data.status).toBe('empty');

    const insights = await getDashboardInsightData(dashboardFilters(), READ);
    if (!insights.ok) throw new Error(insights.code);
    expect(JSON.stringify(insights.data)).not.toContain(
      '"averageExecutionGapR":{"status":"available"',
    );
  });

  it('Coverage: excluded rows are disclosed as counts, never as zero, negative or missing results', async () => {
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.legacyCoverage).toEqual({
      excludedActualCount: 2,
      excludedSystemCount: 2,
      undatedClosedCount: 0,
      dateRangeActive: false,
    });
    // Excluded rows are absent, not present as zero-R or loss samples: the
    // sample is exactly the two canonical Trades and no outcome was counted.
    expect(result.data.trader.sampleCount).toBe(2);
    expect(result.data.trader.outcomeCounts).toBeNull();

    const dashboard = await getDashboardPageData(dashboardFilters(), READ);
    if (!dashboard.ok) throw new Error(dashboard.code);
    expect(dashboard.data.coverage).toEqual({
      traderTradeCount: 2,
      systemTradeCount: 0,
      pairedTradeCount: 0,
      closedTradeCount: 4,
      // The legacy Price-mode Trade has no Final Net P&L.
      monetaryResultCount: 3,
      legacy: {
        excludedActualCount: 2,
        excludedSystemCount: 2,
        undatedClosedCount: 0,
        dateRangeActive: false,
      },
    });

    // Coverage follows each axis's own date gate: legacy Actual exits on
    // 3 and 5 August, legacy System exits on 3 August.
    const bounded = await getAnalyticsSnapshot(
      { datePreset: 'custom', fromDate: '2026-08-05', toDate: '2026-08-05' },
      READ,
    );
    if (!bounded.ok) throw new Error(bounded.code);
    expect(bounded.data.legacyCoverage).toEqual({
      excludedActualCount: 1,
      excludedSystemCount: 0,
      undatedClosedCount: 0,
      dateRangeActive: true,
    });
  });

  it('Net P&L: money has no legacy form, so it still reads every closed Trade', async () => {
    // All four closed Trades are in the money population. The legacy Price-mode
    // one has no Final Net P&L, so the total is honestly incomplete. Had legacy
    // rows been dropped the way legacy R is, this would read as an available
    // +100.00 from the two contract Trades alone.
    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.traderNetPnl).toEqual({ status: 'unavailable', reason: 'incomplete' });

    const dashboard = await getDashboardPageData(dashboardFilters(), READ);
    if (!dashboard.ok) throw new Error(dashboard.code);
    expect(dashboard.data.basic.netPnl).toEqual(result.data.traderNetPnl);

    // Scoped to the three money-recorded days, all three money results count:
    // two contract Trades (+150, -50) and the legacy Money Trade (+100).
    const money = await getAnalyticsSnapshot(
      { datePreset: 'custom', fromDate: '2026-08-03', toDate: '2026-08-04' },
      READ,
    );
    if (!money.ok) throw new Error(money.code);
    expect(money.data.traderNetPnl).toEqual({
      status: 'available',
      currency: 'USD',
      totalMinor: '20000',
    });
  });

  it('Calendar and Day Review read the canonical population only', async () => {
    const month = await getDashboardCalendarMonthInZone(
      dashboardFilters(),
      { mode: 'actual', year: 2026, month: 8 },
      'UTC',
      READ,
    );
    if (!month.ok) throw new Error(month.code);
    if (month.data.status !== 'available') throw new Error(`calendar ${month.data.status}`);
    // 3 August holds contract A (+1.5) and legacy L1 (+2.0); 5 August holds
    // only legacy L2, so it must not appear at all.
    expect(
      month.data.days.map((day) => [day.date, day.mode === 'gap' ? null : day.totalR]),
    ).toEqual([
      ['2026-08-03', '1.5000'],
      ['2026-08-04', '-0.5000'],
    ]);
    for (const day of month.data.days) {
      if (day.mode !== 'gap') expect(day.outcomes).toBeNull();
    }

    const review = await getDashboardDayReview(
      dashboardFilters(),
      { mode: 'actual', date: '2026-08-03' },
      'UTC',
      READ,
    );
    if (!review.ok) throw new Error(review.code);
    if (review.data.status !== 'available') throw new Error(`review ${review.data.status}`);
    expect(review.data.trades.map((row) => row.tradeId)).toEqual([ids.contractA]);
    expect(review.data.trades[0]?.systemR).toBeNull();
    expect(review.data.headline).toMatchObject({ outcomes: null });
  });

  // Runs last: it adds a Trade, and every case above counts the fixture as-is.
  it('Trader Win Rate: an outcome the trader selected in After Trade counts; a derived one still does not', async () => {
    const saved = must(
      await createCompletedTrade(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: accountId,
        recordingTiming: 'after_trade',
        recordingContract: 'add_trade_v1',
        symbol: 'XAUUSD',
        direction: 'long',
        plannedRiskMinor: 10_000n,
        finalPnlMinor: 2_000n,
        finalPnlStatedTotal: true,
        // A small profit the trader calls a scratch: BE, not Win.
        traderOutcome: 'break_even',
        enteredAt: new Date('2026-08-06T09:00:00Z'),
        exitedAt: new Date('2026-08-06T10:00:00Z'),
      }),
      'After Trade save',
    );
    if (!saved.ok) throw new Error('unreachable');

    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!result.ok) throw new Error(result.code);
    const { trader } = result.data;
    // Its Actual R (+0.2) joins canonical R beside contract A and B.
    expect(trader.sampleCount).toBe(3);
    // Only its selected BE is an answered outcome: BE is in the denominator,
    // not the numerator, and the derived outcomes on A and B stay out.
    expect(trader.outcomeCounts).toEqual({ wins: 0, breakEvens: 1, losses: 0 });
    expect(trader.winRate).toMatchObject({ status: 'available' });
  });

  // Runs after the case above, and adds two more After Trade Trades.
  it('each figure reads its own evidence: an outcome needs no R, a total needs no exit time', async () => {
    // A selected Win with no Risk at Entry: an outcome, never an R sample.
    must(
      await createCompletedTrade(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: accountId,
        recordingTiming: 'after_trade',
        recordingContract: 'add_trade_v1',
        symbol: 'XAUUSD',
        direction: 'long',
        finalPnlMinor: 3_000n,
        finalPnlStatedTotal: true,
        traderOutcome: 'win',
        exitedAt: new Date('2026-08-07T10:00:00Z'),
      }),
      'outcome-only save',
    );
    // An R with no final exit time: in every total, on no timeline.
    const undated = must(
      await createCompletedTrade(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: accountId,
        recordingTiming: 'after_trade',
        recordingContract: 'add_trade_v1',
        symbol: 'XAUUSD',
        direction: 'short',
        plannedRiskMinor: 10_000n,
        finalPnlMinor: 5_000n,
        finalPnlStatedTotal: true,
      }),
      'undated save',
    );
    if (!undated.ok) throw new Error('unreachable');

    const all = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!all.ok) throw new Error(all.code);
    const { trader } = all.data;
    // R: contract A (+1.5), B (-0.5), the BE Trade (+0.2) and the undated one (+0.5).
    expect(trader.sampleCount).toBe(4);
    expect(trader.totalR).toEqual({ status: 'available', value: '1.7000' });
    expect(trader.undatedCount).toBe(1);
    if (trader.equityCurve.status !== 'available') throw new Error('equity unavailable');
    expect(trader.equityCurve.value.map((point) => point.tradeId)).not.toContain(undated.tradeId);
    // Outcomes: the selected BE and the selected Win — with no R — only.
    expect(trader.outcomeCounts).toEqual({ wins: 1, breakEvens: 1, losses: 0 });
    expect(trader.winRate).toEqual({ status: 'available', value: '0.5000' });
    expect(all.data.legacyCoverage).toMatchObject({
      undatedClosedCount: 1,
      dateRangeActive: false,
    });

    // A date range cannot place the undated Trade: it is in no figure there, and said so.
    const ranged = await getAnalyticsSnapshot(
      { datePreset: 'custom', fromDate: '2026-08-01', toDate: '2026-08-31' },
      READ,
    );
    if (!ranged.ok) throw new Error(ranged.code);
    expect(ranged.data.trader.sampleCount).toBe(3);
    expect(ranged.data.trader.undatedCount).toBe(0);
    expect(ranged.data.legacyCoverage).toMatchObject({
      undatedClosedCount: 1,
      dateRangeActive: true,
    });

    // The Dashboard agrees: outcome-only Trades count toward Win Rate's sample.
    const dashboard = await getDashboardPageData(dashboardFilters(), READ);
    if (!dashboard.ok) throw new Error(dashboard.code);
    expect(dashboard.data.basic.tradeWin.tradeCount).toBe(trader.outcomeSampleCount);
    expect(dashboard.data.coverage.traderTradeCount).toBe(4);
  });

  // Runs last, and adds two more contract Trades; asserts deltas only.
  it('a contract Trade closed by the legacy live close is legacy evidence; a contract Final Close is canonical', async () => {
    const before = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!before.ok) throw new Error(before.code);

    const open = async (): Promise<string> => {
      const created = must(
        await createTrade(workspaceId, userId, {
          mutationKey: crypto.randomUUID(),
          tradingAccountId: accountId,
          symbol: 'XAUUSD',
          direction: 'long',
          recordingTiming: 'at_entry',
          recordingContract: 'add_trade_v1',
          systemPlanBasis: 'money',
          plannedRiskMinor: 10_000n,
          plannedRiskState: 'defined',
          enteredAt: new Date('2026-08-10T09:00:00Z'),
          enteredAtSource: 'trader',
        }),
        'contract create',
      );
      if (!created.ok) throw new Error('unreachable');
      return created.tradeId;
    };
    // A contract Trade closed by the legacy live close before it was retired
    // (it now refuses contract Trades): net P&L and a derived outcome, no
    // stated Final Net P&L, so its +3R must not become canonical R.
    const legacyClosed = await open();
    expect(
      await closeTrade(workspaceId, userId, legacyClosed, {
        actualExit: '2410',
        netPnlMinor: 30_000n,
        exitedAt: new Date('2026-08-10T10:00:00Z'),
      }),
    ).toEqual({ ok: false, code: 'contract_close_required' });
    await db
      .update(trades)
      .set({
        status: 'closed',
        actualResultMode: 'money',
        actualExit: '2410',
        netPnlMinor: 30_000n,
        actualR: '3.0000',
        traderOutcome: 'win',
        exitedAt: new Date('2026-08-10T10:00:00Z'),
        calcVersion: 1,
      })
      .where(eq(trades.id, legacyClosed));
    // Contract Final Close: a stated -1R with a selected Loss.
    must(
      await recordContractExit(
        workspaceId,
        userId,
        await open(),
        await withRequiredCloseAnswers(await open(), {
          mutationKey: crypto.randomUUID(),
          scope: 'all_remaining',
          finalPnlMinor: -10_000n,
          traderOutcome: 'loss',
          finalExitedAt: new Date('2026-08-10T11:00:00Z'),
        }),
      ),
      'contract Final Close',
    );

    const after = await getAnalyticsSnapshot({ datePreset: 'all' }, READ);
    if (!after.ok) throw new Error(after.code);
    expect(after.data.trader.sampleCount).toBe(before.data.trader.sampleCount + 1);
    expect(after.data.legacyCoverage.excludedActualCount).toBe(
      before.data.legacyCoverage.excludedActualCount + 1,
    );
    const counts = (snapshot: typeof after) =>
      snapshot.ok ? snapshot.data.trader.outcomeCounts : null;
    expect(counts(after)).toEqual({
      wins: counts(before)?.wins ?? 0,
      breakEvens: counts(before)?.breakEvens ?? 0,
      losses: (counts(before)?.losses ?? 0) + 1,
    });
    // Total R moved by the Final Close's -1R only, never by the legacy +3R.
    if (before.data.trader.totalR.status !== 'available') throw new Error('no total');
    expect(after.data.trader.totalR).toEqual({
      status: 'available',
      value: new Decimal(before.data.trader.totalR.value).minus(1).toFixed(4),
    });
  });
});
