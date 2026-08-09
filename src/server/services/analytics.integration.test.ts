import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeMistakes,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
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

const { getAnalyticsSnapshot, getDashboardOverview } = await import('./analytics');

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
): Promise<string> {
  const [row] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name,
      accountMode: 'demo',
      baseCurrency: 'USD',
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
  framework: Framework;
  status?: 'planned' | 'open' | 'closed' | 'canceled';
  actualR?: string;
  traderOutcome?: 'win' | 'loss' | 'break_even';
  exitedAt?: Date;
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

  const [row] = await db
    .insert(trades)
    .values({
      workspaceId,
      tradingAccountId: input.accountId,
      strategyId: input.framework.strategyId,
      strategyVersionId: input.framework.strategyVersionId,
      setupId: input.framework.setupId,
      setupVersionId: input.framework.setupVersionId,
      symbol: 'EURUSD',
      direction: 'long',
      plannedEntry: '100.0000000000',
      plannedStop: '99.0000000000',
      plannedTarget: '102.0000000000',
      plannedR: '2.0000',
      status,
      deletedAt: input.deleted ? new Date('2026-08-05T00:00:00Z') : null,
      ...actualFields,
      ...systemFields,
    })
    .returning({ id: trades.id });
  if (row === undefined) throw new Error('trade insert failed');
  return row.id;
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

async function addDisciplineRows(
  workspaceId: string,
  framework: Framework,
  firstTradeId: string,
  secondTradeId: string,
): Promise<void> {
  const statuses = [
    ...Array.from({ length: 8 }, () => 'followed' as const),
    ...Array.from({ length: 2 }, () => 'violated' as const),
    'not_applicable' as const,
    'not_checked' as const,
  ];
  const rules = await db
    .insert(strategyRules)
    .values(
      statuses.map((status, sortOrder) => ({
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
  await db.insert(tradeRuleChecks).values(
    rules.map((rule, index) => ({
      workspaceId,
      tradeId: firstTradeId,
      strategyRuleId: rule.id,
      strategyVersionId: framework.strategyVersionId,
      ruleKey: rule.ruleKey,
      checkStatus: statuses[index] as (typeof statuses)[number],
      title: `Rule snapshot ${index}`,
      category: 'entry',
      isRequired: true,
      isPreTradeCheck: true,
      sortOrder: rule.sortOrder,
    })),
  );

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
  const archivedAccountId = await createAccount(workspaceId, 'Archived Account', true);
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
    expect(result.data.comparison.comparableCount).toBe(5);
    expect(result.data.trader.winRate).toEqual({ status: 'available', value: '0.7143' });
    expect(result.data.system.winRate).toEqual({ status: 'available', value: '0.5000' });
    expect(result.data.comparison).toMatchObject({
      pairedSystemTotalR: { status: 'available', value: '2.0000' },
      pairedActualTotalR: { status: 'available', value: '1.0000' },
      edgeLeakageR: { status: 'available', value: '1.0000' },
      executionEfficiency: { status: 'available', value: '0.5000' },
    });
    expect(result.data.rules).toEqual({
      followedCount: 8,
      violatedCount: 2,
      notCheckedCount: 1,
      notApplicableCount: 1,
      evaluatedCount: 10,
      adherenceRate: { status: 'available', value: '0.8000' },
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

    const archived = await getAnalyticsSnapshot(
      { datePreset: 'all', tradingAccountId: fixture.archivedAccountId },
      READ_OPTIONS,
    );
    if (!archived.ok) throw new Error(archived.code);
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
      expect(filtered.data.comparison.comparableCount).toBe(4);
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

    await db
      .update(workspaceEntitlements)
      .set({ status: 'active', planKey: 'starter' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const overLimit = await getAnalyticsSnapshot({}, READ_OPTIONS);
    expect(overLimit.ok).toBe(true);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'expired' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const readOnly = await getAnalyticsSnapshot({}, READ_OPTIONS);
    expect(readOnly.ok).toBe(true);
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
});
