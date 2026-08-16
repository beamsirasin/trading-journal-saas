import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  mistakeTypes,
  setups,
  strategies,
  strategyRules,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
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

const {
  getAnalyticsFilterOptions,
  getMistakeAnalyticsRecords,
  getPairedAnalyticsRecords,
  getRuleAnalyticsRecords,
  getSystemAnalyticsRecords,
  getTraderAnalyticsRecords,
  normalizeAnalyticsFilters,
} = await import('./analytics');

const db = getTestDb();
const workspaceIds: string[] = [];
const userIds: string[] = [];
const REFERENCE = new Date('2026-08-09T12:00:00.000Z');
const READ_OPTIONS = { referenceInstant: REFERENCE } as const;

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Analytics User',
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

async function createWorkspace(userId: string, label: string) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: label, slug: `${label}-${crypto.randomUUID()}`, kind: 'personal' })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('workspace insert failed');
  workspaceIds.push(workspace.id);
  await db.insert(workspaceMembers).values({
    workspaceId: workspace.id,
    userId,
    role: 'owner',
  });
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

async function createAccount(workspaceId: string, name: string, archived = false) {
  const [row] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name,
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
      isArchived: archived,
    })
    .returning({ id: tradingAccounts.id });
  if (row === undefined) throw new Error('account insert failed');
  return row.id;
}

interface Framework {
  strategyId: string;
  oldVersionId: string;
  currentVersionId: string;
  setupId: string;
  oldSetupVersionId: string;
  currentSetupVersionId: string;
  rules: readonly { id: string; ruleKey: string; status: string }[];
}

async function createFramework(workspaceId: string, archived = false): Promise<Framework> {
  const [strategy] = await db
    .insert(strategies)
    .values({ workspaceId, isArchived: archived })
    .returning({ id: strategies.id });
  if (strategy === undefined) throw new Error('strategy insert failed');

  const [oldVersion] = await db
    .insert(strategyVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      versionNumber: 1,
      name: 'Historical Strategy Name',
    })
    .returning({ id: strategyVersions.id });
  const [currentVersion] = await db
    .insert(strategyVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      versionNumber: 2,
      name: 'Current Strategy Name',
    })
    .returning({ id: strategyVersions.id });
  if (oldVersion === undefined || currentVersion === undefined) throw new Error('version failed');
  await db
    .update(strategies)
    .set({ currentVersionId: currentVersion.id })
    .where(eq(strategies.id, strategy.id));

  const [setup] = await db
    .insert(setups)
    .values({ workspaceId, strategyId: strategy.id, isArchived: archived })
    .returning({ id: setups.id });
  if (setup === undefined) throw new Error('setup failed');
  const [oldSetup] = await db
    .insert(strategySetupVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      strategyVersionId: oldVersion.id,
      setupId: setup.id,
      name: 'Historical Setup Name',
    })
    .returning({ id: strategySetupVersions.id });
  const [currentSetup] = await db
    .insert(strategySetupVersions)
    .values({
      workspaceId,
      strategyId: strategy.id,
      strategyVersionId: currentVersion.id,
      setupId: setup.id,
      name: 'Current Setup Name',
    })
    .returning({ id: strategySetupVersions.id });
  if (oldSetup === undefined || currentSetup === undefined) throw new Error('setup version failed');

  const statuses = ['followed', 'violated', 'not_checked', 'not_applicable'] as const;
  const rules = [];
  for (const [sortOrder, status] of statuses.entries()) {
    const [rule] = await db
      .insert(strategyRules)
      .values({
        workspaceId,
        strategyVersionId: oldVersion.id,
        ruleKey: crypto.randomUUID(),
        setupVersionId: sortOrder === 3 ? oldSetup.id : null,
        category: 'entry',
        title: `Rule ${status}`,
        isRequired: true,
        isPreTradeCheck: sortOrder % 2 === 0,
        sortOrder,
      })
      .returning({ id: strategyRules.id, ruleKey: strategyRules.ruleKey });
    if (rule === undefined) throw new Error('rule failed');
    rules.push({ ...rule, status });
  }

  return {
    strategyId: strategy.id,
    oldVersionId: oldVersion.id,
    currentVersionId: currentVersion.id,
    setupId: setup.id,
    oldSetupVersionId: oldSetup.id,
    currentSetupVersionId: currentSetup.id,
    rules,
  };
}

interface TradeOverrides {
  accountId?: string;
  status?: 'planned' | 'open' | 'closed' | 'canceled';
  exitedAt?: Date;
  system?: 'pending' | 'resolved' | 'no_trade';
  systemExitedAt?: Date;
  moneyOnlySystem?: boolean;
  deleted?: boolean;
  framework?: Framework;
}

async function createTradeRow(
  workspaceId: string,
  accountId: string,
  framework: Framework,
  overrides: TradeOverrides = {},
) {
  const status = overrides.status ?? 'closed';
  const system = overrides.system ?? 'resolved';
  const exitedAt = overrides.exitedAt ?? new Date('2026-08-01T10:00:00Z');
  const enteredAt =
    status === 'closed'
      ? new Date(exitedAt.getTime() - 60 * 60 * 1000)
      : new Date('2026-08-01T09:00:00Z');
  const systemExitedAt = overrides.systemExitedAt ?? new Date('2026-08-01T11:00:00Z');
  const fw = overrides.framework ?? framework;
  const moneyOnlySystem = overrides.moneyOnlySystem === true;
  const actualFields =
    status === 'planned' || status === 'canceled'
      ? {}
      : {
          actualResultMode: 'money' as const,
          actualEntry: '100.0000000000',
          actualInitialStop: '99.0000000000',
          actualInitialRiskMinor: 100n,
          enteredAt,
          ...(status === 'closed'
            ? {
                actualExit: '101.0000000000',
                netPnlMinor: 100n,
                exitedAt,
                actualR: '1.0000',
                traderOutcome: 'win',
              }
            : {}),
        };
  const systemFields =
    system === 'resolved'
      ? {
          systemStatus: 'resolved',
          systemResolutionKind: moneyOnlySystem ? 'money_target' : 'price_exit',
          systemExitPrice: moneyOnlySystem ? null : '102.0000000000',
          systemGrossRInput: moneyOnlySystem ? '2.0000' : null,
          systemExitedAt,
          systemExitReason: 'target_hit',
          systemResolvedAt: new Date('2026-08-02T00:00:00Z'),
          systemR: '2.0000',
          systemOutcome: 'win',
        }
      : system === 'no_trade'
        ? {
            systemStatus: 'no_trade',
            systemExitReason: 'setup_invalidated',
            systemResolvedAt: new Date('2026-08-02T00:00:00Z'),
          }
        : {};

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(trades)
      .values({
        workspaceId,
        tradingAccountId: overrides.accountId ?? accountId,
        strategyId: fw.strategyId,
        strategyVersionId: fw.oldVersionId,
        setupId: fw.setupId,
        setupVersionId: fw.oldSetupVersionId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedEntry: moneyOnlySystem ? null : '100.0000000000',
        plannedStop: moneyOnlySystem ? null : '99.0000000000',
        plannedTarget: moneyOnlySystem ? null : '102.0000000000',
        plannedRiskMinor: moneyOnlySystem ? 100n : null,
        plannedRewardMinor: moneyOnlySystem ? 200n : null,
        plannedR: '2.0000',
        status,
        deletedAt: overrides.deleted ? new Date('2026-08-03T00:00:00Z') : null,
        ...actualFields,
        ...systemFields,
      })
      .returning({ id: trades.id });
    if (row === undefined) throw new Error('trade failed');
    if (status === 'closed') {
      await tx.insert(tradeExits).values({
        workspaceId,
        tradeId: row.id,
        mutationKey: crypto.randomUUID(),
        sequence: 1,
        closedBps: 10_000,
        exitPrice: '101.0000000000',
        realizedPnlMinor: 100n,
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
  framework: Framework;
  pairedTradeId: string;
  pendingTradeId: string;
  openSystemTradeId: string;
}

async function createFixture(): Promise<Fixture> {
  const userId = await createUser('analytics-dal');
  const workspaceId = await createWorkspace(userId, 'analytics-dal');
  const activeAccountId = await createAccount(workspaceId, 'Active Account');
  const archivedAccountId = await createAccount(workspaceId, 'Archived Account', true);
  await db
    .update(userPreferences)
    .set({ activeTradingAccountId: activeAccountId })
    .where(eq(userPreferences.userId, userId));
  const framework = await createFramework(workspaceId, true);

  const pairedTradeId = await createTradeRow(workspaceId, activeAccountId, framework);
  const pendingTradeId = await createTradeRow(workspaceId, activeAccountId, framework, {
    system: 'pending',
    exitedAt: new Date('2026-08-02T10:00:00Z'),
  });
  const openSystemTradeId = await createTradeRow(workspaceId, activeAccountId, framework, {
    status: 'open',
    system: 'resolved',
    systemExitedAt: new Date('2026-08-03T11:00:00Z'),
  });
  await createTradeRow(workspaceId, activeAccountId, framework, { status: 'planned' });
  await createTradeRow(workspaceId, activeAccountId, framework, { status: 'canceled' });
  await createTradeRow(workspaceId, activeAccountId, framework, { system: 'no_trade' });
  await createTradeRow(workspaceId, activeAccountId, framework, { deleted: true });
  await createTradeRow(workspaceId, archivedAccountId, framework, {
    exitedAt: new Date('2026-08-04T10:00:00Z'),
    systemExitedAt: new Date('2026-08-04T11:00:00Z'),
  });
  await createTradeRow(workspaceId, activeAccountId, framework, {
    exitedAt: new Date('2026-05-12T00:00:00Z'),
    systemExitedAt: new Date('2026-05-12T00:00:00Z'),
  });
  await createTradeRow(workspaceId, activeAccountId, framework, {
    exitedAt: new Date('2026-08-10T00:00:00Z'),
    systemExitedAt: new Date('2026-08-10T00:00:00Z'),
  });
  await createTradeRow(workspaceId, activeAccountId, framework, {
    exitedAt: new Date('2026-08-01T12:00:00Z'),
    systemExitedAt: new Date('2026-04-01T12:00:00Z'),
  });

  for (const rule of framework.rules) {
    await db.insert(tradeRuleChecks).values({
      workspaceId,
      tradeId: pairedTradeId,
      strategyRuleId: rule.id,
      strategyVersionId: framework.oldVersionId,
      ruleKey: rule.ruleKey,
      checkStatus: rule.status,
      title: `Snapshot ${rule.status}`,
      category: 'entry',
      isRequired: true,
      isPreTradeCheck: true,
    });
  }

  const canonical = await db.query.mistakeTypes.findFirst({
    where: eq(mistakeTypes.isSystem, true),
    orderBy: [mistakeTypes.sortOrder],
  });
  if (canonical === undefined) throw new Error('canonical mistake seed missing');
  await db.insert(tradeMistakes).values({
    workspaceId,
    tradeId: pairedTradeId,
    mistakeTypeId: canonical.id,
    severityAtTime: canonical.severity,
    weightAtTime: canonical.defaultWeight,
  });

  currentSession = sessionFor(userId);
  return {
    userId,
    workspaceId,
    activeAccountId,
    archivedAccountId,
    framework,
    pairedTradeId,
    pendingTradeId,
    openSystemTradeId,
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

describe('analytics DAL (real PostgreSQL)', () => {
  it('resolves active/all/archived account scopes and rejects foreign identities without leakage', async () => {
    const fixture = await createFixture();
    expect(await normalizeAnalyticsFilters({}, READ_OPTIONS)).toMatchObject({
      ok: true,
      data: {
        datePreset: '90d',
        accountScope: {
          kind: 'account',
          accountId: fixture.activeAccountId,
          source: 'active',
        },
      },
    });
    expect(
      await normalizeAnalyticsFilters({ tradingAccountId: 'all' }, READ_OPTIONS),
    ).toMatchObject({ ok: true, data: { accountScope: { kind: 'all' } } });
    expect(
      await normalizeAnalyticsFilters(
        { tradingAccountId: fixture.archivedAccountId },
        READ_OPTIONS,
      ),
    ).toMatchObject({
      ok: true,
      data: { accountScope: { accountId: fixture.archivedAccountId, source: 'explicit' } },
    });

    const foreignUser = await createUser('analytics-foreign');
    const foreignWorkspace = await createWorkspace(foreignUser, 'analytics-foreign');
    const foreignAccount = await createAccount(foreignWorkspace, 'Foreign');
    expect(
      await normalizeAnalyticsFilters({ tradingAccountId: foreignAccount }, READ_OPTIONS),
    ).toEqual({ ok: false, code: 'invalid_filters' });
  });

  it('rejects invalid Strategy/Setup and Strategy/Version dependency combinations', async () => {
    const fixture = await createFixture();
    const otherFramework = await createFramework(fixture.workspaceId);
    expect(
      await normalizeAnalyticsFilters(
        { strategyId: fixture.framework.strategyId, setupId: otherFramework.setupId },
        READ_OPTIONS,
      ),
    ).toEqual({ ok: false, code: 'invalid_filters' });
    expect(
      await normalizeAnalyticsFilters(
        {
          strategyId: fixture.framework.strategyId,
          strategyVersionId: otherFramework.oldVersionId,
        },
        READ_OPTIONS,
      ),
    ).toEqual({ ok: false, code: 'invalid_filters' });
    expect(
      await normalizeAnalyticsFilters(
        {
          setupId: otherFramework.setupId,
          strategyVersionId: fixture.framework.oldVersionId,
        },
        READ_OPTIONS,
      ),
    ).toEqual({ ok: false, code: 'invalid_filters' });
  });

  it('returns a typed state instead of choosing an account when no active account exists', async () => {
    const fixture = await createFixture();
    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(eq(tradingAccounts.id, fixture.activeAccountId));
    expect(await normalizeAnalyticsFilters({}, READ_OPTIONS)).toEqual({
      ok: false,
      code: 'no_active_trading_account',
    });
  });

  it('keeps reads available regardless of entitlement mode', async () => {
    const fixture = await createFixture();
    const writable = await getTraderAnalyticsRecords({}, READ_OPTIONS);
    expect(writable.ok && writable.data.length).toBeGreaterThan(0);

    await db
      .update(tradingAccounts)
      .set({ isArchived: false })
      .where(eq(tradingAccounts.id, fixture.archivedAccountId));
    await db
      .update(workspaceEntitlements)
      .set({ status: 'active', planKey: 'starter' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const overLimit = await getTraderAnalyticsRecords({}, READ_OPTIONS);
    expect(overLimit.ok && overLimit.data.length).toBeGreaterThan(0);

    await db
      .update(workspaceEntitlements)
      .set({ status: 'expired' })
      .where(eq(workspaceEntitlements.workspaceId, fixture.workspaceId));
    const readOnly = await getTraderAnalyticsRecords({}, READ_OPTIONS);
    expect(readOnly.ok && readOnly.data.length).toBeGreaterThan(0);
  });

  it('denies the removed member access to the former workspace data', async () => {
    const fixture = await createFixture();
    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, fixture.workspaceId),
          eq(workspaceMembers.userId, fixture.userId),
        ),
      );
    const result = await getTraderAnalyticsRecords({ tradingAccountId: 'all' }, READ_OPTIONS);
    expect(result.ok ? result.data : []).toHaveLength(0);
  });

  it('selects only eligible Trader rows, including System-pending, with exact range boundaries', async () => {
    const fixture = await createFixture();
    const result = await getTraderAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const ids = result.data.map((row) => row.tradeId);
    expect(ids).toContain(fixture.pairedTradeId);
    expect(ids).toContain(fixture.pendingTradeId);
    expect(ids).not.toContain(fixture.openSystemTradeId);
    expect(result.data.some((row) => row.exitedAt === '2026-05-12T00:00:00.000Z')).toBe(true);
    expect(result.data.some((row) => row.exitedAt === '2026-08-10T00:00:00.000Z')).toBe(false);
    expect(result.data.every((row) => row.deletedAt === null && row.status === 'closed')).toBe(
      true,
    );
  });

  it('selects resolved System rows independently of execution status and applies System time', async () => {
    const fixture = await createFixture();
    const result = await getSystemAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const ids = result.data.map((row) => row.tradeId);
    expect(ids).toContain(fixture.pairedTradeId);
    expect(ids).toContain(fixture.openSystemTradeId);
    expect(ids).not.toContain(fixture.pendingTradeId);
    expect(result.data.every((row) => row.systemStatus === 'resolved')).toBe(true);
  });

  it('includes Money-only resolved System snapshots in the existing System population', async () => {
    const fixture = await createFixture();
    const moneyTradeId = await createTradeRow(
      fixture.workspaceId,
      fixture.activeAccountId,
      fixture.framework,
      { status: 'open', system: 'resolved', moneyOnlySystem: true },
    );
    const result = await getSystemAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    expect(result.data).toContainEqual(
      expect.objectContaining({ tradeId: moneyTradeId, systemR: '2.0000', systemOutcome: 'win' }),
    );
  });

  it('selects exact same-Trade pairs and requires both bounded timestamps', async () => {
    const fixture = await createFixture();
    const result = await getPairedAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.map((row) => row.tradeId)).toContain(fixture.pairedTradeId);
    expect(result.data.map((row) => row.tradeId)).not.toContain(fixture.openSystemTradeId);
    expect(
      result.data.some(
        (row) =>
          row.actualExitedAt === '2026-08-01T12:00:00.000Z' &&
          row.systemExitedAt === '2026-04-01T12:00:00.000Z',
      ),
    ).toBe(false);
    expect(result.data.every((row) => row.actualR !== '' && row.systemR !== '')).toBe(true);
  });

  it('retains all four Rule statuses on the closed-Trader axis without exposing Rule row IDs', async () => {
    const fixture = await createFixture();
    const result = await getRuleAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const rows = result.data.filter((row) => row.tradeId === fixture.pairedTradeId);
    expect(rows.map((row) => row.checkStatus).sort()).toEqual([
      'followed',
      'not_applicable',
      'not_checked',
      'violated',
    ]);
    expect(rows.map((row) => row.scope).sort()).toEqual([
      'setup',
      'strategy',
      'strategy',
      'strategy',
    ]);
    expect(rows.every((row) => !('strategyRuleId' in row) && !('title' in row))).toBe(true);
  });

  it('returns canonical count-ready Mistakes with no R, leakage, severity, or weight fields', async () => {
    const fixture = await createFixture();
    const result = await getMistakeAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const row = result.data.find((candidate) => candidate.tradeId === fixture.pairedTradeId);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('actualR');
    expect(row).not.toHaveProperty('systemR');
    expect(row).not.toHaveProperty('severityAtTime');
    expect(row).not.toHaveProperty('weightAtTime');
    await expect(
      db.insert(tradeMistakes).values({
        workspaceId: fixture.workspaceId,
        tradeId: row?.tradeId as string,
        mistakeTypeId: row?.mistakeTypeId as string,
        severityAtTime: 'moderate',
        weightAtTime: '1.0000',
      }),
    ).rejects.toThrow();
  });

  it('returns archived historical selectors with deterministic current labels and Version history', async () => {
    const fixture = await createFixture();
    const options = await getAnalyticsFilterOptions();
    expect(options.accounts).toContainEqual({
      tradingAccountId: fixture.archivedAccountId,
      name: 'Archived Account',
      isArchived: true,
    });
    expect(options.strategies).toContainEqual({
      strategyId: fixture.framework.strategyId,
      label: 'Current Strategy Name',
      isArchived: true,
    });
    expect(options.setups).toContainEqual({
      setupId: fixture.framework.setupId,
      strategyId: fixture.framework.strategyId,
      label: 'Current Setup Name',
      isArchived: true,
    });
    expect(options.strategyVersions).toContainEqual({
      strategyVersionId: fixture.framework.oldVersionId,
      strategyId: fixture.framework.strategyId,
      versionNumber: 1,
      strategyName: 'Historical Strategy Name',
    });

    await db
      .update(strategies)
      .set({ currentVersionId: null })
      .where(eq(strategies.id, fixture.framework.strategyId));
    const fallbackOptions = await getAnalyticsFilterOptions();
    expect(fallbackOptions.strategies).toContainEqual({
      strategyId: fixture.framework.strategyId,
      label: 'Historical Strategy Name',
      isArchived: true,
    });
    expect(fallbackOptions.setups).toContainEqual({
      setupId: fixture.framework.setupId,
      strategyId: fixture.framework.strategyId,
      label: 'Historical Setup Name',
      isArchived: true,
    });
  });

  it('applies account, Strategy, Setup, and Version filters to every projection', async () => {
    const fixture = await createFixture();
    const input = {
      datePreset: 'all' as const,
      tradingAccountId: fixture.activeAccountId,
      strategyId: fixture.framework.strategyId,
      setupId: fixture.framework.setupId,
      strategyVersionId: fixture.framework.oldVersionId,
    };
    for (const read of [
      getTraderAnalyticsRecords,
      getSystemAnalyticsRecords,
      getPairedAnalyticsRecords,
      getRuleAnalyticsRecords,
      getMistakeAnalyticsRecords,
    ]) {
      const result = await read(input, READ_OPTIONS);
      if (!result.ok) throw new Error(result.code);
      expect(result.data.length).toBeGreaterThan(0);
      expect(
        result.data.every(
          (row) =>
            row.tradingAccountId === fixture.activeAccountId &&
            row.strategyId === fixture.framework.strategyId &&
            row.setupId === fixture.framework.setupId &&
            row.strategyVersionId === fixture.framework.oldVersionId,
        ),
      ).toBe(true);
    }
  });
});
