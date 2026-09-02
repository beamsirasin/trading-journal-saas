import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { selectComparisonEligible } from '@/lib/calc/attribution';
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
import { activePaidPeriod } from '@/test/entitlement-fixtures';
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
  DASHBOARD_MAJOR_PROJECTION_COUNT,
  getAnalyticsFilterOptions,
  getConditionAnalyticsRecords,
  getConditionSystemAnalyticsRecords,
  getConfidenceAnalyticsRecords,
  getConfidenceSystemAnalyticsRecords,
  getEmotionAnalyticsRecords,
  getEmotionSystemAnalyticsRecords,
  getDashboardRawData,
  getMistakeAnalyticsRecords,
  getPairedAnalyticsRecords,
  getRuleAnalyticsRecords,
  getSetupAdherenceAnalyticsRecords,
  getSetupAdherenceSystemAnalyticsRecords,
  getSystemAnalyticsRecords,
  getSystemPendingCount,
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
    ...activePaidPeriod(),
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
  createdAt?: Date;
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
        createdAt: overrides.createdAt ?? new Date(enteredAt.getTime() - 60 * 60 * 1000),
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

  it('Phase 15D: Trader rows also carry Symbol/Direction/Session/Timeframe from the same already-eligible query, Session/Timeframe null when never set', async () => {
    const fixture = await createFixture();
    const result = await getTraderAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const paired = result.data.find((row) => row.tradeId === fixture.pairedTradeId);
    expect(paired?.symbol).toBe('EURUSD');
    expect(paired?.direction).toBe('long');
    expect(paired?.session).toBeNull();
    expect(paired?.timeframe).toBeNull();
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

  it('anchors bounded pairs to Actual exit while retaining System exit as metadata', async () => {
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
    ).toBe(true);
    expect(
      result.data.every(
        (row) =>
          row.status === 'closed' &&
          row.deletedAt === null &&
          row.actualR !== '' &&
          row.traderOutcome !== null &&
          row.actualExitedAt !== '' &&
          row.systemStatus === 'resolved' &&
          row.systemR !== '' &&
          row.systemOutcome !== null &&
          row.systemExitedAt !== '',
      ),
    ).toBe(true);
  });

  it('includes Actual-in/System-out, excludes Actual-out/System-in, and orders timestamp ties by Trade ID', async () => {
    const fixture = await createFixture();
    const actualInSystemOut = await createTradeRow(
      fixture.workspaceId,
      fixture.activeAccountId,
      fixture.framework,
      {
        exitedAt: new Date('2026-08-06T10:00:00Z'),
        systemExitedAt: new Date('2026-04-01T11:00:00Z'),
      },
    );
    const actualOutSystemIn = await createTradeRow(
      fixture.workspaceId,
      fixture.activeAccountId,
      fixture.framework,
      {
        exitedAt: new Date('2026-04-01T10:00:00Z'),
        systemExitedAt: new Date('2026-08-06T11:00:00Z'),
      },
    );
    const tiedAt = new Date('2026-08-09T10:00:00Z');
    const tiedIds = await Promise.all([
      createTradeRow(fixture.workspaceId, fixture.activeAccountId, fixture.framework, {
        exitedAt: tiedAt,
        systemExitedAt: new Date('2026-08-09T11:00:00Z'),
      }),
      createTradeRow(fixture.workspaceId, fixture.activeAccountId, fixture.framework, {
        exitedAt: tiedAt,
        systemExitedAt: new Date('2026-03-09T11:00:00Z'),
      }),
    ]);

    const result = await getPairedAnalyticsRecords({}, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const ids = result.data.map((row) => row.tradeId);
    expect(ids).toContain(actualInSystemOut);
    expect(ids).not.toContain(actualOutSystemIn);
    expect(ids.filter((id) => tiedIds.includes(id))).toEqual([...tiedIds].sort());
  });

  /**
   * THE HAZARD THE `not(actualComplete)` CLAUSE EXISTS FOR.
   *
   * The candidate query is Population A ∪ B, and the two halves are gated on
   * different date columns: an Actual-complete candidate by `exited_at`, a
   * System-only candidate by `system_exited_at`, because a Trade that has not
   * exited has no Actual exit to be anchored by.
   *
   * A fully paired Trade sits in both halves, and its `system_exited_at` can
   * fall inside a range its `exited_at` falls outside. Without the negation
   * on the second clause that Trade would enter the candidate set through the
   * System door — and `isComparisonEligible`, which knows nothing about
   * dates, would then admit it to Population C. The paired totals would
   * silently gain a Trade that closed in April from a window that starts in
   * May.
   *
   * So this asserts the bundle, not the focused reader: the focused reader
   * would keep passing on the strength of its own filter while the Dashboard
   * quietly counted an extra Trade.
   */
  it('keeps a paired Trade whose Actual exit is outside the range but whose System exit is inside it out of the Dashboard bundle', async () => {
    const fixture = await createFixture();
    const actualOutSystemIn = await createTradeRow(
      fixture.workspaceId,
      fixture.activeAccountId,
      fixture.framework,
      {
        exitedAt: new Date('2026-04-01T10:00:00Z'),
        systemExitedAt: new Date('2026-08-06T11:00:00Z'),
      },
    );

    const dashboard = await getDashboardRawData({}, READ_OPTIONS);
    if (!dashboard.ok) throw new Error(dashboard.code);

    // It is complete on both axes, so it is genuinely pairable — it is only
    // the RANGE that excludes it, which is the part a date-blind predicate
    // cannot see.
    expect(
      selectComparisonEligible(dashboard.data.comparisonCandidates).map((row) => row.tradeId),
    ).not.toContain(actualOutSystemIn);
    expect(dashboard.data.comparisonCandidates.map((row) => row.tradeId)).not.toContain(
      actualOutSystemIn,
    );
  });

  it('D2 narrow Dashboard bundle preserves canonical A/B/C rows without deep projections', async () => {
    await createFixture();
    const [dashboard, trader, system, paired] = await Promise.all([
      getDashboardRawData({}, READ_OPTIONS),
      getTraderAnalyticsRecords({}, READ_OPTIONS),
      getSystemAnalyticsRecords({}, READ_OPTIONS),
      getPairedAnalyticsRecords({}, READ_OPTIONS),
    ]);
    if (!dashboard.ok) throw new Error(dashboard.code);
    if (!trader.ok) throw new Error(trader.code);
    if (!system.ok) throw new Error(system.code);
    if (!paired.ok) throw new Error(paired.code);

    expect(DASHBOARD_MAJOR_PROJECTION_COUNT).toBe(5);
    expect(dashboard.data.trader.map((row) => row.tradeId)).toEqual(
      trader.data.map((row) => row.tradeId),
    );
    expect(dashboard.data.system.map((row) => row.tradeId)).toEqual(
      system.data.map((row) => row.tradeId),
    );
    // The bundle now carries CANDIDATES (Population A union B) and
    // `isComparisonEligible` narrows them, so the equality that matters is
    // between the narrowed set and the focused reader — not between two
    // pre-filtered lists, which is what this asserted while the predicate
    // was written twice.
    expect(
      selectComparisonEligible(dashboard.data.comparisonCandidates).map((row) => row.tradeId),
    ).toEqual(paired.data.map((row) => row.tradeId));
    // And the superset really is one: the System-resolved open Trade is a
    // candidate the focused reader excludes, which is exactly the row the
    // Dashboard needs in order to say why a total differs.
    expect(dashboard.data.comparisonCandidates.length).toBeGreaterThan(paired.data.length);
    expect(dashboard.data).not.toHaveProperty('rules');
    expect(dashboard.data).not.toHaveProperty('mistakes');
    expect(dashboard.data).not.toHaveProperty('conditions');
    expect(dashboard.data).not.toHaveProperty('confidence');
    expect(dashboard.data).not.toHaveProperty('emotions');
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

  describe('getSystemPendingCount (Phase 14C §19)', () => {
    it('counts only System-pending Trades in the resolved account/Strategy/Setup scope', async () => {
      await createFixture();
      const result = await getSystemPendingCount({}, READ_OPTIONS);
      if (!result.ok) throw new Error(result.code);
      expect(result.data).toBe(1);
    });

    it('respects the account scope filter — an archived-only scope excludes the active account’s pending Trade', async () => {
      const fixture = await createFixture();
      const archivedScoped = await getSystemPendingCount(
        { tradingAccountId: fixture.archivedAccountId },
        READ_OPTIONS,
      );
      if (!archivedScoped.ok) throw new Error(archivedScoped.code);
      expect(archivedScoped.data).toBe(0);
    });

    it('respects Strategy/Setup filters the same way every other framework-scoped projection does', async () => {
      const fixture = await createFixture();
      const scoped = await getSystemPendingCount(
        { strategyId: fixture.framework.strategyId, setupId: fixture.framework.setupId },
        READ_OPTIONS,
      );
      if (!scoped.ok) throw new Error(scoped.code);
      expect(scoped.data).toBe(1);
    });

    it('is deliberately NOT bounded by the Date filter — a pending Trade has no System-eligible date to bound it by', async () => {
      await createFixture();
      // A 30-day window nearly a year after the pending Trade's own
      // `exited_at` (2026-08-02), so the window excludes that date entirely.
      // Per Phase 14C §19, this count reflects "how many pending in this
      // scope," not "how many within this date range" — so it must be
      // unaffected by the window.
      const farFutureWindow = { referenceInstant: new Date('2027-06-01T00:00:00.000Z') } as const;
      const result = await getSystemPendingCount({ datePreset: '30d' }, farFutureWindow);
      if (!result.ok) throw new Error(result.code);
      expect(result.data).toBe(1);
    });
  });
});

describe('Phase 13H — Setup Adherence / Condition / Confidence / Emotion analytics DAL (real PostgreSQL)', () => {
  async function setupWorkspace() {
    const userId = await createUser('analytics-13h');
    const workspaceId = await createWorkspace(userId, 'analytics-13h');
    const accountId = await createAccount(workspaceId, 'Active Account');
    await db
      .update(userPreferences)
      .set({ activeTradingAccountId: accountId })
      .where(eq(userPreferences.userId, userId));
    const framework = await createFramework(workspaceId, false);
    currentSession = sessionFor(userId);
    return { userId, workspaceId, accountId, framework };
  }

  async function addConditionCheck(
    workspaceId: string,
    tradeId: string,
    setupConditionId: string,
    setupVersionId: string,
    conditionKey: string,
    label: string,
    sortOrder: number,
    checkStatus: 'met' | 'not_met',
  ) {
    await db.insert(tradeSetupConditionChecks).values({
      workspaceId,
      tradeId,
      setupConditionId,
      setupVersionId,
      conditionKey,
      label,
      sortOrder,
      checkStatus,
    });
  }

  it('derives correct per-Trade met/total counts, and condition_key grouping survives Setup Version copy-on-write', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();

    // Two Conditions on the OLD (pinned) Setup Version.
    const [conditionOld1] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    const [conditionOld2] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Volume confirms breakout',
        sortOrder: 1,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (conditionOld1 === undefined || conditionOld2 === undefined) {
      throw new Error('condition insert failed');
    }

    // The SAME logical Condition (same condition_key), carried forward onto
    // the CURRENT Setup Version under a renamed label — simulating a COW
    // edit, per `PHASE-13-journal-v2.md`'s documented copy-forward behavior.
    const [conditionRenamed] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.currentSetupVersionId,
        conditionKey: conditionOld1.conditionKey,
        label: 'Above the 200 EMA (renamed)',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id });
    if (conditionRenamed === undefined) throw new Error('condition insert failed');

    // Trade A: 1/2 met, pinned to the OLD Setup Version.
    const tradeA = await createTradeRow(workspaceId, accountId, framework);
    await addConditionCheck(
      workspaceId,
      tradeA,
      conditionOld1.id,
      framework.oldSetupVersionId,
      conditionOld1.conditionKey,
      'Above the 200 EMA',
      0,
      'met',
    );
    await addConditionCheck(
      workspaceId,
      tradeA,
      conditionOld2.id,
      framework.oldSetupVersionId,
      conditionOld2.conditionKey,
      'Volume confirms breakout',
      1,
      'not_met',
    );

    // Trade B: 2/2 met, also pinned to the OLD Setup Version.
    const tradeB = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-02T10:00:00Z'),
    });
    await addConditionCheck(
      workspaceId,
      tradeB,
      conditionOld1.id,
      framework.oldSetupVersionId,
      conditionOld1.conditionKey,
      'Above the 200 EMA',
      0,
      'met',
    );
    await addConditionCheck(
      workspaceId,
      tradeB,
      conditionOld2.id,
      framework.oldSetupVersionId,
      conditionOld2.conditionKey,
      'Volume confirms breakout',
      1,
      'met',
    );

    // Trade C: pinned to the CURRENT (renamed) Setup Version, same condition_key as conditionOld1.
    const tradeC = await createTradeRow(
      workspaceId,
      accountId,
      {
        ...framework,
        oldVersionId: framework.currentVersionId,
        oldSetupVersionId: framework.currentSetupVersionId,
      },
      { exitedAt: new Date('2026-08-03T10:00:00Z') },
    );
    await addConditionCheck(
      workspaceId,
      tradeC,
      conditionRenamed.id,
      framework.currentSetupVersionId,
      conditionOld1.conditionKey,
      'Above the 200 EMA (renamed)',
      0,
      'not_met',
    );

    const adherence = await getSetupAdherenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS);
    if (!adherence.ok) throw new Error(adherence.code);
    const byTrade = new Map(adherence.data.map((r) => [r.tradeId, r]));
    expect(byTrade.get(tradeA)).toMatchObject({ metCount: 1, totalCount: 2 });
    expect(byTrade.get(tradeB)).toMatchObject({ metCount: 2, totalCount: 2 });
    expect(byTrade.get(tradeC)).toMatchObject({ metCount: 0, totalCount: 1 });

    const conditions = await getConditionAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS);
    if (!conditions.ok) throw new Error(conditions.code);
    // The same condition_key across two Setup Versions groups into one
    // logical Condition (3 rows: A-met, B-met, C-not_met), never split by
    // setup_version_id, and never merged with the unrelated second Condition.
    const sharedKeyRows = conditions.data.filter(
      (r) => r.conditionKey === conditionOld1.conditionKey,
    );
    expect(sharedKeyRows).toHaveLength(3);
    expect(sharedKeyRows.filter((r) => r.checkStatus === 'met')).toHaveLength(2);
    expect(sharedKeyRows.filter((r) => r.checkStatus === 'not_met')).toHaveLength(1);
    expect(new Set(sharedKeyRows.map((r) => r.setupId))).toEqual(new Set([framework.setupId]));
    // The most recent snapshot (Trade C, latest exitedAt) carries the renamed label truthfully.
    const mostRecent = [...sharedKeyRows]
      .sort((a, b) => a.exitedAt.localeCompare(b.exitedAt))
      .at(-1);
    expect(mostRecent?.label).toBe('Above the 200 EMA (renamed)');

    const otherKeyRows = conditions.data.filter(
      (r) => r.conditionKey === conditionOld2.conditionKey,
    );
    expect(otherKeyRows).toHaveLength(2);
  });

  it('excludes a still-open Trade from Setup Adherence, Confidence, and Emotion analytics even when it has recorded data', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');

    const openTradeId = await createTradeRow(workspaceId, accountId, framework, { status: 'open' });
    await addConditionCheck(
      workspaceId,
      openTradeId,
      condition.id,
      framework.oldSetupVersionId,
      condition.conditionKey,
      'Above the 200 EMA',
      0,
      'met',
    );
    await db.update(trades).set({ confidence: 75 }).where(eq(trades.id, openTradeId));
    const emotion = await db.query.emotionTypes.findFirst({
      where: eq(emotionTypes.isSystem, true),
    });
    if (emotion === undefined) throw new Error('canonical emotion seed missing');
    await db
      .insert(tradeEmotions)
      .values({ workspaceId, tradeId: openTradeId, emotionTypeId: emotion.id });

    const [adherence, confidence, emotions] = await Promise.all([
      getSetupAdherenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getConfidenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getEmotionAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!adherence.ok || !confidence.ok || !emotions.ok) throw new Error('read failed');
    expect(adherence.data.some((r) => r.tradeId === openTradeId)).toBe(false);
    expect(confidence.data.some((r) => r.tradeId === openTradeId)).toBe(false);
    expect(emotions.data.some((r) => r.tradeId === openTradeId)).toBe(false);
  });

  it('Confidence: excludes NULL, includes 0 as a real recorded value', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const zeroConfidenceTrade = await createTradeRow(workspaceId, accountId, framework);
    await db.update(trades).set({ confidence: 0 }).where(eq(trades.id, zeroConfidenceTrade));
    const unrecordedTrade = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-02T10:00:00Z'),
    });

    const result = await getConfidenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    expect(result.data.some((r) => r.tradeId === zeroConfidenceTrade && r.confidence === 0)).toBe(
      true,
    );
    expect(result.data.some((r) => r.tradeId === unrecordedTrade)).toBe(false);
  });

  it('Emotion: a multi-Emotion Trade produces one row per link, and a recorded-zero Trade contributes no rows', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const catalog = await db.query.emotionTypes.findMany({
      where: eq(emotionTypes.isSystem, true),
      limit: 2,
    });
    expect(catalog.length).toBeGreaterThanOrEqual(2);
    const [first, second] = catalog;
    if (first === undefined || second === undefined) throw new Error('emotion catalog too small');

    const multiEmotionTrade = await createTradeRow(workspaceId, accountId, framework);
    await db
      .update(trades)
      .set({ emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
      .where(eq(trades.id, multiEmotionTrade));
    await db.insert(tradeEmotions).values([
      { workspaceId, tradeId: multiEmotionTrade, emotionTypeId: first.id },
      { workspaceId, tradeId: multiEmotionTrade, emotionTypeId: second.id },
    ]);

    // Recorded, explicitly zero Emotions selected — must contribute nothing.
    const recordedZeroTrade = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-02T10:00:00Z'),
    });
    await db
      .update(trades)
      .set({ emotionsRecordedAt: new Date('2026-08-02T09:00:00Z') })
      .where(eq(trades.id, recordedZeroTrade));

    const result = await getEmotionAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS);
    if (!result.ok) throw new Error(result.code);
    const forMultiEmotionTrade = result.data.filter((r) => r.tradeId === multiEmotionTrade);
    expect(forMultiEmotionTrade).toHaveLength(2);
    expect(new Set(forMultiEmotionTrade.map((r) => r.key))).toEqual(
      new Set([first.key, second.key]),
    );
    expect(result.data.some((r) => r.tradeId === recordedZeroTrade)).toBe(false);
  });

  it('Setup Adherence: independent Trader/System populations — both / System-only (partial-open Actual) / Trader-only (System pending)', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');
    const authoritative = condition;
    async function withCondition(tradeId: string, status: 'met' | 'not_met' = 'met') {
      await addConditionCheck(
        workspaceId,
        tradeId,
        authoritative.id,
        framework.oldSetupVersionId,
        authoritative.conditionKey,
        'Above the 200 EMA',
        0,
        status,
      );
    }

    // A: fully closed Actual + resolved System — contributes to BOTH.
    const bothTradeId = await createTradeRow(workspaceId, accountId, framework);
    await withCondition(bothTradeId);
    // B: Actual still open/partial, System independently resolved — System only.
    const systemOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      status: 'open',
      system: 'resolved',
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });
    await withCondition(systemOnlyTradeId);
    // C: Actual closed, System still pending — Trader only.
    const traderOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-03T10:00:00Z'),
      system: 'pending',
    });
    await withCondition(traderOnlyTradeId);

    const [traderResult, systemResult] = await Promise.all([
      getSetupAdherenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getSetupAdherenceSystemAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!traderResult.ok || !systemResult.ok) throw new Error('read failed');
    const traderIds = new Set(traderResult.data.map((r) => r.tradeId));
    const systemIds = new Set(systemResult.data.map((r) => r.tradeId));

    expect(traderIds.has(bothTradeId)).toBe(true);
    expect(systemIds.has(bothTradeId)).toBe(true);
    expect(traderIds.has(systemOnlyTradeId)).toBe(false);
    expect(systemIds.has(systemOnlyTradeId)).toBe(true);
    expect(traderIds.has(traderOnlyTradeId)).toBe(true);
    expect(systemIds.has(traderOnlyTradeId)).toBe(false);
  });

  it('Condition: independent Trader/System populations — both / System-only / Trader-only, and Money-only System resolutions are included', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Volume confirms breakout',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');
    const authoritative = condition;
    async function withCondition(tradeId: string) {
      await addConditionCheck(
        workspaceId,
        tradeId,
        authoritative.id,
        framework.oldSetupVersionId,
        authoritative.conditionKey,
        'Volume confirms breakout',
        0,
        'met',
      );
    }

    const bothTradeId = await createTradeRow(workspaceId, accountId, framework);
    await withCondition(bothTradeId);
    const systemOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      status: 'open',
      system: 'resolved',
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });
    await withCondition(systemOnlyTradeId);
    const traderOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-03T10:00:00Z'),
      system: 'pending',
    });
    await withCondition(traderOnlyTradeId);
    // Money-only System resolution (no `system_exit_price`) must be included
    // in the System-side Condition read exactly like a Price resolution.
    const moneyOnlySystemTradeId = await createTradeRow(workspaceId, accountId, framework, {
      status: 'open',
      system: 'resolved',
      moneyOnlySystem: true,
      systemExitedAt: new Date('2026-08-04T11:00:00Z'),
    });
    await withCondition(moneyOnlySystemTradeId);

    const [traderResult, systemResult] = await Promise.all([
      getConditionAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getConditionSystemAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!traderResult.ok || !systemResult.ok) throw new Error('read failed');
    const traderIds = new Set(traderResult.data.map((r) => r.tradeId));
    const systemIds = new Set(systemResult.data.map((r) => r.tradeId));

    expect(traderIds.has(bothTradeId)).toBe(true);
    expect(systemIds.has(bothTradeId)).toBe(true);
    expect(traderIds.has(systemOnlyTradeId)).toBe(false);
    expect(systemIds.has(systemOnlyTradeId)).toBe(true);
    expect(traderIds.has(traderOnlyTradeId)).toBe(true);
    expect(systemIds.has(traderOnlyTradeId)).toBe(false);
    expect(systemIds.has(moneyOnlySystemTradeId)).toBe(true);
  });

  it('Confidence: independent Trader/System populations — both / System-only (partial-open Actual) / Trader-only (System pending)', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const bothTradeId = await createTradeRow(workspaceId, accountId, framework);
    await db.update(trades).set({ confidence: 50 }).where(eq(trades.id, bothTradeId));
    const systemOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      status: 'open',
      system: 'resolved',
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });
    await db.update(trades).set({ confidence: 75 }).where(eq(trades.id, systemOnlyTradeId));
    const traderOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-03T10:00:00Z'),
      system: 'pending',
    });
    await db.update(trades).set({ confidence: 25 }).where(eq(trades.id, traderOnlyTradeId));

    const [traderResult, systemResult] = await Promise.all([
      getConfidenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getConfidenceSystemAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!traderResult.ok || !systemResult.ok) throw new Error('read failed');
    const traderIds = new Set(traderResult.data.map((r) => r.tradeId));
    const systemIds = new Set(systemResult.data.map((r) => r.tradeId));

    expect(traderIds.has(bothTradeId)).toBe(true);
    expect(systemIds.has(bothTradeId)).toBe(true);
    expect(traderIds.has(systemOnlyTradeId)).toBe(false);
    expect(systemIds.has(systemOnlyTradeId)).toBe(true);
    expect(traderIds.has(traderOnlyTradeId)).toBe(true);
    expect(systemIds.has(traderOnlyTradeId)).toBe(false);
  });

  it('Emotion: independent Trader/System populations — both / System-only (partial-open Actual) / Trader-only (System pending)', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const emotion = await db.query.emotionTypes.findFirst({
      where: eq(emotionTypes.isSystem, true),
    });
    if (emotion === undefined) throw new Error('canonical emotion seed missing');
    const authoritative = emotion;
    async function withEmotion(tradeId: string) {
      await db
        .update(trades)
        .set({ emotionsRecordedAt: new Date('2026-08-01T09:00:00Z') })
        .where(eq(trades.id, tradeId));
      await db
        .insert(tradeEmotions)
        .values({ workspaceId, tradeId, emotionTypeId: authoritative.id });
    }

    const bothTradeId = await createTradeRow(workspaceId, accountId, framework);
    await withEmotion(bothTradeId);
    const systemOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      status: 'open',
      system: 'resolved',
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });
    await withEmotion(systemOnlyTradeId);
    const traderOnlyTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-03T10:00:00Z'),
      system: 'pending',
    });
    await withEmotion(traderOnlyTradeId);

    const [traderResult, systemResult] = await Promise.all([
      getEmotionAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getEmotionSystemAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!traderResult.ok || !systemResult.ok) throw new Error('read failed');
    const traderIds = new Set(traderResult.data.map((r) => r.tradeId));
    const systemIds = new Set(systemResult.data.map((r) => r.tradeId));

    expect(traderIds.has(bothTradeId)).toBe(true);
    expect(systemIds.has(bothTradeId)).toBe(true);
    expect(traderIds.has(systemOnlyTradeId)).toBe(false);
    expect(systemIds.has(systemOnlyTradeId)).toBe(true);
    expect(traderIds.has(traderOnlyTradeId)).toBe(true);
    expect(systemIds.has(traderOnlyTradeId)).toBe(false);
  });

  it('date axes are never shared between Trader and System reads — exited_at outside range + system_exited_at inside => System only, and the reverse => Trader only', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');
    const authoritative = condition;
    async function withCondition(tradeId: string) {
      await addConditionCheck(
        workspaceId,
        tradeId,
        authoritative.id,
        framework.oldSetupVersionId,
        authoritative.conditionKey,
        'Above the 200 EMA',
        0,
        'met',
      );
    }

    // Trader exited_at OUTSIDE the selected range (July), system_exited_at INSIDE (August).
    const systemOnlyByDateTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-07-01T10:00:00Z'),
      systemExitedAt: new Date('2026-08-15T11:00:00Z'),
    });
    await withCondition(systemOnlyByDateTradeId);
    // The reverse: exited_at INSIDE the range (August), system_exited_at OUTSIDE (July).
    const traderOnlyByDateTradeId = await createTradeRow(workspaceId, accountId, framework, {
      exitedAt: new Date('2026-08-16T10:00:00Z'),
      systemExitedAt: new Date('2026-07-02T11:00:00Z'),
    });
    await withCondition(traderOnlyByDateTradeId);

    // `datePreset` alone cannot express an arbitrary custom range in this
    // filter contract, so this proof uses a 30D window via a fixed
    // `referenceInstant` — the window's own Trader read must never "borrow"
    // a row whose System-eligible date falls inside it but whose own
    // `exited_at` does not, and vice versa.
    const augustWindow = { referenceInstant: new Date('2026-08-20T00:00:00.000Z') } as const;
    const [traderAugust, systemAugust] = await Promise.all([
      getSetupAdherenceAnalyticsRecords({ datePreset: '30d' }, augustWindow),
      getSetupAdherenceSystemAnalyticsRecords({ datePreset: '30d' }, augustWindow),
    ]);
    if (!traderAugust.ok || !systemAugust.ok) throw new Error('read failed');
    const traderAugustIds = new Set(traderAugust.data.map((r) => r.tradeId));
    const systemAugustIds = new Set(systemAugust.data.map((r) => r.tradeId));

    // Within the August 30D window: the System-side row (system_exited_at
    // in August) appears in System, NOT Trader (its own exited_at is July,
    // outside this window). The Trader-side row (exited_at in August)
    // appears in Trader, NOT System (its own system_exited_at is July).
    expect(systemAugustIds.has(systemOnlyByDateTradeId)).toBe(true);
    expect(traderAugustIds.has(systemOnlyByDateTradeId)).toBe(false);
    expect(traderAugustIds.has(traderOnlyByDateTradeId)).toBe(true);
    expect(systemAugustIds.has(traderOnlyByDateTradeId)).toBe(false);
  });

  it('applies account, Strategy, Setup, and Version filters independently to every Trader/System behavioral projection', async () => {
    const { workspaceId, accountId, framework } = await setupWorkspace();
    const otherAccountId = await createAccount(workspaceId, 'Other account');
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId,
        setupId: framework.setupId,
        setupVersionId: framework.oldSetupVersionId,
        label: 'Above the 200 EMA',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');

    const inScopeTradeId = await createTradeRow(workspaceId, accountId, framework);
    await addConditionCheck(
      workspaceId,
      inScopeTradeId,
      condition.id,
      framework.oldSetupVersionId,
      condition.conditionKey,
      'Above the 200 EMA',
      0,
      'met',
    );
    await db.update(trades).set({ confidence: 50 }).where(eq(trades.id, inScopeTradeId));
    const outOfScopeTradeId = await createTradeRow(workspaceId, otherAccountId, framework, {
      exitedAt: new Date('2026-08-02T10:00:00Z'),
      systemExitedAt: new Date('2026-08-02T11:00:00Z'),
    });
    await db.update(trades).set({ confidence: 50 }).where(eq(trades.id, outOfScopeTradeId));

    const input = { datePreset: 'all' as const, tradingAccountId: accountId };
    const [traderConfidence, systemConfidence] = await Promise.all([
      getConfidenceAnalyticsRecords(input, READ_OPTIONS),
      getConfidenceSystemAnalyticsRecords(input, READ_OPTIONS),
    ]);
    if (!traderConfidence.ok || !systemConfidence.ok) throw new Error('read failed');
    expect(traderConfidence.data.some((r) => r.tradeId === outOfScopeTradeId)).toBe(false);
    expect(systemConfidence.data.some((r) => r.tradeId === outOfScopeTradeId)).toBe(false);
    expect(traderConfidence.data.some((r) => r.tradeId === inScopeTradeId)).toBe(true);
    expect(systemConfidence.data.some((r) => r.tradeId === inScopeTradeId)).toBe(true);
  });

  it('never aggregates Setup Adherence, Condition, Confidence, or Emotion analytics across workspaces', async () => {
    const first = await setupWorkspace();
    const [condition] = await db
      .insert(setupConditions)
      .values({
        workspaceId: first.workspaceId,
        setupId: first.framework.setupId,
        setupVersionId: first.framework.oldSetupVersionId,
        label: 'Workspace-one Condition',
        sortOrder: 0,
      })
      .returning({ id: setupConditions.id, conditionKey: setupConditions.conditionKey });
    if (condition === undefined) throw new Error('condition insert failed');
    const firstTradeId = await createTradeRow(first.workspaceId, first.accountId, first.framework);
    await addConditionCheck(
      first.workspaceId,
      firstTradeId,
      condition.id,
      first.framework.oldSetupVersionId,
      condition.conditionKey,
      'Workspace-one Condition',
      0,
      'met',
    );
    await db.update(trades).set({ confidence: 50 }).where(eq(trades.id, firstTradeId));

    // Switching to a second, unrelated Workspace — the DAL scopes strictly
    // to whichever Workspace `currentSession` now resolves to.
    const second = await setupWorkspace();

    const [adherence, confidence] = await Promise.all([
      getSetupAdherenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
      getConfidenceAnalyticsRecords({ datePreset: 'all' }, READ_OPTIONS),
    ]);
    if (!adherence.ok || !confidence.ok) throw new Error('read failed');
    expect(adherence.data.some((r) => r.tradeId === firstTradeId)).toBe(false);
    expect(confidence.data.some((r) => r.tradeId === firstTradeId)).toBe(false);
    expect(second.workspaceId).not.toBe(first.workspaceId);
  });
});
