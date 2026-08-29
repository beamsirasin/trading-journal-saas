import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardFilterState } from '@/lib/dashboard/filters';
import {
  emotionTypes,
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeEmotions,
  tradeExits,
  tradeMistakes,
  tradeRuleChecks,
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

const { getDashboardInsightData } = await import('./dashboard-insights');
const {
  DASHBOARD_INSIGHT_MAJOR_PROJECTION_COUNT,
  DASHBOARD_INSIGHT_MAJOR_PROJECTIONS,
  getDashboardInsightRawData,
} = await import('../dal/dashboard-insights');
const { DASHBOARD_MAJOR_PROJECTION_COUNT } = await import('../dal/analytics');
const { RISK_PERFORMANCE_MAJOR_PROJECTION_COUNT } = await import('../dal/risk-performance');

const db = getTestDb();
const workspaceIds: string[] = [];
const userIds: string[] = [];
const REFERENCE = new Date('2026-09-01T12:00:00.000Z');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'D8A User',
      email: `${userId}@example.test`,
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date('2027-01-01T00:00:00Z') },
  };
}

async function createWorkspaceFixture() {
  const [user] = await db
    .insert(users)
    .values({ name: 'D8A', email: `d8a-${crypto.randomUUID()}@example.test`, emailVerified: true })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('user insert failed');
  userIds.push(user.id);
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: 'D8A', slug: `d8a-${crypto.randomUUID()}`, kind: 'personal' })
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

async function createAccount(workspaceId: string, name: string) {
  const [row] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name,
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
    })
    .returning({ id: tradingAccounts.id });
  if (row === undefined) throw new Error('account insert failed');
  return row.id;
}

async function createFramework(workspaceId: string) {
  const [strategy] = await db
    .insert(strategies)
    .values({ workspaceId })
    .returning({ id: strategies.id });
  if (strategy === undefined) throw new Error('strategy insert failed');
  const [version] = await db
    .insert(strategyVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      versionNumber: 1,
      name: 'D8 Strategy Snapshot',
    })
    .returning({ id: strategyVersions.id });
  if (version === undefined) throw new Error('version insert failed');
  await db
    .update(strategies)
    .set({ currentVersionId: version.id })
    .where(eq(strategies.id, strategy.id));
  const [setup] = await db
    .insert(setups)
    .values({ workspaceId, strategyId: strategy.id })
    .returning({ id: setups.id });
  if (setup === undefined) throw new Error('setup insert failed');
  const [setupVersion] = await db
    .insert(strategySetupVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      strategyVersionId: version.id,
      setupId: setup.id,
      name: 'D8 Setup Snapshot',
    })
    .returning({ id: strategySetupVersions.id });
  if (setupVersion === undefined) throw new Error('setup version insert failed');
  const [rule] = await db
    .insert(strategyRules)
    .values({
      workspaceId,
      strategyVersionId: version.id,
      setupVersionId: setupVersion.id,
      title: 'Wait for confirmation',
      category: 'entry',
      isRequired: true,
    })
    .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
  if (rule === undefined) throw new Error('rule insert failed');
  await db
    .update(strategyVersions)
    .set({ lockedAt: new Date('2026-01-01T00:00:00Z') })
    .where(eq(strategyVersions.id, version.id));
  return {
    strategyId: strategy.id,
    strategyVersionId: version.id,
    setupId: setup.id,
    setupVersionId: setupVersion.id,
    rule,
  };
}

async function populate(params: {
  workspaceId: string;
  accountId: string;
  framework: Awaited<ReturnType<typeof createFramework>>;
}) {
  const [focused, fearful] = await Promise.all([
    db.query.emotionTypes.findFirst({
      columns: { id: true },
      where: and(eq(emotionTypes.key, 'focused'), eq(emotionTypes.isSystem, true)),
    }),
    db.query.emotionTypes.findFirst({
      columns: { id: true },
      where: and(eq(emotionTypes.key, 'fearful'), eq(emotionTypes.isSystem, true)),
    }),
  ]);
  const earlyExit = await db.query.mistakeTypes.findFirst({
    columns: { id: true, severity: true, defaultWeight: true },
    where: and(eq(mistakeTypes.key, 'early_exit'), eq(mistakeTypes.isSystem, true)),
  });
  if (focused === undefined || fearful === undefined || earlyExit === undefined) {
    throw new Error('canonical D8 taxonomies are missing');
  }

  return db.transaction(async (tx) => {
    const tradeIds: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      const positive = index < 10;
      const exitedAt = positive
        ? new Date(Date.UTC(2026, 7, 10 + index, 12))
        : new Date(Date.UTC(2026, 5, index, 12));
      const actualR = positive ? '1.0000' : '-1.0000';
      const netPnlMinor = positive ? 10_000n : -10_000n;
      const [trade] = await tx
        .insert(trades)
        .values({
          workspaceId: params.workspaceId,
          tradingAccountId: params.accountId,
          strategyId: params.framework.strategyId,
          strategyVersionId: params.framework.strategyVersionId,
          setupId: params.framework.setupId,
          setupVersionId: params.framework.setupVersionId,
          symbol: 'XAUUSD',
          direction: 'long',
          confidence: positive ? 100 : 25,
          actualResultMode: 'money',
          actualInitialRiskMinor: 10_000n,
          enteredAt: new Date(exitedAt.getTime() - 60 * 60_000),
          exitedAt,
          netPnlMinor,
          actualR,
          traderOutcome: positive ? 'win' : 'loss',
          status: 'closed',
          plannedRiskMinor: 10_000n,
          systemStatus: 'resolved',
          systemResolutionKind: 'money_custom',
          systemGrossRInput: '1.0000',
          systemExitedAt: new Date(exitedAt.getTime() + 30 * 60_000),
          systemExitReason: 'manual_system_valid_exit',
          systemResolvedAt: new Date(exitedAt.getTime() + 45 * 60_000),
          systemR: '1.0000',
          systemOutcome: 'win',
        })
        .returning({ id: trades.id });
      if (trade === undefined) throw new Error('trade insert failed');
      tradeIds.push(trade.id);
      await tx.insert(tradeRuleChecks).values({
        workspaceId: params.workspaceId,
        tradeId: trade.id,
        strategyRuleId: params.framework.rule.id,
        strategyVersionId: params.framework.strategyVersionId,
        ruleKey: params.framework.rule.ruleKey,
        title: 'Wait for confirmation',
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: true,
        checkStatus: positive ? 'followed' : 'violated',
      });
      await tx.insert(tradeEmotions).values({
        workspaceId: params.workspaceId,
        tradeId: trade.id,
        emotionTypeId: positive ? focused.id : fearful.id,
      });
      if (!positive && index < 15) {
        await tx.insert(tradeMistakes).values({
          workspaceId: params.workspaceId,
          tradeId: trade.id,
          mistakeTypeId: earlyExit.id,
          severityAtTime: earlyExit.severity,
          weightAtTime: earlyExit.defaultWeight,
        });
      }
      if (positive) {
        await tx.insert(tradeExits).values([
          {
            workspaceId: params.workspaceId,
            tradeId: trade.id,
            sequence: 1,
            closedBps: 4_000,
            realizedPnlMinor: 4_000n,
            exitedAt: new Date(exitedAt.getTime() - 10 * 60_000),
          },
          {
            workspaceId: params.workspaceId,
            tradeId: trade.id,
            sequence: 2,
            closedBps: 6_000,
            realizedPnlMinor: 6_000n,
            exitedAt,
          },
        ]);
      } else {
        await tx.insert(tradeExits).values({
          workspaceId: params.workspaceId,
          tradeId: trade.id,
          sequence: 1,
          closedBps: 10_000,
          realizedPnlMinor: -10_000n,
          exitedAt,
        });
      }
    }
    return tradeIds;
  });
}

async function populateUnclassified(params: { workspaceId: string; accountId: string }) {
  const focused = await db.query.emotionTypes.findFirst({
    columns: { id: true },
    where: and(eq(emotionTypes.key, 'focused'), eq(emotionTypes.isSystem, true)),
  });
  if (focused === undefined) throw new Error('focused taxonomy missing');
  await db.transaction(async (tx) => {
    for (let index = 0; index < 5; index += 1) {
      const exitedAt = new Date(Date.UTC(2026, 7, 20 + index, 12));
      const [trade] = await tx
        .insert(trades)
        .values({
          workspaceId: params.workspaceId,
          tradingAccountId: params.accountId,
          symbol: 'EURUSD',
          direction: 'long',
          confidence: 0,
          actualResultMode: 'money',
          actualInitialRiskMinor: 10_000n,
          enteredAt: new Date(exitedAt.getTime() - 60 * 60_000),
          exitedAt,
          netPnlMinor: -5_000n,
          actualR: '-0.5000',
          traderOutcome: 'loss',
          status: 'closed',
        })
        .returning({ id: trades.id });
      if (trade === undefined) throw new Error('unclassified trade insert failed');
      await tx.insert(tradeExits).values({
        workspaceId: params.workspaceId,
        tradeId: trade.id,
        sequence: 1,
        closedBps: 10_000,
        realizedPnlMinor: -5_000n,
        exitedAt,
      });
      await tx.insert(tradeEmotions).values({
        workspaceId: params.workspaceId,
        tradeId: trade.id,
        emotionTypeId: focused.id,
      });
    }
  });
}

function filters(
  accountId: string,
  datePreset: '30d' | '90d' | 'all' = 'all',
): DashboardFilterState {
  return {
    datePreset,
    customDateRange: null,
    accountScope: { kind: 'account', accountId },
    strategyId: null,
    setupId: null,
    strategyVersionId: null,
    unitMode: 'r',
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

describe('D8A PostgreSQL Insight boundary', () => {
  it('preserves five Dashboard reads, one D7 read, and five bulk D8 projections', () => {
    expect(DASHBOARD_MAJOR_PROJECTION_COUNT).toBe(5);
    expect(RISK_PERFORMANCE_MAJOR_PROJECTION_COUNT).toBe(1);
    expect(DASHBOARD_INSIGHT_MAJOR_PROJECTION_COUNT).toBe(5);
    expect(DASHBOARD_INSIGHT_MAJOR_PROJECTIONS).toEqual([
      'actual_trades',
      'system_trades',
      'emotions',
      'rule_checks',
      'mistakes',
    ]);
  });

  it('returns intentional empty pillar states without errors', async () => {
    const fixture = await createWorkspaceFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Empty');
    const result = await getDashboardInsightData(filters(accountId), {
      referenceInstant: REFERENCE,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'available',
        strategy: { status: 'no_eligible_trades' },
        psychology: { status: 'no_eligible_trades' },
        discipline: { status: 'no_eligible_trades' },
      },
    });
  });

  it('composes descriptive pillars and keeps partial exits at one Trade sample', async () => {
    const fixture = await createWorkspaceFixture();
    const accountId = await createAccount(fixture.workspaceId, 'Populated');
    const framework = await createFramework(fixture.workspaceId);
    const ids = await populate({ workspaceId: fixture.workspaceId, accountId, framework });
    const raw = await getDashboardInsightRawData(
      { datePreset: 'all', tradingAccountId: accountId },
      { referenceInstant: REFERENCE },
    );
    expect(raw.ok).toBe(true);
    if (!raw.ok) throw new Error(raw.code);
    expect(raw.data.actualTrades).toHaveLength(20);
    expect(raw.data.systemTrades).toHaveLength(20);
    expect(raw.data.emotions).toHaveLength(20);
    expect(raw.data.ruleChecks).toHaveLength(20);
    expect(raw.data.mistakes).toHaveLength(5);
    const exits = await db.select().from(tradeExits).where(inArray(tradeExits.tradeId, ids));
    expect(exits).toHaveLength(30);

    const result = await getDashboardInsightData(filters(accountId), {
      referenceInstant: REFERENCE,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        status: 'available',
        strategy: {
          primaryInsight: {
            type: 'system_actual_divergence',
            metrics: { averageExecutionGapR: { status: 'available', value: '-1.0000' } },
          },
          coverage: { actualEligibleTradeCount: 20, systemEligibleTradeCount: 20 },
        },
        psychology: {
          primaryInsight: { type: 'confidence_underperformance', observational: true },
          coverage: { emotionTaggedTradeCount: 20, confidenceRecordedTradeCount: 20 },
        },
        discipline: {
          primaryInsight: {
            type: 'adherence_performance_difference',
            differenceR: { status: 'available', value: '2.0000' },
            observational: true,
          },
          supportingMetrics: {
            ruleChecksFollowedRate: { status: 'available', value: '0.5000' },
            tradeRuleAdherenceRate: { status: 'available', value: '0.5000' },
          },
        },
      },
    });
  });

  it('applies Account and date filters to every pillar', async () => {
    const fixture = await createWorkspaceFixture();
    const populatedId = await createAccount(fixture.workspaceId, 'Populated');
    const emptyId = await createAccount(fixture.workspaceId, 'Other');
    const framework = await createFramework(fixture.workspaceId);
    await populate({ workspaceId: fixture.workspaceId, accountId: populatedId, framework });
    await populateUnclassified({ workspaceId: fixture.workspaceId, accountId: populatedId });

    const all = await getDashboardInsightRawData(
      { datePreset: 'all', tradingAccountId: populatedId },
      { referenceInstant: REFERENCE },
    );
    const strategyScoped = await getDashboardInsightRawData(
      {
        datePreset: 'all',
        tradingAccountId: populatedId,
        strategyId: framework.strategyId,
      },
      { referenceInstant: REFERENCE },
    );
    const setupScoped = await getDashboardInsightRawData(
      {
        datePreset: 'all',
        tradingAccountId: populatedId,
        strategyId: framework.strategyId,
        setupId: framework.setupId,
      },
      { referenceInstant: REFERENCE },
    );
    expect(all.ok && all.data.actualTrades).toHaveLength(25);
    expect(all.ok && all.data.emotions).toHaveLength(25);
    expect(all.ok && all.data.ruleChecks).toHaveLength(20);
    expect(strategyScoped.ok && strategyScoped.data.actualTrades).toHaveLength(20);
    expect(strategyScoped.ok && strategyScoped.data.emotions).toHaveLength(20);
    expect(strategyScoped.ok && strategyScoped.data.ruleChecks).toHaveLength(20);
    expect(setupScoped.ok && setupScoped.data.actualTrades).toHaveLength(20);
    expect(setupScoped.ok && setupScoped.data.emotions).toHaveLength(20);
    expect(setupScoped.ok && setupScoped.data.ruleChecks).toHaveLength(20);

    const bounded = await getDashboardInsightRawData(
      { datePreset: '30d', tradingAccountId: populatedId },
      { referenceInstant: REFERENCE },
    );
    expect(bounded.ok && bounded.data.actualTrades).toHaveLength(15);
    expect(bounded.ok && bounded.data.systemTrades).toHaveLength(10);
    expect(bounded.ok && bounded.data.emotions).toHaveLength(15);
    expect(bounded.ok && bounded.data.ruleChecks).toHaveLength(10);

    const other = await getDashboardInsightData(filters(emptyId), {
      referenceInstant: REFERENCE,
    });
    expect(other).toMatchObject({
      ok: true,
      data: {
        strategy: { status: 'no_eligible_trades' },
        psychology: { status: 'no_eligible_trades' },
        discipline: { status: 'no_eligible_trades' },
      },
    });
  });
});
