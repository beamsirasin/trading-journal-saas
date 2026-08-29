import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { reconcileDayReview } from '@/lib/dashboard/day-review';
import { parseDashboardFilterState } from '@/lib/dashboard/filters';
import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  emotionTypes,
  mistakeTypes,
  setupConditions,
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
  tradeSetupConditionChecks,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';
import { createCompletedTrade } from './trade-completed';

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

const { getAnalyticsPageData, getAnalyticsSnapshot, getDashboardOverview } =
  await import('./analytics');
const { getDashboardPageData } = await import('./dashboard');
const { getDashboardCalendarMonthInZone, getDashboardDayReview } =
  await import('./dashboard-calendar');
const { getAnalyticsRawPopulations } = await import('../dal/analytics');

const db = getTestDb();
const workspaceIds: string[] = [];
const userIds: string[] = [];
const REFERENCE = new Date('2026-08-09T12:00:00.000Z');
const READ_OPTIONS = { referenceInstant: REFERENCE } as const;

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Analytics Service User',
      email: `${userId}@example.test`,
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date('2027-01-01T00:00:00Z') },
  };
}

async function createUser(label: string): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (row === undefined) throw new Error('user insert failed');
  userIds.push(row.id);
  return row.id;
}

async function createWorkspace(userId: string, label: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: label, slug: `${label}-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace insert failed');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: 'owner' });
  await db.insert(userPreferences).values({
    userId,
    activeWorkspaceId: workspace.id,
    timezone: 'UTC',
  });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date('2026-08-01T00:00:00Z'),
    currentPeriodEndsAt: new Date('2026-09-01T00:00:00Z'),
  });
  return workspace.id;
}

async function createAccount(
  workspaceId: string,
  name: string,
  isArchived = false,
  baseCurrency = 'USD',
): Promise<string> {
  const [row] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name,
      accountMode: 'demo',
      baseCurrency,
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
      isArchived,
    })
    .returning({ id: tradingAccounts.id });
  if (row === undefined) throw new Error('account insert failed');
  return row.id;
}

interface Framework {
  strategyId: string;
  strategyVersionId: string;
  setupId: string;
  setupVersionId: string;
}

async function createFramework(workspaceId: string, name: string): Promise<Framework> {
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
      name,
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
      name: `${name} Setup`,
    })
    .returning({ id: strategySetupVersions.id });
  if (setupVersion === undefined) throw new Error('setup version insert failed');
  return {
    strategyId: strategy.id,
    strategyVersionId: version.id,
    setupId: setup.id,
    setupVersionId: setupVersion.id,
  };
}

interface TradeInput {
  accountId: string;
  /** `null` — Phase 14B — creates an unclassified Trade (no Strategy/Setup). */
  framework: Framework | null;
  status?: 'planned' | 'open' | 'closed' | 'canceled';
  actualR?: string;
  traderOutcome?: 'win' | 'loss' | 'break_even';
  exitedAt?: Date;
  createdAt?: Date;
  systemStatus?: 'pending' | 'resolved' | 'no_trade';
  systemR?: string;
  systemOutcome?: 'win' | 'loss' | 'break_even';
  systemExitedAt?: Date;
  deleted?: boolean;
}

async function createTrade(workspaceId: string, input: TradeInput): Promise<string> {
  const status = input.status ?? 'closed';
  const systemStatus = input.systemStatus ?? 'resolved';
  const exitedAt = input.exitedAt ?? new Date('2026-08-01T10:00:00Z');
  const systemExitedAt = input.systemExitedAt ?? new Date('2026-08-01T11:00:00Z');
  const actualFields =
    status === 'closed'
      ? {
          actualResultMode: 'money' as const,
          actualEntry: '100.0000000000',
          actualInitialStop: '99.0000000000',
          actualInitialRiskMinor: 100n,
          enteredAt: new Date(exitedAt.getTime() - 60 * 60 * 1000),
          actualExit: '101.0000000000',
          netPnlMinor: (input.actualR ?? '1.0000').startsWith('-') ? -100n : 100n,
          exitedAt,
          actualR: input.actualR ?? '1.0000',
          traderOutcome: input.traderOutcome ?? 'win',
        }
      : status === 'open'
        ? {
            actualResultMode: 'money' as const,
            actualEntry: '100.0000000000',
            actualInitialStop: '99.0000000000',
            actualInitialRiskMinor: 100n,
            enteredAt: new Date('2026-08-01T09:00:00Z'),
          }
        : {};
  const systemFields =
    systemStatus === 'resolved'
      ? {
          systemStatus,
          systemResolutionKind: 'price_exit',
          systemExitPrice: '102.0000000000',
          systemExitedAt,
          systemExitReason: 'target_hit' as const,
          systemResolvedAt: new Date('2026-08-02T00:00:00Z'),
          systemR: input.systemR ?? '2.0000',
          systemOutcome: input.systemOutcome ?? 'win',
        }
      : systemStatus === 'no_trade'
        ? {
            systemStatus,
            systemExitReason: 'setup_invalidated' as const,
            systemResolvedAt: new Date('2026-08-02T00:00:00Z'),
          }
        : {};

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({
        workspaceId,
        tradingAccountId: input.accountId,
        strategyId: input.framework?.strategyId ?? null,
        strategyVersionId: input.framework?.strategyVersionId ?? null,
        setupId: input.framework?.setupId ?? null,
        setupVersionId: input.framework?.setupVersionId ?? null,
        // Phase 14B pairing CHECKs require these non-null exactly when the
        // corresponding identity reference is non-null.
        strategyAssignedAt: input.framework === null ? null : new Date('2026-08-01T00:00:00Z'),
        setupAssignedAt: input.framework === null ? null : new Date('2026-08-01T00:00:00Z'),
        symbol: 'EURUSD',
        direction: 'long',
        plannedEntry: '100.0000000000',
        plannedStop: '99.0000000000',
        plannedTarget: '102.0000000000',
        plannedR: '2.0000',
        status,
        createdAt: input.createdAt ?? new Date(exitedAt.getTime() - 2 * 60 * 60 * 1000),
        deletedAt: input.deleted ? new Date('2026-08-05T00:00:00Z') : null,
        ...actualFields,
        ...systemFields,
      })
      .returning({ id: trades.id });
    if (row === undefined) throw new Error('trade insert failed');
    if (status === 'closed') {
      await tx.insert(tradeExits).values({
        workspaceId,
        tradeId: row.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 10_000,
        exitPrice: actualFields.actualExit,
        realizedPnlMinor: actualFields.netPnlMinor,
        exitedAt,
      });
    }
    return row.id;
  });
}

interface Fixture {
  userId: string;
  workspaceId: string;
  activeAccountId: string;
  archivedAccountId: string;
  emptyAccountId: string;
  primary: Framework;
  secondary: Framework;
  divergentTradeId: string;
  splitTimestampTradeId: string;
  deletedTradeId: string;
}

const DISCIPLINE_STATUSES = [
  ...Array.from({ length: 8 }, () => 'followed' as const),
  ...Array.from({ length: 2 }, () => 'violated' as const),
  'not_applicable' as const,
  'not_checked' as const,
];

async function createDisciplineRules(workspaceId: string, framework: Framework) {
  return db
    .insert(strategyRules)
    .values(
      DISCIPLINE_STATUSES.map((_, sortOrder) => ({
        workspaceId,
        strategyVersionId: framework.strategyVersionId,
        ruleKey: crypto.randomUUID(),
        category: 'entry',
        title: `Rule ${sortOrder}`,
        isRequired: true,
        isPreTradeCheck: true,
        sortOrder,
      })),
    )
    .returning({
      id: strategyRules.id,
      ruleKey: strategyRules.ruleKey,
      sortOrder: strategyRules.sortOrder,
    });
}

async function addDisciplineRows(
  workspaceId: string,
  framework: Framework,
  firstTradeId: string,
  secondTradeId: string,
  options: {
    readonly rules?: Awaited<ReturnType<typeof createDisciplineRules>>;
    readonly firstTradeHasSnapshots?: boolean;
  } = {},
): Promise<void> {
  const rules = options.rules ?? (await createDisciplineRules(workspaceId, framework));
  if (options.firstTradeHasSnapshots === true) {
    await Promise.all(
      rules.map((rule, index) =>
        db
          .update(tradeRuleChecks)
          .set({ checkStatus: DISCIPLINE_STATUSES[index] })
          .where(
            and(
              eq(tradeRuleChecks.tradeId, firstTradeId),
              eq(tradeRuleChecks.strategyRuleId, rule.id),
            ),
          ),
      ),
    );
  } else {
    await db.insert(tradeRuleChecks).values(
      rules.map((rule, index) => ({
        workspaceId,
        tradeId: firstTradeId,
        strategyRuleId: rule.id,
        strategyVersionId: framework.strategyVersionId,
        ruleKey: rule.ruleKey,
        checkStatus: DISCIPLINE_STATUSES[index] as (typeof DISCIPLINE_STATUSES)[number],
        title: `Rule snapshot ${index}`,
        category: 'entry',
        isRequired: true,
        isPreTradeCheck: true,
        sortOrder: rule.sortOrder,
      })),
    );
  }

  const canonical = await db.query.mistakeTypes.findMany({
    where: eq(mistakeTypes.isSystem, true),
    orderBy: [mistakeTypes.sortOrder],
    limit: 2,
  });
  if (canonical.length < 2 || canonical[0] === undefined || canonical[1] === undefined) {
    throw new Error('canonical mistake seeds missing');
  }
  await db.insert(tradeMistakes).values([
    {
      workspaceId,
      tradeId: firstTradeId,
      mistakeTypeId: canonical[0].id,
      severityAtTime: canonical[0].severity,
      weightAtTime: canonical[0].defaultWeight,
    },
    {
      workspaceId,
      tradeId: secondTradeId,
      mistakeTypeId: canonical[0].id,
      severityAtTime: canonical[0].severity,
      weightAtTime: canonical[0].defaultWeight,
    },
    {
      workspaceId,
      tradeId: firstTradeId,
      mistakeTypeId: canonical[1].id,
      severityAtTime: canonical[1].severity,
      weightAtTime: canonical[1].defaultWeight,
    },
  ]);
}

async function createFixture(): Promise<Fixture> {
  const userId = await createUser('analytics-service');
  const workspaceId = await createWorkspace(userId, 'analytics-service');
  const activeAccountId = await createAccount(workspaceId, 'Active Account');
  const archivedAccountId = await createAccount(workspaceId, 'Archived Account', true, 'THB');
  const emptyAccountId = await createAccount(workspaceId, 'Empty Account');
  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: activeAccountId })
    .where(eq(userPreferences.userId, userId));
  const primary = await createFramework(workspaceId, 'Primary');
  const secondary = await createFramework(workspaceId, 'Secondary');

  const same = [
    { actualR: '1.0000', traderOutcome: 'win', systemR: '1.0000', systemOutcome: 'win' },
    { actualR: '-1.0000', traderOutcome: 'loss', systemR: '3.0000', systemOutcome: 'win' },
    { actualR: '2.0000', traderOutcome: 'win', systemR: '-1.0000', systemOutcome: 'loss' },
    { actualR: '-2.0000', traderOutcome: 'loss', systemR: '-2.0000', systemOutcome: 'loss' },
  ] as const;
  const pairedIds: string[] = [];
  for (const [index, values] of same.entries()) {
    pairedIds.push(
      await createTrade(workspaceId, {
        accountId: activeAccountId,
        framework: primary,
        ...values,
        exitedAt: new Date(`2026-08-0${index + 1}T10:00:00Z`),
        systemExitedAt: new Date(`2026-08-0${index + 1}T11:00:00Z`),
      }),
    );
  }
  const divergentTradeId = pairedIds[1] as string;

  await createTrade(workspaceId, {
    accountId: activeAccountId,
    framework: primary,
    systemStatus: 'pending',
    actualR: '2.0000',
    traderOutcome: 'win',
    exitedAt: new Date('2026-08-05T10:00:00Z'),
  });
  await createTrade(workspaceId, {
    accountId: activeAccountId,
    framework: primary,
    status: 'open',
    systemR: '-1.0000',
    systemOutcome: 'loss',
    systemExitedAt: new Date('2026-08-06T11:00:00Z'),
  });
  const splitTimestampTradeId = await createTrade(workspaceId, {
    accountId: activeAccountId,
    framework: primary,
    actualR: '4.0000',
    traderOutcome: 'win',
    systemR: '4.0000',
    systemOutcome: 'win',
    exitedAt: new Date('2026-08-07T10:00:00Z'),
    systemExitedAt: new Date('2026-04-01T11:00:00Z'),
  });
  const deletedTradeId = await createTrade(workspaceId, {
    accountId: activeAccountId,
    framework: primary,
    actualR: '99.0000',
    systemR: '99.0000',
    deleted: true,
  });
  await createTrade(workspaceId, {
    accountId: activeAccountId,
    framework: secondary,
    actualR: '1.0000',
    traderOutcome: 'win',
    systemR: '1.0000',
    systemOutcome: 'win',
    exitedAt: new Date('2026-08-08T10:00:00Z'),
    systemExitedAt: new Date('2026-08-08T11:00:00Z'),
  });
  await createTrade(workspaceId, {
    accountId: archivedAccountId,
    framework: primary,
    actualR: '5.0000',
    traderOutcome: 'win',
    systemR: '5.0000',
    systemOutcome: 'win',
    exitedAt: new Date('2026-08-08T12:00:00Z'),
    systemExitedAt: new Date('2026-08-08T13:00:00Z'),
  });

  await addDisciplineRows(workspaceId, primary, pairedIds[0] as string, pairedIds[1] as string);
  currentSession = sessionFor(userId);
  return {
    userId,
    workspaceId,
    activeAccountId,
    archivedAccountId,
    emptyAccountId,
    primary,
    secondary,
    divergentTradeId,
    splitTimestampTradeId,
    deletedTradeId,
  };
}

afterEach(() => {
  currentSession = null;
});

afterAll(async () => {
  for (const id of workspaceIds.splice(0)) await db.delete(workspaces).where(eq(workspaces.id, id));
  for (const id of userIds.splice(0)) await db.delete(users).where(eq(users.id, id));
  await closeDb();
  await closeTestDb();
});

describe('analytics service (real PostgreSQL)', () => {
  it('composes the default active-account/90D snapshot with independent axes and closed discipline populations', async () => {
    const fixture = await createFixture();
    const result = await getAnalyticsSnapshot({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);

    expect(result.data.scope).toMatchObject({
      datePreset: '90d',
      timezone: 'UTC',
      accountScope: { kind: 'account', accountId: fixture.activeAccountId, source: 'active' },
    });
    expect(result.data.trader.sampleCount).toBe(7);
    expect(result.data.system.sampleCount).toBe(6);
    expect(result.data.traderNetPnl).toEqual({
      status: 'available',
      currency: 'USD',
      totalMinor: '300',
    });
    expect(result.data.comparison.comparableCount).toBe(6);
    expect(result.data.trader.winRate).toEqual({ status: 'available', value: '0.7143' });
    expect(result.data.system.winRate).toEqual({ status: 'available', value: '0.5000' });
    expect(result.data.comparison).toMatchObject({
      pairedSystemTotalR: { status: 'available', value: '6.0000' },
      pairedActualTotalR: { status: 'available', value: '5.0000' },
      executionGapR: { status: 'available', value: '-1.0000' },
      averageExecutionGapR: { status: 'available', value: '-0.1667' },
      systemEdgeCaptured: { status: 'available', value: '0.8333' },
    });
    expect(result.data.rules).toEqual({
      followedCount: 8,
      violatedCount: 2,
      notCheckedCount: 1,
      notApplicableCount: 1,
      evaluatedCount: 10,
      checksFollowedRate: { status: 'available', value: '0.8000' },
      tradeAdherenceRate: { status: 'unavailable', reason: 'no_evaluated_trades' },
      evaluatedTradeCount: 0,
      compliantTradeCount: 0,
      nonCompliantTradeCount: 0,
      incompleteTradeCount: 1,
      notApplicableTradeCount: 0,
    });
    expect(result.data.mistakes.map((mistake) => mistake.tradeCount)).toEqual([2, 1]);
    expect(JSON.stringify(result.data)).not.toContain(fixture.deletedTradeId);
    expect(() => JSON.parse(JSON.stringify(result.data)) as unknown).not.toThrow();
  });

  it('supports All Accounts, archived Account, and every framework identity filter', async () => {
    const fixture = await createFixture();
    const all = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: 'all' },
      READ_OPTIONS,
    );
    if (!all.ok) throw new Error(all.code);
    expect(all.data.trader.sampleCount).toBe(8);
    expect(all.data.system.sampleCount).toBe(8);
    expect(all.data.comparison.comparableCount).toBe(7);
    expect(all.data.traderNetPnl).toEqual({ status: 'unavailable', reason: 'mixed_currency' });

    const archived = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: fixture.archivedAccountId },
      READ_OPTIONS,
    );
    if (!archived.ok) throw new Error(archived.code);
    expect(archived.data.traderNetPnl).toEqual({
      status: 'available',
      currency: 'THB',
      totalMinor: '100',
    });
    expect(archived.data.scope.accountScope).toEqual({
      kind: 'account',
      accountId: fixture.archivedAccountId,
      source: 'explicit',
    });
    expect(archived.data.trader.sampleCount).toBe(1);

    const filterCases = [
      { strategyId: fixture.primary.strategyId },
      { setupId: fixture.primary.setupId },
      { strategyVersionId: fixture.primary.strategyVersionId },
      {
        strategyId: fixture.primary.strategyId,
        setupId: fixture.primary.setupId,
        strategyVersionId: fixture.primary.strategyVersionId,
      },
    ];
    for (const filters of filterCases) {
      const filtered = await getAnalyticsSnapshot(filters, READ_OPTIONS);
      if (!filtered.ok) throw new Error(filtered.code);
      expect(filtered.data.trader.sampleCount).toBe(6);
      expect(filtered.data.system.sampleCount).toBe(5);
      expect(filtered.data.comparison.comparableCount).toBe(5);
    }
  });

  it('keeps no active account separate from an active explicit account with no Trades', async () => {
    const fixture = await createFixture();
    const empty = await getAnalyticsSnapshot(
      { tradingAccountId: fixture.emptyAccountId },
      READ_OPTIONS,
    );
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.data.trader.sampleCount).toBe(0);
      expect(empty.data.trader.totalR).toEqual({ status: 'unavailable', reason: 'no_trades' });
    }

    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(eq(tradingAccounts.id, fixture.activeAccountId));
    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(eq(tradingAccounts.id, fixture.emptyAccountId));
    expect(await getAnalyticsSnapshot({}, READ_OPTIONS)).toEqual({
      ok: false,
      code: 'no_active_trading_account',
    });
    expect(await getDashboardOverview(undefined, READ_OPTIONS)).toEqual({
      ok: false,
      code: 'no_active_trading_account',
    });
  });

  it('rejects invalid and foreign filters without broadening the snapshot', async () => {
    const fixture = await createFixture();
    expect(
      await getAnalyticsSnapshot(
        {
          strategyId: fixture.primary.strategyId,
          setupId: fixture.secondary.setupId,
        },
        READ_OPTIONS,
      ),
    ).toEqual({ ok: false, code: 'invalid_filters' });

    const foreignUser = await createUser('analytics-service-foreign');
    const foreignWorkspace = await createWorkspace(foreignUser, 'analytics-service-foreign');
    const foreignAccount = await createAccount(foreignWorkspace, 'Foreign');
    currentSession = sessionFor(fixture.userId);
    expect(await getAnalyticsSnapshot({ tradingAccountId: foreignAccount }, READ_OPTIONS)).toEqual({
      ok: false,
      code: 'invalid_filters',
    });
  });

  it('keeps reads available in writable, over-limit, and read-only entitlement states', async () => {
    const fixture = await createFixture();
    const writable = await getAnalyticsSnapshot({}, READ_OPTIONS);
    expect(writable.ok).toBe(true);
    expect((await getAnalyticsPageData({}, READ_OPTIONS)).ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'active', planKey: 'starter' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const overLimit = await getAnalyticsSnapshot({}, READ_OPTIONS);
    expect(overLimit.ok).toBe(true);
    expect((await getAnalyticsPageData({}, READ_OPTIONS)).ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'expired' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const readOnly = await getAnalyticsSnapshot({}, READ_OPTIONS);
    expect(readOnly.ok).toBe(true);
    expect((await getAnalyticsPageData({}, READ_OPTIONS)).ok).toBe(true);
  });

  it('does not expose former workspace analytics after membership removal', async () => {
    const fixture = await createFixture();
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.userId),
        ),
      );
    const result = await getAnalyticsSnapshot({ tradingAccountId: 'all' }, READ_OPTIONS);
    if (result.ok) {
      expect(result.data.trader.sampleCount).toBe(0);
      expect(result.data.system.sampleCount).toBe(0);
    } else {
      expect(result.code).toBe('no_active_trading_account');
    }
  });

  it('returns a JSON-safe deep Analytics page model with historical selectors and canonical populations', async () => {
    const fixture = await createFixture();
    const result = await getAnalyticsPageData(
      {
        datePreset: 'all',
        tradingAccountId: 'all',
        strategyId: fixture.primary.strategyId,
        setupId: fixture.primary.setupId,
        strategyVersionId: fixture.primary.strategyVersionId,
      },
      READ_OPTIONS,
    );
    if (!result.ok) throw new Error(result.code);

    expect(result.data.snapshot.scope).toMatchObject({
      datePreset: 'all',
      accountScope: { kind: 'all' },
      strategyId: fixture.primary.strategyId,
      setupId: fixture.primary.setupId,
      strategyVersionId: fixture.primary.strategyVersionId,
    });
    expect(result.data.snapshot.trader.sampleCount).toBe(7);
    expect(result.data.snapshot.system.sampleCount).toBe(7);
    expect(result.data.snapshot.comparison.comparableCount).toBe(6);
    expect(result.data.snapshot.comparison.comparableCount).not.toBe(
      result.data.snapshot.trader.sampleCount,
    );
    expect(result.data.filterOptions.accounts).toContainEqual({
      tradingAccountId: fixture.archivedAccountId,
      name: 'Archived Account',
      isArchived: true,
    });
    expect(
      result.data.filterOptions.strategyVersions.some(
        (option) => option.strategyVersionId === fixture.primary.strategyVersionId,
      ),
    ).toBe(true);
    expect(JSON.stringify(result.data.snapshot)).not.toContain(fixture.deletedTradeId);
    expect(() => JSON.parse(JSON.stringify(result.data)) as unknown).not.toThrow();
  });

  it('keeps page selectors available for safe invalid-filter recovery and supports All Accounts without an active Account', async () => {
    const fixture = await createFixture();
    const invalid = await getAnalyticsPageData(
      { strategyId: fixture.primary.strategyId, setupId: fixture.secondary.setupId },
      READ_OPTIONS,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe('invalid_filters');
      expect(invalid.filterOptions.strategies.length).toBeGreaterThan(0);
    }

    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(eq(tradingAccounts.id, fixture.activeAccountId));
    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(eq(tradingAccounts.id, fixture.emptyAccountId));
    const all = await getAnalyticsPageData(
      { datePreset: 'all', tradingAccountId: 'all' },
      READ_OPTIONS,
    );
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.data.snapshot.scope.accountScope).toEqual({ kind: 'all' });
    expect(await getAnalyticsPageData({}, READ_OPTIONS)).toMatchObject({
      ok: false,
      code: 'no_active_trading_account',
    });
  });

  it('builds the Dashboard from active Account scope with strict 90D, 30D, and All ranges', async () => {
    const fixture = await createFixture();
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.primary,
      actualR: '2.0000',
      traderOutcome: 'win',
      systemR: '2.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-06-01T10:00:00Z'),
      systemExitedAt: new Date('2026-06-01T11:00:00Z'),
    });

    const defaultRange = await getDashboardOverview(undefined, READ_OPTIONS);
    if (!defaultRange.ok) throw new Error(defaultRange.code);
    expect(defaultRange.data.overview.scope).toMatchObject({
      datePreset: '90d',
      accountScope: {
        kind: 'account',
        accountId: fixture.activeAccountId,
        source: 'active',
      },
    });
    expect(defaultRange.data.overview.trader.sampleCount).toBe(8);
    expect(defaultRange.data.recentTrades).toHaveLength(5);
    expect(
      defaultRange.data.recentTrades.every(
        (trade) => trade.tradingAccountName === 'Active Account',
      ),
    ).toBe(true);

    const thirtyDays = await getDashboardOverview('30d', READ_OPTIONS);
    if (!thirtyDays.ok) throw new Error(thirtyDays.code);
    expect(thirtyDays.data.overview.scope.datePreset).toBe('30d');
    expect(thirtyDays.data.overview.trader.sampleCount).toBe(7);

    const allTime = await getDashboardOverview('all', READ_OPTIONS);
    if (!allTime.ok) throw new Error(allTime.code);
    expect(allTime.data.overview.scope.datePreset).toBe('all');
    expect(allTime.data.overview.scope.accountScope.kind).toBe('account');
    expect(allTime.data.overview.trader.sampleCount).toBe(8);
    expect(allTime.data.overview.system.sampleCount).toBe(8);

    const invalidRange = await getDashboardOverview('7d', READ_OPTIONS);
    if (!invalidRange.ok) throw new Error(invalidRange.code);
    expect(invalidRange.data.overview.scope.datePreset).toBe('90d');
    expect(invalidRange.data.overview.trader.sampleCount).toBe(8);
  });

  it('D2 propagates explicit Account/date/Strategy/Setup scope into metrics and Recent Trades', async () => {
    const fixture = await createFixture();
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.secondary,
      actualR: '9.0000',
      traderOutcome: 'win',
      systemR: '9.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-04-01T10:00:00Z'),
      systemExitedAt: new Date('2026-04-01T11:00:00Z'),
    });
    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: '30d',
      strategy: fixture.secondary.strategyId,
      setup: fixture.secondary.setupId,
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);
    const result = await getDashboardPageData(parsed.state, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);

    expect(result.data.scope).toMatchObject({
      datePreset: '30d',
      accountScope: {
        kind: 'account',
        accountId: fixture.activeAccountId,
        source: 'explicit',
      },
      strategyId: fixture.secondary.strategyId,
      setupId: fixture.secondary.setupId,
    });
    expect(result.data.trader.sampleCount).toBe(1);
    expect(result.data.system.sampleCount).toBe(1);
    expect(result.data.recentTrades).toMatchObject({
      scope: 'dashboard_filters',
      dateAxis: 'occurred_at',
    });
    expect(result.data.recentTrades.items).toHaveLength(1);
    expect(result.data.recentTrades.items[0]).toMatchObject({
      strategyName: 'Secondary',
      setupName: 'Secondary Setup',
      executionGapR: { status: 'available', value: '0.0000' },
    });
    expect(result.data.attention.scope).toBe('workspace_operational');
  });

  it('D2 keeps all-Account R available while propagating mixed-currency Money unavailability', async () => {
    await createFixture();
    const parsed = parseDashboardFilterState({ account: 'all', range: 'all', unit: 'money' });
    if (!parsed.ok) throw new Error(parsed.code);
    const result = await getDashboardPageData(parsed.state, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);

    expect(result.data.account).toEqual({ kind: 'all' });
    expect(result.data.trader.totalR.status).toBe('available');
    expect(result.data.basic.netPnl).toEqual({
      status: 'unavailable',
      reason: 'mixed_currency',
    });
    expect(result.data.coverage.traderTradeCount).toBeGreaterThan(0);
  });

  /**
   * D5A against real PostgreSQL. The point is not the arithmetic — that is
   * covered exhaustively in `execution-comparison.test.ts` — but that the
   * DAL's ORDER BY, its `exited_at`-only range gate, and the composer's own
   * ordering agree end to end, and that the series reconciles with the
   * summary the same read produced.
   */
  it('D5A composes a paired series ordered and bounded by Actual exit alone', async () => {
    const fixture = await createFixture();
    // Actual INSIDE the 30D window, System exit far outside it -> included,
    // because Population C is anchored to the Actual exit and nothing else.
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.primary,
      actualR: '1.0000',
      traderOutcome: 'win',
      systemR: '4.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-08-05T10:00:00Z'),
      systemExitedAt: new Date('2019-01-01T10:00:00Z'),
    });
    // Actual OUTSIDE the window, System exit inside it -> excluded.
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.primary,
      actualR: '7.0000',
      traderOutcome: 'win',
      systemR: '7.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-01-05T10:00:00Z'),
      systemExitedAt: new Date('2026-08-06T10:00:00Z'),
    });

    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: '30d',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);
    const result = await getDashboardPageData(parsed.state, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const comparison = result.data.comparison;
    expect(comparison.status).toBe('available');
    if (comparison.status !== 'available') throw new Error('unreachable');

    const inWindow = comparison.tradeSeries.find((point) => point.systemR === '4.0000');
    expect(inWindow).toBeDefined();
    expect(inWindow?.systemExitedAt).toBe('2019-01-01T10:00:00.000Z');
    expect(comparison.tradeSeries.some((point) => point.actualR === '7.0000')).toBe(false);

    // Ordering is Actual exit ASC, then Trade ID ASC — no exception.
    const ordered = [...comparison.tradeSeries].sort((left, right) => {
      const byInstant = new Date(left.exitedAt).getTime() - new Date(right.exitedAt).getTime();
      return byInstant !== 0 ? byInstant : left.tradeId.localeCompare(right.tradeId);
    });
    expect(comparison.tradeSeries).toEqual(ordered);

    // Every point holds the identity, and the last one IS the summary.
    for (const point of comparison.tradeSeries) {
      expect(Number(point.cumulativeExecutionGapR)).toBeCloseTo(
        Number(point.cumulativeActualR) - Number(point.cumulativeSystemR),
        10,
      );
    }
    const last = comparison.tradeSeries.at(-1);
    expect(comparison.summary.pairedSystemTotalR).toEqual({
      status: 'available',
      value: last?.cumulativeSystemR,
    });
    expect(comparison.summary.pairedActualTotalR).toEqual({
      status: 'available',
      value: last?.cumulativeActualR,
    });
    expect(comparison.summary.executionGapR).toEqual({
      status: 'available',
      value: last?.cumulativeExecutionGapR,
    });
    expect(comparison.summary.comparableCount).toBe(comparison.tradeSeries.length);
    expect(
      comparison.distribution.underperformedCount +
        comparison.distribution.matchedCount +
        comparison.distribution.outperformedCount,
    ).toBe(comparison.summary.comparableCount);

    // The daily rollup closes on exactly the same totals as the trade series.
    const lastDaily = comparison.dailySeries.at(-1);
    expect(lastDaily?.cumulativeSystemR).toBe(last?.cumulativeSystemR);
    expect(lastDaily?.cumulativeActualR).toBe(last?.cumulativeActualR);
    expect(lastDaily?.cumulativeExecutionGapR).toBe(last?.cumulativeExecutionGapR);
    expect(comparison.dailySeries.reduce((total, point) => total + point.pairedTradeCount, 0)).toBe(
      comparison.summary.comparableCount,
    );
  });

  /**
   * D6A against real PostgreSQL. The arithmetic is covered exhaustively in
   * `calendar.test.ts`; what this proves is that the DAL's three population
   * filters, its three date axes, and the Dashboard-range intersection all
   * behave end to end — and that a month costs ONE read, not one per day.
   */
  it('D6A composes an Actual calendar month on the Actual exit axis alone', async () => {
    const fixture = await createFixture();
    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    const result = await getDashboardCalendarMonthInZone(
      parsed.state,
      { mode: 'actual', year: 2026, month: 8 },
      'UTC',
      READ_OPTIONS,
    );
    if (!result.ok) throw new Error(result.code);
    expect(result.data.status).toBe('available');
    if (result.data.status !== 'available') throw new Error('unreachable');

    // The fixture's paired Trades exit 1-4 August plus a 7 August split.
    expect(result.data.days.length).toBeGreaterThan(0);
    expect(result.data.mode).toBe('actual');
    for (const day of result.data.days) {
      expect(day.mode).toBe('actual');
      expect(day.date.startsWith('2026-08')).toBe(true);
    }
    // Days sum to the month total, and only populated dates appear.
    const summed = result.data.days.reduce(
      (total, day) => total + Number(day.mode === 'gap' ? day.gapR : day.totalR),
      0,
    );
    expect(Number(result.data.totals.totalR)).toBeCloseTo(summed, 10);
    expect(result.data.totals.populatedDayCount).toBe(result.data.days.length);
    expect(
      result.data.totals.classifiedDayCounts.positive +
        result.data.totals.classifiedDayCounts.neutral +
        result.data.totals.classifiedDayCounts.negative,
    ).toBe(result.data.days.length);
  });

  it('D6A buckets the System calendar on system_exited_at, not the Actual exit', async () => {
    const fixture = await createFixture();
    // Actual exits 5 August; the System side resolves on 9 August. In Actual
    // mode this Trade is a 5 August day, in System mode a 9 August one.
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.primary,
      actualR: '1.0000',
      traderOutcome: 'win',
      systemR: '2.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-08-05T10:00:00Z'),
      systemExitedAt: new Date('2026-08-09T10:00:00Z'),
    });
    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    const [actualMonth, systemMonth] = await Promise.all([
      getDashboardCalendarMonthInZone(
        parsed.state,
        { mode: 'actual', year: 2026, month: 8 },
        'UTC',
        READ_OPTIONS,
      ),
      getDashboardCalendarMonthInZone(
        parsed.state,
        { mode: 'system', year: 2026, month: 8 },
        'UTC',
        READ_OPTIONS,
      ),
    ]);
    if (!actualMonth.ok || !systemMonth.ok) throw new Error('calendar read failed');
    if (actualMonth.data.status !== 'available' || systemMonth.data.status !== 'available') {
      throw new Error('unreachable');
    }
    const actualDates = actualMonth.data.days.map((day) => day.date);
    const systemDates = systemMonth.data.days.map((day) => day.date);
    expect(actualDates).toContain('2026-08-05');
    expect(systemDates).toContain('2026-08-09');
    // Nothing forces the two axes into alignment.
    expect(actualDates).not.toEqual(systemDates);
  });

  it('D6A builds the Gap calendar from Population C, anchored on the Actual exit', async () => {
    const fixture = await createFixture();
    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    const result = await getDashboardCalendarMonthInZone(
      parsed.state,
      { mode: 'gap', year: 2026, month: 8 },
      'UTC',
      READ_OPTIONS,
    );
    if (!result.ok) throw new Error(result.code);
    if (result.data.status !== 'available') throw new Error('unreachable');

    for (const day of result.data.days) {
      if (day.mode !== 'gap') throw new Error('expected a gap day');
      // Every day's Gap is Actual minus System, never a second formula.
      expect(Number(day.gapR)).toBeCloseTo(Number(day.actualR) - Number(day.systemR), 10);
      expect(day.underperformedCount + day.matchedCount + day.outperformedCount).toBe(
        day.pairedTradeCount,
      );
      expect(['outperformed', 'matched', 'underperformed']).toContain(day.classification);
    }
    // The paired population is a subset of the Actual one.
    const actualMonth = await getDashboardCalendarMonthInZone(
      parsed.state,
      { mode: 'actual', year: 2026, month: 8 },
      'UTC',
      READ_OPTIONS,
    );
    if (!actualMonth.ok || actualMonth.data.status !== 'available') throw new Error('unreachable');
    expect(result.data.totals.eligibleTradeCount).toBeLessThanOrEqual(
      actualMonth.data.totals.eligibleTradeCount,
    );
  });

  /**
   * §23 — the Calendar month is INTERSECTED with the active Dashboard range,
   * so the squares can never show Trades every other figure on the page has
   * excluded.
   */
  it('D6A intersects the Calendar month with the Dashboard date range', async () => {
    const fixture = await createFixture();
    // An April Trade the 30D window cannot reach but range=All can. Without
    // it the "April is empty" assertion below would pass for the wrong
    // reason — April is empty in the base fixture either way.
    await createTrade(fixture.workspaceId, {
      accountId: fixture.activeAccountId,
      framework: fixture.primary,
      actualR: '1.0000',
      traderOutcome: 'win',
      systemR: '1.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-04-15T10:00:00Z'),
      systemExitedAt: new Date('2026-04-15T11:00:00Z'),
    });
    const all = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'all',
      unit: 'r',
    });
    const bounded = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: '30d',
      unit: 'r',
    });
    const customDay = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'custom',
      from: '2026-04-15',
      to: '2026-04-15',
      unit: 'r',
    });
    const customAfter = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'custom',
      from: '2026-04-16',
      to: '2026-04-30',
      unit: 'r',
    });
    if (!all.ok || !bounded.ok || !customDay.ok || !customAfter.ok) {
      throw new Error('filter parse failed');
    }

    // The fixture's Trades exit in early August; the reference instant is
    // 2026-08-09, so a 30D window starts 2026-07-10 and still contains them.
    const [allMonth, boundedMonth, aprilBounded] = await Promise.all([
      getDashboardCalendarMonthInZone(
        all.state,
        { mode: 'actual', year: 2026, month: 8 },
        'UTC',
        READ_OPTIONS,
      ),
      getDashboardCalendarMonthInZone(
        bounded.state,
        { mode: 'actual', year: 2026, month: 8 },
        'UTC',
        READ_OPTIONS,
      ),
      // April is entirely outside the 30D window: legitimately empty, never
      // silently unfiltered.
      getDashboardCalendarMonthInZone(
        bounded.state,
        { mode: 'actual', year: 2026, month: 4 },
        'UTC',
        READ_OPTIONS,
      ),
    ]);
    if (!allMonth.ok || !boundedMonth.ok || !aprilBounded.ok) throw new Error('read failed');
    expect(allMonth.data.status).toBe('available');
    expect(boundedMonth.data.status).toBe('available');
    expect(aprilBounded.data.status).toBe('empty');

    const allApril = await getDashboardCalendarMonthInZone(
      all.state,
      { mode: 'actual', year: 2026, month: 4 },
      'UTC',
      READ_OPTIONS,
    );
    if (!allApril.ok) throw new Error('read failed');
    // With range=All the same April month IS populated — proving the
    // emptiness above came from the intersection, not from an empty month.
    expect(allApril.data.status).toBe('available');
    if (allApril.data.status !== 'available') throw new Error('unreachable');
    expect(allApril.data.days.map((day) => day.date)).toContain('2026-04-15');

    const [inclusiveCustom, outsideCustom] = await Promise.all([
      getDashboardCalendarMonthInZone(
        customDay.state,
        { mode: 'actual', year: 2026, month: 4 },
        'UTC',
        READ_OPTIONS,
      ),
      getDashboardCalendarMonthInZone(
        customAfter.state,
        { mode: 'actual', year: 2026, month: 4 },
        'UTC',
        READ_OPTIONS,
      ),
    ]);
    if (!inclusiveCustom.ok || !outsideCustom.ok) throw new Error('read failed');
    expect(inclusiveCustom.data.status).toBe('available');
    expect(outsideCustom.data.status).toBe('empty');
    if (inclusiveCustom.data.status !== 'available') throw new Error('unreachable');
    expect(inclusiveCustom.data.days.map((day) => day.date)).toContain('2026-04-15');
  });

  it('D6A opens a Day Review whose rows reconcile with the Calendar day', async () => {
    const fixture = await createFixture();
    const parsed = parseDashboardFilterState({
      account: fixture.activeAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    const month = await getDashboardCalendarMonthInZone(
      parsed.state,
      { mode: 'actual', year: 2026, month: 8 },
      'UTC',
      READ_OPTIONS,
    );
    if (!month.ok || month.data.status !== 'available') throw new Error('unreachable');
    const firstDay = month.data.days[0];
    if (firstDay === undefined) throw new Error('expected a populated day');

    const review = await getDashboardDayReview(
      parsed.state,
      { mode: 'actual', date: firstDay.date },
      'UTC',
      READ_OPTIONS,
    );
    if (!review.ok) throw new Error(review.code);
    expect(review.data.status).toBe('available');
    if (review.data.status !== 'available') throw new Error('unreachable');

    expect(review.data.date).toBe(firstDay.date);
    expect(review.data.mode).toBe('actual');
    expect(reconcileDayReview(review.data)).toBe(true);
    // Every row carries a stable Trade ID for the Quick Preview boundary.
    for (const row of review.data.trades) {
      expect(row.tradeId).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  it('D6A reports an empty Day Review for a day with nothing eligible', async () => {
    const fixture = await createFixture();
    const parsed = parseDashboardFilterState({
      account: fixture.emptyAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    const review = await getDashboardDayReview(
      parsed.state,
      { mode: 'actual', date: '2026-08-01' },
      'UTC',
      READ_OPTIONS,
    );
    if (!review.ok) throw new Error(review.code);
    expect(review.data.status).toBe('empty');
    if (review.data.status !== 'empty') throw new Error('unreachable');
    expect(review.data.reason).toBe('no_eligible_trades');
  });

  it('D6A returns an empty Calendar, not an error, for an Account with no Trades', async () => {
    const fixture = await createFixture();
    const parsed = parseDashboardFilterState({
      account: fixture.emptyAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);

    for (const mode of ['actual', 'system', 'gap'] as const) {
      const result = await getDashboardCalendarMonthInZone(
        parsed.state,
        { mode, year: 2026, month: 8 },
        'UTC',
        READ_OPTIONS,
      );
      if (!result.ok) throw new Error(result.code);
      expect(result.data.status).toBe('empty');
      if (result.data.status !== 'empty') throw new Error('unreachable');
      expect(result.data.reason).toBe('no_eligible_trades');
      expect(result.data.mode).toBe(mode);
    }
  });

  it('D5A reports an empty comparison, not an error, when nothing is paired', async () => {
    const fixture = await createFixture();
    // A Trader-complete Trade whose System side is still pending is
    // Population A only, so this Account has a Trader total and no pairs.
    await createTrade(fixture.workspaceId, {
      accountId: fixture.emptyAccountId,
      framework: fixture.primary,
      systemStatus: 'pending',
      actualR: '1.0000',
      traderOutcome: 'win',
      exitedAt: new Date('2026-08-05T10:00:00Z'),
    });

    const parsed = parseDashboardFilterState({
      account: fixture.emptyAccountId,
      range: 'all',
      unit: 'r',
    });
    if (!parsed.ok) throw new Error(parsed.code);
    const result = await getDashboardPageData(parsed.state, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.trader.sampleCount).toBe(1);
    expect(result.data.comparison.status).toBe('empty');
    if (result.data.comparison.status !== 'empty') throw new Error('unreachable');
    expect(result.data.comparison.reason).toBe('no_comparable_trades');
    expect(result.data.availability.comparison).toBe('empty');
    expect(result.data.comparison.summary.executionGapR).toEqual({
      status: 'unavailable',
      reason: 'no_comparable_trades',
    });
  });

  it('refreshes Dashboard scope when the active Account changes and distinguishes no data', async () => {
    const fixture = await createFixture();
    const populated = await getDashboardOverview(undefined, READ_OPTIONS);
    if (!populated.ok) throw new Error(populated.code);
    expect(populated.data.overview.trader.sampleCount).toBeGreaterThan(0);

    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: fixture.emptyAccountId })
      .where(eq(userPreferences.userId, fixture.userId));
    const empty = await getDashboardOverview(undefined, READ_OPTIONS);
    if (!empty.ok) throw new Error(empty.code);
    expect(empty.data.overview.scope.accountScope).toEqual({
      kind: 'account',
      accountId: fixture.emptyAccountId,
      source: 'active',
    });
    expect(empty.data.overview.trader.sampleCount).toBe(0);
    expect(empty.data.overview.system.sampleCount).toBe(0);
    expect(empty.data.recentTrades).toEqual([]);
  });

  it('keeps recent Trade labels pinned after the current Strategy name changes', async () => {
    const fixture = await createFixture();
    const [renamed] = await db
      .insert(strategyVersions)
      .values({
        workspaceId: fixture.workspaceId,
        strategyId: fixture.primary.strategyId,
        versionNumber: 2,
        name: 'Renamed Current Strategy',
      })
      .returning({ id: strategyVersions.id });
    if (renamed === undefined) throw new Error('renamed version insert failed');
    await db
      .update(strategies)
      .set({ currentVersionId: renamed.id })
      .where(eq(strategies.id, fixture.primary.strategyId));

    const result = await getDashboardOverview(undefined, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const primaryTrades = result.data.recentTrades.filter(
      (trade) => trade.setupName === 'Primary Setup',
    );
    expect(primaryTrades.length).toBeGreaterThan(0);
    expect(primaryTrades.every((trade) => trade.strategyName === 'Primary')).toBe(true);
    expect(primaryTrades.every((trade) => trade.strategyName !== 'Renamed Current Strategy')).toBe(
      true,
    );
  });

  it('keeps Dashboard reads available in writable, over-limit, and read-only modes', async () => {
    const fixture = await createFixture();
    expect((await getDashboardOverview(undefined, READ_OPTIONS)).ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'active', planKey: 'starter' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    expect((await getDashboardOverview(undefined, READ_OPTIONS)).ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'expired' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    expect((await getDashboardOverview(undefined, READ_OPTIONS)).ok).toBe(true);
  });

  it('Phase 13H: composes Setup Adherence, Condition, Confidence, and Emotion analytics end-to-end from real reads', async () => {
    const userId = await createUser('analytics-13h-service');
    const workspaceId = await createWorkspace(userId, 'analytics-13h-service');
    const accountId = await createAccount(workspaceId, 'Active Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));
    const framework = await createFramework(workspaceId, 'Phase 13H Strategy');
    currentSession = sessionFor(userId);

    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.setupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');

    const tradeId = await createTrade(workspaceId, {
      accountId,
      framework,
      actualR: '2.0000',
    });
    await db.insert(tradeSetupConditionChecks).values({
      workspaceId,
      tradeId,
      setupConditionId: condition.id,
      setupVersionId: framework.setupVersionId,
      conditionKey: condition.conditionKey,
      label: 'Above the 200 EMA',
      sortOrder: 0,
      checkStatus: 'met',
    });
    await db
      .update(trades)
      .set({ confidence: 75, emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
      .where(eq(trades.id, tradeId));
    const emotion = await db.query.emotionTypes.findFirst({
      where: eq(emotionTypes.isSystem, true),
    });
    if (emotion === undefined) throw new Error('canonical emotion seed missing');
    await db.insert(tradeEmotions).values({ workspaceId, tradeId, emotionTypeId: emotion.id });

    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);

    expect(result.data.setupAdherence).toMatchObject({
      sampleCount: 1,
      averageAdherence: { status: 'available', value: '1.0000' },
      conditionsMetRate: { status: 'available', value: '1.0000' },
    });
    expect(result.data.setupAdherence.buckets.find((b) => b.bucket === '100')).toMatchObject({
      trader: { tradeCount: 1, averageR: { status: 'available', value: '2.0000' } },
      system: { tradeCount: 1, averageR: { status: 'available', value: '2.0000' } },
    });

    expect(result.data.conditions).toHaveLength(1);
    expect(result.data.conditions[0]).toMatchObject({
      conditionKey: condition.conditionKey,
      label: 'Above the 200 EMA',
      trader: { met: { tradeCount: 1 }, notMet: { tradeCount: 0 } },
      system: { met: { tradeCount: 1 }, notMet: { tradeCount: 0 } },
    });

    expect(result.data.confidence).toMatchObject({
      sampleCount: 1,
      averageConfidence: { status: 'available', value: '0.7500' },
    });
    expect(result.data.confidence.levels.find((l) => l.level === 75)).toMatchObject({
      trader: { tradeCount: 1 },
      system: { tradeCount: 1 },
    });

    expect(result.data.emotions).toHaveLength(1);
    expect(result.data.emotions[0]).toMatchObject({
      key: emotion.key,
      trader: { tradeCount: 1 },
      system: { tradeCount: 1 },
    });

    expect(() => JSON.stringify(result.data)).not.toThrow();
  });

  it('Phase 15G.5C: excludes proven retrospective entry context before aggregation while preserving every financial/classification axis', async () => {
    const userId = await createUser('analytics-15g5c-service');
    const workspaceId = await createWorkspace(userId, 'analytics-15g5c-service');
    const accountId = await createAccount(workspaceId, 'Active Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));
    const framework = await createFramework(workspaceId, 'Temporal Truth Strategy');
    const zeroConfiguredFramework = await createFramework(workspaceId, 'Zero Conditions Strategy');
    currentSession = sessionFor(userId);

    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.setupVersionId,
        label: 'Live entry evidence',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');
    const emotion = await db.query.emotionTypes.findFirst({
      where: eq(emotionTypes.isSystem, true),
    });
    if (emotion === undefined) throw new Error('canonical emotion seed missing');
    const disciplineRules = await createDisciplineRules(workspaceId, framework);

    const exitedAt = new Date('2026-08-01T10:00:00.000Z');
    const liveTradeId = await createTrade(workspaceId, {
      accountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      actualR: '1.0000',
      systemR: '2.0000',
    });
    const completedAfterTrade = await createCompletedTrade(workspaceId, userId, {
      mutationKey: crypto.randomUUID(),
      tradingAccountId: accountId,
      recordingTiming: 'after_trade',
      systemPlanBasis: 'money',
      strategyId: framework.strategyId,
      setupId: framework.setupId,
      conditionSetToken: createConditionSetToken(framework.setupVersionId),
      conditionAnswers: [{ conditionKey: condition.conditionKey, status: 'not_met' }],
      symbol: 'EURUSD',
      direction: 'long',
      plannedRiskMinor: 100n,
      plannedRewardMinor: 400n,
      actualResultBasis: 'money',
      actualInitialRiskMinor: 100n,
      enteredAt: new Date('2026-08-01T09:00:00.000Z'),
      exitedAt,
      exits: [{ closedBps: 10_000, realizedPnlMinor: 300n }],
      confidence: 100,
      emotionKeys: [emotion.key],
      systemResult: {
        status: 'resolved',
        resolutionKind: 'money_target',
        systemExitedAt: new Date('2026-08-01T11:00:00.000Z'),
        systemCostR: '0',
      },
    });
    if (!completedAfterTrade.ok) throw new Error(completedAfterTrade.code);
    expect(completedAfterTrade.recordedRetrospectively).toBe(true);
    const retrospectiveResolvedId = completedAfterTrade.tradeId;
    const retrospectivePendingId = await createTrade(workspaceId, {
      accountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T10:00:00.001Z'),
      actualR: '5.0000',
      systemStatus: 'pending',
    });
    const retrospectiveNoTradeId = await createTrade(workspaceId, {
      accountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T10:00:00.001Z'),
      actualR: '6.0000',
      systemStatus: 'no_trade',
    });
    const lateClassificationId = await createTrade(workspaceId, {
      accountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T10:00:00.001Z'),
    });
    const noChecklistId = await createTrade(workspaceId, {
      accountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
    });
    const zeroConfiguredId = await createTrade(workspaceId, {
      accountId,
      framework: zeroConfiguredFramework,
      exitedAt,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
    });
    const liveConfidenceIds = await Promise.all(
      [25, 50, 75, 100].map(async (confidence, index) => {
        const tradeId = await createTrade(workspaceId, {
          accountId,
          framework,
          exitedAt: new Date(exitedAt.getTime() + (index + 1) * 60_000),
          createdAt: new Date('2026-08-01T08:00:00.000Z'),
        });
        await db.update(trades).set({ confidence }).where(eq(trades.id, tradeId));
        return tradeId;
      }),
    );

    const manuallySeededContextualTradeIds = [
      liveTradeId,
      retrospectivePendingId,
      retrospectiveNoTradeId,
    ];
    await db.insert(tradeSetupConditionChecks).values(
      manuallySeededContextualTradeIds.map((tradeId, index) => ({
        workspaceId,
        tradeId,
        setupConditionId: condition.id,
        setupVersionId: framework.setupVersionId,
        conditionKey: condition.conditionKey,
        label: 'Live entry evidence',
        sortOrder: 0,
        checkStatus: index === 0 ? ('met' as const) : ('not_met' as const),
      })),
    );
    await Promise.all([
      db.update(trades).set({ confidence: 0 }).where(eq(trades.id, liveTradeId)),
      db.update(trades).set({ confidence: 75 }).where(eq(trades.id, retrospectivePendingId)),
      db.update(trades).set({ confidence: 50 }).where(eq(trades.id, retrospectiveNoTradeId)),
      // Explicitly recorded empty remains distinct from never recorded, but
      // neither fabricates an Emotion group.
      db
        .update(trades)
        .set({ emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
        .where(eq(trades.id, noChecklistId)),
      // Classification assigned after completion remains meaningful for
      // Strategy/Setup performance but must not fabricate Checklist rows.
      db
        .update(trades)
        .set({
          strategyAssignedAt: new Date('2026-08-01T10:00:00.001Z'),
          setupAssignedAt: new Date('2026-08-01T10:00:00.001Z'),
        })
        .where(eq(trades.id, lateClassificationId)),
    ]);
    await db.insert(tradeEmotions).values(
      manuallySeededContextualTradeIds.map((tradeId) => ({
        workspaceId,
        tradeId,
        emotionTypeId: emotion.id,
      })),
    );
    await db
      .update(trades)
      .set({ emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
      .where(inArray(trades.id, manuallySeededContextualTradeIds));
    await addDisciplineRows(workspaceId, framework, retrospectiveResolvedId, liveTradeId, {
      rules: disciplineRules,
      firstTradeHasSnapshots: true,
    });

    const raw = await getAnalyticsRawPopulations({ datePreset: 'all' }, READ_OPTIONS);
    if (!raw.ok) throw new Error(raw.code);
    const affectedTradeIds = (records: readonly { tradeId: string }[]) =>
      [...new Set(records.map((record) => record.tradeId))].sort();
    expect(affectedTradeIds(raw.data.setupAdherence)).toEqual([liveTradeId]);
    expect(affectedTradeIds(raw.data.setupAdherenceSystem)).toEqual([liveTradeId]);
    expect(affectedTradeIds(raw.data.conditions)).toEqual([liveTradeId]);
    expect(affectedTradeIds(raw.data.conditionsSystem)).toEqual([liveTradeId]);
    expect(affectedTradeIds(raw.data.confidence)).toEqual(
      [liveTradeId, ...liveConfidenceIds].sort(),
    );
    expect(affectedTradeIds(raw.data.confidenceSystem)).toEqual(
      [liveTradeId, ...liveConfidenceIds].sort(),
    );
    expect(affectedTradeIds(raw.data.emotions)).toEqual([liveTradeId]);
    expect(affectedTradeIds(raw.data.emotionsSystem)).toEqual([liveTradeId]);

    expect(affectedTradeIds(raw.data.trader)).toEqual(
      [
        liveTradeId,
        noChecklistId,
        retrospectiveNoTradeId,
        retrospectivePendingId,
        retrospectiveResolvedId,
        lateClassificationId,
        zeroConfiguredId,
        ...liveConfidenceIds,
      ].sort(),
    );
    expect(affectedTradeIds(raw.data.system)).toEqual(
      [
        liveTradeId,
        noChecklistId,
        lateClassificationId,
        retrospectiveResolvedId,
        zeroConfiguredId,
        ...liveConfidenceIds,
      ].sort(),
    );
    expect(affectedTradeIds(raw.data.paired)).toEqual(
      [
        liveTradeId,
        noChecklistId,
        lateClassificationId,
        retrospectiveResolvedId,
        zeroConfiguredId,
        ...liveConfidenceIds,
      ].sort(),
    );
    expect(affectedTradeIds(raw.data.rules)).toContain(retrospectiveResolvedId);
    expect(affectedTradeIds(raw.data.mistakes)).toContain(retrospectiveResolvedId);

    const result = await getAnalyticsSnapshot({ datePreset: 'all' }, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.trader.sampleCount).toBe(11);
    expect(result.data.system.sampleCount).toBe(9);
    expect(result.data.comparison.comparableCount).toBe(9);
    expect(result.data.setupAdherence).toMatchObject({
      sampleCount: 1,
      averageAdherence: { status: 'available', value: '1.0000' },
      conditionsMetRate: { status: 'available', value: '1.0000' },
    });
    expect(result.data.conditions[0]).toMatchObject({
      trader: { met: { tradeCount: 1 }, notMet: { tradeCount: 0 } },
      system: { met: { tradeCount: 1 }, notMet: { tradeCount: 0 } },
    });
    expect(result.data.confidence).toMatchObject({
      sampleCount: 5,
      averageConfidence: { status: 'available', value: '0.5000' },
    });
    for (const level of [0, 25, 50, 75, 100]) {
      expect(result.data.confidence.levels.find((row) => row.level === level)).toMatchObject({
        trader: { tradeCount: 1 },
        system: { tradeCount: 1 },
      });
    }
    expect(result.data.emotions).toHaveLength(1);
    expect(result.data.emotions[0]).toMatchObject({
      trader: { tradeCount: 1 },
      system: { tradeCount: 1 },
    });
    expect(
      result.data.strategyPerformance.strategies.find(
        (strategy) => strategy.strategyId === framework.strategyId,
      ),
    ).toMatchObject({ trader: { tradeCount: 10 }, system: { tradeCount: 8 } });
    expect(
      result.data.setupPerformance.setups.find((setup) => setup.setupId === framework.setupId),
    ).toMatchObject({ trader: { tradeCount: 10 }, system: { tradeCount: 8 } });
    expect(result.data.rules.followedCount).toBe(8);
    expect(result.data.mistakes.map((mistake) => mistake.tradeCount)).toEqual([2, 1]);

    // Exclusion is analytical only: retrospective snapshots and Emotion
    // links remain durably stored for Journal presentation.
    expect(
      await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, retrospectiveResolvedId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(tradeEmotions)
        .where(eq(tradeEmotions.tradeId, retrospectiveResolvedId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, lateClassificationId)),
    ).toHaveLength(0);
    const emotionCaptureStates = await db
      .select({ id: trades.id, recordedAt: trades.emotionsRecordedAt })
      .from(trades)
      .where(inArray(trades.id, [noChecklistId, zeroConfiguredId]));
    const emotionCaptureByTrade = new Map(
      emotionCaptureStates.map((row) => [row.id, row.recordedAt]),
    );
    expect(emotionCaptureByTrade.get(noChecklistId)).toBeInstanceOf(Date);
    expect(emotionCaptureByTrade.get(zeroConfiguredId)).toBeNull();
    expect(
      await db
        .select()
        .from(tradeEmotions)
        .where(inArray(tradeEmotions.tradeId, [noChecklistId, zeroConfiguredId])),
    ).toHaveLength(0);

    const retrospectiveOnlyAccountId = await createAccount(workspaceId, 'Retrospective only');
    const retrospectiveOnlyId = await createTrade(workspaceId, {
      accountId: retrospectiveOnlyAccountId,
      framework,
      exitedAt,
      createdAt: new Date('2026-08-01T10:00:00.001Z'),
    });
    await db.insert(tradeSetupConditionChecks).values({
      workspaceId,
      tradeId: retrospectiveOnlyId,
      setupConditionId: condition.id,
      setupVersionId: framework.setupVersionId,
      conditionKey: condition.conditionKey,
      label: 'Live entry evidence',
      sortOrder: 0,
      checkStatus: 'met',
    });
    await db
      .update(trades)
      .set({ confidence: 25, emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
      .where(eq(trades.id, retrospectiveOnlyId));
    await db.insert(tradeEmotions).values({
      workspaceId,
      tradeId: retrospectiveOnlyId,
      emotionTypeId: emotion.id,
    });
    const zeroEligible = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: retrospectiveOnlyAccountId },
      READ_OPTIONS,
    );
    if (!zeroEligible.ok) throw new Error(zeroEligible.code);
    expect(zeroEligible.data.trader.sampleCount).toBe(1);
    expect(zeroEligible.data.system.sampleCount).toBe(1);
    expect(zeroEligible.data.comparison.comparableCount).toBe(1);
    expect(zeroEligible.data.setupAdherence).toMatchObject({
      sampleCount: 0,
      averageAdherence: { status: 'unavailable', reason: 'no_conditions_applicable' },
      conditionsMetRate: { status: 'unavailable', reason: 'no_conditions_applicable' },
    });
    expect(zeroEligible.data.conditions).toHaveLength(0);
    expect(zeroEligible.data.confidence).toMatchObject({
      sampleCount: 0,
      averageConfidence: { status: 'unavailable', reason: 'no_confidence_recorded' },
    });
    expect(zeroEligible.data.emotions).toHaveLength(0);
  });

  it('Phase 15G.5C: SQL eligibility preserves millisecond equality and keeps Open Trades non-retrospective', async () => {
    const userId = await createUser('analytics-15g5c-precision');
    const workspaceId = await createWorkspace(userId, 'analytics-15g5c-precision');
    const accountId = await createAccount(workspaceId, 'Precision Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));
    currentSession = sessionFor(userId);

    const exitedAt = new Date('2026-08-01T10:00:00.000Z');
    const liveId = await createTrade(workspaceId, {
      accountId,
      framework: null,
      exitedAt,
      createdAt: new Date('2026-08-01T09:59:59.999Z'),
    });
    const equalMillisecondId = await createTrade(workspaceId, {
      accountId,
      framework: null,
      exitedAt,
      createdAt: exitedAt,
    });
    // PostgreSQL retains microseconds that JavaScript Date cannot observe.
    // The shared SQL predicate truncates both sides to milliseconds, so this
    // remains equality/not-proven-retrospective exactly like the read model.
    await db.execute(
      sql`update trades set created_at = '2026-08-01T10:00:00.000500Z'::timestamptz where id = ${equalMillisecondId}`,
    );
    const retrospectiveId = await createTrade(workspaceId, {
      accountId,
      framework: null,
      exitedAt,
      createdAt: new Date('2026-08-01T10:00:00.001Z'),
    });
    const openId = await createTrade(workspaceId, {
      accountId,
      framework: null,
      status: 'open',
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
    });
    await db
      .update(trades)
      .set({ confidence: 25 })
      .where(inArray(trades.id, [liveId, equalMillisecondId, retrospectiveId, openId]));

    const raw = await getAnalyticsRawPopulations(
      { datePreset: 'all', tradingAccountId: accountId },
      READ_OPTIONS,
    );
    if (!raw.ok) throw new Error(raw.code);
    const ids = (records: readonly { tradeId: string }[]) =>
      [...new Set(records.map((record) => record.tradeId))].sort();
    expect(ids(raw.data.confidence)).toEqual([equalMillisecondId, liveId].sort());
    expect(ids(raw.data.confidenceSystem)).toEqual([equalMillisecondId, liveId, openId].sort());
    expect(ids(raw.data.trader)).toEqual([equalMillisecondId, liveId, retrospectiveId].sort());
    expect(ids(raw.data.system)).toEqual(
      [equalMillisecondId, liveId, openId, retrospectiveId].sort(),
    );
    expect(ids(raw.data.paired)).toEqual([equalMillisecondId, liveId, retrospectiveId].sort());
  });

  it('Phase 14B: unclassified Trades participate in global Trader/System/paired analytics but never in a Strategy/Setup breakdown', async () => {
    const userId = await createUser('phase14b-unclassified');
    const workspaceId = await createWorkspace(userId, 'phase14b-unclassified');
    const accountId = await createAccount(workspaceId, 'Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));
    const framework = await createFramework(workspaceId, 'Classified');

    // F: Actual closed (Trader-eligible) + System pending + unclassified.
    await createTrade(workspaceId, {
      accountId,
      framework: null,
      systemStatus: 'pending',
      actualR: '1.5000',
      traderOutcome: 'win',
      exitedAt: new Date('2026-08-01T10:00:00Z'),
    });

    // G: Actual still open (NOT Trader-eligible) + System resolved (System-eligible) + unclassified.
    await createTrade(workspaceId, {
      accountId,
      framework: null,
      status: 'open',
      systemR: '3.0000',
      systemOutcome: 'win',
      systemExitedAt: new Date('2026-08-01T11:00:00Z'),
    });

    // H: both Actual and System final + unclassified — comparison-eligible for Execution Gap.
    await createTrade(workspaceId, {
      accountId,
      framework: null,
      actualR: '1.0000',
      traderOutcome: 'win',
      systemR: '3.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-08-02T10:00:00Z'),
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });

    // A classified control Trade, so the Strategy-filtered breakdown has
    // exactly one Trade to find — none of the three unclassified ones above.
    await createTrade(workspaceId, {
      accountId,
      framework,
      actualR: '2.0000',
      traderOutcome: 'win',
      systemR: '2.0000',
      systemOutcome: 'win',
      exitedAt: new Date('2026-08-03T10:00:00Z'),
      systemExitedAt: new Date('2026-08-03T11:00:00Z'),
    });

    currentSession = sessionFor(userId);

    const global = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: accountId },
      READ_OPTIONS,
    );
    if (!global.ok) throw new Error(global.code);
    // Trader-eligible: the F Trade, the H Trade, and the classified control — 3.
    expect(global.data.trader.sampleCount).toBe(3);
    // System-eligible: the G Trade, the H Trade, and the classified control — 3.
    expect(global.data.system.sampleCount).toBe(3);
    // Comparison-eligible (both sides final): the H Trade and the classified control — 2.
    expect(global.data.comparison.comparableCount).toBe(2);

    // I: filtering by the classified Strategy excludes all three unclassified Trades.
    const filtered = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: accountId, strategyId: framework.strategyId },
      READ_OPTIONS,
    );
    if (!filtered.ok) throw new Error(filtered.code);
    expect(filtered.data.trader.sampleCount).toBe(1);
    expect(filtered.data.system.sampleCount).toBe(1);
    expect(filtered.data.comparison.comparableCount).toBe(1);

    // Phase 15D: the same three unclassified Trades are excluded from the
    // Strategy/Setup breakdown itself (never an "Unknown Strategy" bucket)
    // while still counted in its coverage disclosure — global Trader
    // eligibility (asserted above) is completely unaffected.
    expect(global.data.strategyPerformance.strategies).toHaveLength(1);
    expect(global.data.strategyPerformance.strategies[0]?.strategyId).toBe(framework.strategyId);
    expect(global.data.strategyPerformance.strategies[0]?.trader.tradeCount).toBe(1);
    expect(global.data.strategyPerformance.classifiedTraderCount).toBe(1);
    expect(global.data.strategyPerformance.unclassifiedTraderCount).toBe(2);
    expect(global.data.strategyPerformance.classifiedSystemCount).toBe(1);
    expect(global.data.strategyPerformance.unclassifiedSystemCount).toBe(2);
    expect(global.data.setupPerformance.setups).toHaveLength(1);
    expect(global.data.setupPerformance.setups[0]?.setupId).toBe(framework.setupId);
    expect(global.data.setupPerformance.setups[0]?.strategyId).toBe(framework.strategyId);
  });

  it('Phase 15D: Trader context breakdowns (Symbol/Direction/Session/Timeframe) group only the Trader-eligible population', async () => {
    const userId = await createUser('phase15d-context');
    const workspaceId = await createWorkspace(userId, 'phase15d-context');
    const accountId = await createAccount(workspaceId, 'Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));

    await createTrade(workspaceId, {
      accountId,
      framework: null,
      actualR: '1.0000',
      traderOutcome: 'win',
      exitedAt: new Date('2026-08-01T10:00:00Z'),
    });
    // A still-open (NOT Trader-eligible) Trade must never contribute to a
    // Trader-side Context breakdown, even though it shares the same Symbol.
    await createTrade(workspaceId, {
      accountId,
      framework: null,
      status: 'open',
      systemR: '2.0000',
      systemOutcome: 'win',
      systemExitedAt: new Date('2026-08-01T11:00:00Z'),
    });

    currentSession = sessionFor(userId);
    const result = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: accountId },
      READ_OPTIONS,
    );
    if (!result.ok) throw new Error(result.code);
    expect(result.data.contextSymbol.recordedCount).toBe(1);
    expect(result.data.contextSymbol.groups[0]?.value).toBe('EURUSD');
    expect(result.data.contextDirection.groups[0]?.value).toBe('long');
    // Session/Timeframe were never set on this fixture Trade.
    expect(result.data.contextSession.missingCount).toBe(1);
    expect(result.data.contextTimeframe.missingCount).toBe(1);
  });
});
