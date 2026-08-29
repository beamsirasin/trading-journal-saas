import Decimal from 'decimal.js';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';
import {
  setups,
  strategies,
  tradeExits,
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({ api: { getSession: async () => currentSession } }),
}));

const { getRiskPerformanceData } = await import('./risk-performance');
const {
  RISK_PERFORMANCE_MAJOR_PROJECTION_COUNT,
  RISK_PERFORMANCE_MAJOR_PROJECTIONS,
  getRiskPerformanceRawData,
} = await import('../dal/risk-performance');
const { DASHBOARD_MAJOR_PROJECTION_COUNT, DASHBOARD_MAJOR_PROJECTIONS } =
  await import('../dal/analytics');

const db = getTestDb();
const workspaceIds: string[] = [];
const userIds: string[] = [];
const REFERENCE = new Date('2026-09-01T12:00:00.000Z');
const READ_OPTIONS = { referenceInstant: REFERENCE } as const;

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Risk Performance User',
      email: `${userId}@example.test`,
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date('2027-01-01T00:00:00Z') },
  };
}

async function createFixture() {
  const [user] = await db
    .insert(users)
    .values({
      name: 'D7A Integration',
      email: `d7a-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user insert failed');
  userIds.push(user.id);

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'D7A', slug: `d7a-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace insert failed');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId: user.id,
    role: 'owner',
  });
  await db.insert(userPreferences).values({
    userId: user.id,
    activeWorkspaceId: workspace.id,
    timezone: 'UTC',
  });
  currentSession = sessionFor(user.id);
  return { userId: user.id, workspaceId: workspace.id };
}

async function createAccount(
  workspaceId: string,
  name: string,
  startingBalance = '10000.0000000000',
  baseCurrency = 'USD',
) {
  const [account] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name,
      accountMode: 'demo',
      baseCurrency,
      startingBalance,
      timezone: 'UTC',
    })
    .returning({ id: tradingAccounts.id });
  if (account === undefined) throw new Error('account insert failed');
  return account.id;
}

async function activate(userId: string, accountId: string) {
  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: accountId })
    .where(eq(userPreferences.userId, userId));
}

async function createMoneyTrade(params: {
  workspaceId: string;
  accountId: string;
  exitedAt: Date;
  netPnlMinor: bigint;
  exitLegs?: readonly { readonly closedBps: number; readonly realizedPnlMinor: bigint }[];
  deleted?: boolean;
}) {
  const enteredAt = new Date(params.exitedAt.getTime() - 60 * 60_000);
  const risk = 10_000n;
  const actualR = new Decimal(params.netPnlMinor.toString()).div(risk.toString()).toFixed(4);
  const outcome = params.netPnlMinor > 0n ? 'win' : params.netPnlMinor < 0n ? 'loss' : 'break_even';
  const legs = params.exitLegs ?? [{ closedBps: 10_000, realizedPnlMinor: params.netPnlMinor }];

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({
        workspaceId: params.workspaceId,
        tradingAccountId: params.accountId,
        symbol: 'XAUUSD',
        direction: 'long',
        actualResultMode: 'money',
        actualInitialRiskMinor: risk,
        enteredAt,
        exitedAt: params.exitedAt,
        netPnlMinor: params.netPnlMinor,
        actualR,
        traderOutcome: outcome,
        status: 'closed',
        deletedAt: params.deleted ? new Date('2026-08-31T00:00:00Z') : null,
      })
      .returning({ id: trades.id });
    if (row === undefined) throw new Error('trade insert failed');
    for (const [index, leg] of legs.entries()) {
      await tx.insert(tradeExits).values({
        workspaceId: params.workspaceId,
        tradeId: row.id,
        mutationKey: crypto.randomUUID(),
        sequence: index + 1,
        closedBps: leg.closedBps,
        realizedPnlMinor: leg.realizedPnlMinor,
        exitedAt:
          index === legs.length - 1
            ? params.exitedAt
            : new Date(params.exitedAt.getTime() - (legs.length - index - 1) * 60_000),
      });
    }
    return row.id;
  });
}

async function createPriceModeTrade(params: {
  workspaceId: string;
  accountId: string;
  exitedAt: Date;
}) {
  const enteredAt = new Date(params.exitedAt.getTime() - 60 * 60_000);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({
        workspaceId: params.workspaceId,
        tradingAccountId: params.accountId,
        symbol: 'EURUSD',
        direction: 'long',
        actualResultMode: 'price',
        actualEntry: '100.0000000000',
        actualInitialStop: '99.0000000000',
        actualExit: '101.0000000000',
        actualPositionSize: '1.0000000000',
        enteredAt,
        exitedAt: params.exitedAt,
        actualR: '1.0000',
        traderOutcome: 'win',
        status: 'closed',
      })
      .returning({ id: trades.id });
    if (row === undefined) throw new Error('price Trade insert failed');
    await tx.insert(tradeExits).values({
      workspaceId: params.workspaceId,
      tradeId: row.id,
      mutationKey: crypto.randomUUID(),
      sequence: 1,
      closedBps: 10_000,
      exitPrice: '101.0000000000',
      exitedAt: params.exitedAt,
    });
    return row.id;
  });
}

function filters(
  accountId: string | 'all' | undefined,
  datePreset: '30d' | '90d' | 'all' | 'custom' = 'all',
  analytical: { readonly strategyId?: string; readonly setupId?: string } = {},
  customDateRange: { readonly from: string; readonly to: string } | null = null,
): DashboardFilterState {
  return {
    datePreset,
    customDateRange,
    accountScope:
      accountId === undefined
        ? { kind: 'active' }
        : accountId === 'all'
          ? { kind: 'all' }
          : { kind: 'account', accountId },
    strategyId: analytical.strategyId ?? null,
    setupId: analytical.setupId ?? null,
    strategyVersionId: null,
    unitMode: 'money',
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

function requireAvailable(result: Awaited<ReturnType<typeof getRiskPerformanceData>>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(result.data.status).toBe('available');
  if (result.data.status !== 'available') throw new Error(result.data.reason);
  return result.data;
}

afterEach(async () => {
  currentSession = null;
  if (workspaceIds.length > 0) {
    await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds.splice(0)));
  }
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds.splice(0)));
});

afterAll(async () => {
  await Promise.all([closeTestDb(), closeDb()]);
});

describe('Risk Performance PostgreSQL boundary', () => {
  it('keeps Dashboard core at five reads and adds one narrow risk projection', () => {
    expect(DASHBOARD_MAJOR_PROJECTION_COUNT).toBe(5);
    expect(DASHBOARD_MAJOR_PROJECTIONS).toEqual([
      'trader',
      'system',
      'paired',
      'attention',
      'recent_trades',
    ]);
    expect(RISK_PERFORMANCE_MAJOR_PROJECTION_COUNT).toBe(1);
    expect(RISK_PERFORMANCE_MAJOR_PROJECTIONS).toEqual(['closed_actual_money_history']);
  });

  it('uses Actual exited_at for All/90D/30D and carries older history into each opening', async () => {
    const fixture = await createFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Account A');
    await activate(fixture.userId, accountId);
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-05-01T00:00:00Z'),
      netPnlMinor: 150_000n,
    });
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-06-15T00:00:00Z'),
      netPnlMinor: -20_000n,
    });
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-08-15T00:00:00Z'),
      netPnlMinor: 30_000n,
    });
    // Deleted history is outside D1's eligible population and must not affect balance.
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-08-20T00:00:00Z'),
      netPnlMinor: 999_999n,
      deleted: true,
    });

    const all = requireAvailable(
      await getRiskPerformanceData(filters(undefined, 'all'), READ_OPTIONS),
    );
    const ninety = requireAvailable(
      await getRiskPerformanceData(filters(accountId, '90d'), READ_OPTIONS),
    );
    const thirty = requireAvailable(
      await getRiskPerformanceData(filters(accountId, '30d'), READ_OPTIONS),
    );
    const custom = requireAvailable(
      await getRiskPerformanceData(
        filters(accountId, 'custom', {}, { from: '2026-08-15', to: '2026-08-15' }),
        READ_OPTIONS,
      ),
    );
    expect(all).toMatchObject({
      openingBalanceMinor: '1000000',
      endingBalanceMinor: '1160000',
      periodNetPnlMinor: '160000',
      closedTradeCount: 3,
    });
    expect(ninety).toMatchObject({
      openingBalanceMinor: '1150000',
      endingBalanceMinor: '1160000',
      periodNetPnlMinor: '10000',
      closedTradeCount: 2,
    });
    expect(thirty).toMatchObject({
      openingBalanceMinor: '1130000',
      endingBalanceMinor: '1160000',
      periodNetPnlMinor: '30000',
      closedTradeCount: 1,
    });
    expect(custom).toMatchObject({
      openingBalanceMinor: '1130000',
      endingBalanceMinor: '1160000',
      periodNetPnlMinor: '30000',
      closedTradeCount: 1,
    });
    expect(thirty.completeness.checkedClosedTradeCount).toBe(3);
    expect(custom.completeness.checkedClosedTradeCount).toBe(3);
  });

  it('keeps Account A/B distinct, returns valid no-activity data, and fails All Accounts closed', async () => {
    const fixture = await createFixture();
    const accountA = await createAccount(fixture.workspaceId, 'Account A');
    const accountB = await createAccount(fixture.workspaceId, 'Account B', '5000.0000000000');
    const empty = await createAccount(fixture.workspaceId, 'Empty');
    await activate(fixture.userId, accountA);
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId: accountA,
      exitedAt: new Date('2026-08-01T00:00:00Z'),
      netPnlMinor: 10_000n,
    });
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId: accountB,
      exitedAt: new Date('2026-08-01T00:00:00Z'),
      netPnlMinor: -5_000n,
    });

    expect(
      requireAvailable(await getRiskPerformanceData(filters(accountA), READ_OPTIONS))
        .endingBalanceMinor,
    ).toBe('1010000');
    expect(
      requireAvailable(await getRiskPerformanceData(filters(accountB), READ_OPTIONS))
        .endingBalanceMinor,
    ).toBe('495000');
    const noActivity = requireAvailable(await getRiskPerformanceData(filters(empty), READ_OPTIONS));
    expect(noActivity).toMatchObject({
      endingBalanceMinor: '1000000',
      closedTradeCount: 0,
      currentDrawdown: { amountMinor: '0' },
      maxDrawdown: { amountMinor: '0' },
    });

    const all = await getRiskPerformanceData(filters('all'), READ_OPTIONS);
    expect(all).toMatchObject({
      ok: true,
      data: { status: 'unavailable', reason: 'select_single_account' },
    });
    const raw = await getRiskPerformanceRawData({ tradingAccountId: 'all' }, READ_OPTIONS);
    expect(raw).toMatchObject({ ok: true, data: { trades: [] } });
  });

  it('rejects incomplete pre-range money even when visible 30D money is complete', async () => {
    const fixture = await createFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Incomplete');
    await activate(fixture.userId, accountId);
    await createPriceModeTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-08-15T00:00:00Z'),
      netPnlMinor: 10_000n,
    });

    await expect(
      getRiskPerformanceData(filters(accountId, '30d'), READ_OPTIONS),
    ).resolves.toMatchObject({
      ok: true,
      data: { status: 'unavailable', reason: 'incomplete_money_history' },
    });
  });

  it('validates Strategy/Setup identities but never applies them to balance values', async () => {
    const fixture = await createFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Filtered');
    await activate(fixture.userId, accountId);
    const [strategy] = await db
      .insert(strategies)
      .values({ workspaceId: fixture.workspaceId })
      .returning({ id: strategies.id });
    if (strategy === undefined) throw new Error('strategy insert failed');
    const [setup] = await db
      .insert(setups)
      .values({ workspaceId: fixture.workspaceId, strategyId: strategy.id })
      .returning({ id: setups.id });
    if (setup === undefined) throw new Error('setup insert failed');
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: new Date('2026-08-15T00:00:00Z'),
      netPnlMinor: 25_000n,
    });

    const unfiltered = requireAvailable(
      await getRiskPerformanceData(filters(accountId, '30d'), READ_OPTIONS),
    );
    const filtered = requireAvailable(
      await getRiskPerformanceData(
        filters(accountId, '30d', { strategyId: strategy.id, setupId: setup.id }),
        READ_OPTIONS,
      ),
    );
    expect({
      opening: filtered.openingBalanceMinor,
      ending: filtered.endingBalanceMinor,
      period: filtered.periodNetPnlMinor,
      series: filtered.series,
    }).toEqual({
      opening: unfiltered.openingBalanceMinor,
      ending: unfiltered.endingBalanceMinor,
      period: unfiltered.periodNetPnlMinor,
      series: unfiltered.series,
    });
  });

  it('reads parent Trade money once for partial closes and groups equal timestamps without Exit-leg N+1', async () => {
    const fixture = await createFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Partial');
    await activate(fixture.userId, accountId);
    const occurredAt = new Date('2026-08-15T12:00:00.123Z');
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: occurredAt,
      netPnlMinor: 23_100n,
      exitLegs: [
        { closedBps: 4_000, realizedPnlMinor: 10_000n },
        { closedBps: 6_000, realizedPnlMinor: 13_100n },
      ],
    });
    await createMoneyTrade({
      workspaceId: fixture.workspaceId,
      accountId,
      exitedAt: occurredAt,
      netPnlMinor: -3_100n,
    });

    const raw = await getRiskPerformanceRawData({ tradingAccountId: accountId }, READ_OPTIONS);
    expect(raw.ok).toBe(true);
    if (!raw.ok) throw new Error(raw.code);
    expect(raw.data.trades).toHaveLength(2);
    expect(raw.data.trades.every((row) => !Object.hasOwn(row, 'exits'))).toBe(true);

    const result = requireAvailable(await getRiskPerformanceData(filters(accountId), READ_OPTIONS));
    expect(result).toMatchObject({
      endingBalanceMinor: '1020000',
      periodNetPnlMinor: '20000',
      closedTradeCount: 2,
      completeness: { checkedClosedTradeCount: 2 },
    });
    const closePoints = result.series.filter((point) => point.kind === 'trade_close');
    expect(closePoints).toHaveLength(1);
    expect(closePoints[0]?.tradeIds).toHaveLength(2);
  });

  it('returns unsupported currency scale explicitly from a real Account row', async () => {
    const fixture = await createFixture();
    const accountId = await createAccount(
      fixture.workspaceId,
      'Unsupported',
      '2.5000000000',
      'BTC',
    );
    await activate(fixture.userId, accountId);
    await expect(getRiskPerformanceData(filters(accountId), READ_OPTIONS)).resolves.toMatchObject({
      ok: true,
      data: { status: 'unavailable', reason: 'unsupported_currency_scale' },
    });
  });
});
