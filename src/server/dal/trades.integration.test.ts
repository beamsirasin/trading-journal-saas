import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  mistakeTypes,
  strategySetupVersions,
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import {
  archiveSetup,
  archiveStrategy,
  createSetup,
  createStrategy,
  createStrategyRule,
  updateSetupContent,
  updateStrategyContent,
} from '@/server/services/strategy-management';
import { attachTradeMistake } from '@/server/services/trade-discipline';
import {
  createTrade,
  openTrade,
  resolveSystemTrade,
  softDeleteTrade,
  type CreateTradeInput,
} from '@/server/services/trade-management';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

/**
 * Exercises Phase 08C's authenticated reads (`src/server/dal/trades.ts`)
 * against a real, disposable database — the same session-mocking pattern
 * `src/server/dal/strategies.integration.test.ts` established: only Better
 * Auth's own session-resolution step is mocked, so `getActiveWorkspaceContext`
 * itself runs for real, including its membership/active-workspace lookup.
 */
type MockSession = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
  session: { id: string; expiresAt: Date };
} | null;

let currentSession: MockSession = null;

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock('@/lib/auth/server', () => ({
  getAuth: () => ({
    api: {
      getSession: async () => currentSession,
    },
  }),
}));

const {
  getTradeCreateOptions,
  getWorkspaceTradeChartAttachmentKey,
  getWorkspaceTradeDetail,
  listWorkspaceTrades,
} = await import('./trades');

function sessionFor(userId: string): MockSession {
  return {
    user: {
      id: userId,
      name: 'Test User',
      email: 'test@example.test',
      emailVerified: true,
      image: null,
    },
    session: { id: crypto.randomUUID(), expiresAt: new Date(Date.now() + 60_000) },
  };
}

type Db = ReturnType<typeof getTestDb>;

async function createUser(db: Db, label: string): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
    })
    .returning({ id: users.id });
  if (user === undefined) throw new Error('failed to insert test user');
  return user.id;
}

async function createWorkspaceWithOwner(db: Db, ownerUserId: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 08C DAL test workspace',
      slug: `p08c-dal-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return workspace.id;
}

async function createAccount(db: Db, workspaceId: string, overrides: { archived?: boolean } = {}) {
  const [row] = await db
    .insert(tradingAccounts)
    .values({
      workspaceId,
      name: 'Test account',
      accountMode: 'demo',
      baseCurrency: 'USD',
      startingBalance: '10000.0000000000',
      timezone: 'UTC',
      mutationKey: crypto.randomUUID(),
      isArchived: overrides.archived ?? false,
    })
    .returning({ id: tradingAccounts.id });
  if (row === undefined) throw new Error('failed to insert trading account');
  return row.id;
}

interface Framework {
  readonly tradingAccountId: string;
  readonly strategyId: string;
  readonly setupId: string;
}

async function createFramework(
  db: Db,
  workspaceId: string,
  actorUserId: string,
): Promise<Framework> {
  const tradingAccountId = await createAccount(db, workspaceId);
  const strategy = await createStrategy(workspaceId, actorUserId, {
    mutationKey: crypto.randomUUID(),
    name: 'Phase 08C DAL Test Strategy',
  });
  if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
  const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
    mutationKey: crypto.randomUUID(),
    name: 'Phase 08C DAL Test Setup',
    sortOrder: 0,
  });
  if (!setup.ok) throw new Error(`setup creation failed: ${setup.code}`);
  return { tradingAccountId, strategyId: strategy.strategyId, setupId: setup.setupId };
}

function basePlanInput(fw: Framework, overrides: Partial<CreateTradeInput> = {}): CreateTradeInput {
  return {
    mutationKey: crypto.randomUUID(),
    tradingAccountId: fw.tradingAccountId,
    strategyId: fw.strategyId,
    setupId: fw.setupId,
    symbol: 'EURUSD',
    direction: 'long',
    plannedEntry: '1.1000000000',
    plannedStop: '1.0950000000',
    plannedTarget: '1.1100000000',
    ...overrides,
  };
}

const workspaceIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  currentSession = null;
});

afterAll(async () => {
  const db = getTestDb();
  for (const id of workspaceIds.splice(0)) {
    await db.delete(workspaces).where(eq(workspaces.id, id));
  }
  for (const id of userIds.splice(0)) {
    await db.delete(users).where(eq(users.id, id));
  }
  await closeDb();
  await closeTestDb();
});

describe('trades DAL (real database)', () => {
  const db = getTestDb();

  async function freshWorkspace() {
    const userId = await createUser(db, 'p08c-dal');
    const workspaceId = await createWorkspaceWithOwner(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    currentSession = sessionFor(userId);
    return { userId, workspaceId };
  }

  describe('listWorkspaceTrades / getWorkspaceTradeDetail — the historical-label rule', () => {
    it('preserves the pinned Strategy/Setup names after a later rename, and a NEW Trade sees the new names', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const oldTrade = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!oldTrade.ok) throw new Error('create failed');

      // `createTrade` already locked the current Strategy Version via
      // `lockStrategyVersionForReferenceInTx` (Phase 08B) — no manual lock
      // step needed; `updateStrategyContent` below hits that already-locked
      // Version and copy-on-writes automatically.
      const renamed = await updateStrategyContent(workspaceId, userId, fw.strategyId, {
        name: 'RENAMED Strategy (post-Trade)',
        changeNote: 'renamed after the old Trade was created',
      });
      if (!renamed.ok) throw new Error('rename failed');
      const renamedSetup = await updateSetupContent(
        workspaceId,
        userId,
        fw.strategyId,
        fw.setupId,
        {
          name: 'RENAMED Setup (post-Trade)',
          sortOrder: 0,
          changeNote: null,
        },
      );
      if (!renamedSetup.ok) throw new Error('setup rename failed');

      const newTrade = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { mutationKey: crypto.randomUUID() }),
      );
      if (!newTrade.ok) throw new Error('new create failed');

      const oldDetail = await getWorkspaceTradeDetail(oldTrade.tradeId);
      const newDetail = await getWorkspaceTradeDetail(newTrade.tradeId);
      expect(oldDetail.ok).toBe(true);
      expect(newDetail.ok).toBe(true);
      if (!oldDetail.ok || !newDetail.ok) return;

      expect(oldDetail.trade.strategyName).toBe('Phase 08C DAL Test Strategy');
      expect(oldDetail.trade.setupName).toBe('Phase 08C DAL Test Setup');
      expect(newDetail.trade.strategyName).toBe('RENAMED Strategy (post-Trade)');
      expect(newDetail.trade.setupName).toBe('RENAMED Setup (post-Trade)');

      const list = await listWorkspaceTrades({});
      const oldItem = list.items.find((i) => i.tradeId === oldTrade.tradeId);
      const newItem = list.items.find((i) => i.tradeId === newTrade.tradeId);
      expect(oldItem?.strategyName).toBe('Phase 08C DAL Test Strategy');
      expect(oldItem?.setupName).toBe('Phase 08C DAL Test Setup');
      expect(newItem?.strategyName).toBe('RENAMED Strategy (post-Trade)');
      expect(newItem?.setupName).toBe('RENAMED Setup (post-Trade)');

      const [oldRow] = await db.select().from(trades).where(eq(trades.id, oldTrade.tradeId));
      const [newRow] = await db.select().from(trades).where(eq(trades.id, newTrade.tradeId));
      expect(oldRow?.strategyVersionId).not.toBe(newRow?.strategyVersionId);
      expect(oldRow?.setupVersionId).not.toBe(newRow?.setupVersionId);

      const [oldSnapshot] = await db
        .select()
        .from(strategySetupVersions)
        .where(eq(strategySetupVersions.id, oldRow?.setupVersionId as string));
      expect(oldSnapshot?.name).toBe('Phase 08C DAL Test Setup');
    });
  });

  describe('getWorkspaceTradeDetail — Rule scope and no internal-id leakage', () => {
    it('groups Rule checks by strategy/setup scope and never exposes strategyRuleId', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const strategyRuleKey = crypto.randomUUID();
      const setupRuleKey = crypto.randomUUID();
      const strategyRule = await createStrategyRule(workspaceId, userId, fw.strategyId, {
        ruleKey: strategyRuleKey,
        category: 'risk',
        title: 'Strategy-level risk check',
      });
      const setupRule = await createStrategyRule(workspaceId, userId, fw.strategyId, {
        ruleKey: setupRuleKey,
        setupId: fw.setupId,
        category: 'entry',
        title: 'Setup-level entry check',
      });
      if (!strategyRule.ok || !setupRule.ok) throw new Error('rule creation failed');

      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;

      const strategyScoped = detail.trade.ruleChecks.find((r) => r.ruleKey === strategyRuleKey);
      const setupScoped = detail.trade.ruleChecks.find((r) => r.ruleKey === setupRuleKey);
      expect(strategyScoped?.scope).toBe('strategy');
      expect(setupScoped?.scope).toBe('setup');

      const serialized = JSON.stringify(detail.trade);
      expect(serialized).not.toContain('strategyRuleId');
      expect(serialized).not.toContain('mutationKey');
    });

    it('never exposes mutationKey in the Trade detail payload', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(Object.keys(detail.trade)).not.toContain('mutationKey');
    });

    it('surfaces attached Mistakes with the canonical key/label and snapshot', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const [mistakeType] = await db.query.mistakeTypes.findMany({
        where: (m, { eq: eqOp }) => eqOp(m.key, 'moved_stop'),
      });
      if (mistakeType === undefined) throw new Error('canonical mistake type missing');
      await attachTradeMistake(workspaceId, userId, created.tradeId, mistakeType.id, 'note');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.mistakes).toHaveLength(1);
      expect(detail.trade.mistakes[0]).toMatchObject({
        key: 'moved_stop',
        severityAtTime: mistakeType.severity,
        weightAtTime: mistakeType.defaultWeight,
        note: 'note',
      });
    });

    it('returns only the nine active canonical system Mistakes as attach options', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      await db.insert(mistakeTypes).values({
        workspaceId,
        key: `custom-${crypto.randomUUID()}`,
        label: 'Custom excluded mistake',
        severity: 'minor',
        defaultWeight: '0.1500',
        isSystem: false,
      });

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.mistakeCatalog).toHaveLength(9);
      expect(detail.trade.mistakeCatalog.map((mistake) => mistake.key)).toEqual([
        'moved_stop',
        'early_exit',
        'oversized_position',
        'no_setup',
        'revenge_trade',
        'chased_entry',
        'ignored_invalidation',
        'moved_target',
        'no_stop',
      ]);
      expect(JSON.stringify(detail.trade.mistakeCatalog)).not.toContain('severity');
      expect(JSON.stringify(detail.trade.mistakeCatalog)).not.toContain('weight');
      expect(JSON.stringify(detail.trade.mistakeCatalog)).not.toContain('Custom excluded');
    });
  });

  describe('getWorkspaceTradeDetail — Price/Money/Confidence/Chart attachment (migration 0010)', () => {
    it('truthfully renders a Money-only Trade with null Price fields and populated Money fields', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedRiskMinor: 5000n,
        plannedRewardMinor: 15000n,
      });
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.plannedEntry).toBeNull();
      expect(detail.trade.plannedStop).toBeNull();
      expect(detail.trade.plannedTarget).toBeNull();
      expect(detail.trade.plannedRiskMinor).toBe('5000');
      expect(detail.trade.plannedRewardMinor).toBe('15000');
      expect(detail.trade.plannedR).toBe('3.0000');
      expect(detail.trade.hasChartAttachment).toBe(false);
      expect(detail.trade.chartAttachmentUploadedAt).toBeNull();
    });

    it('round-trips Confidence across the full widened 0-100 range', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw, { confidence: 7 }));
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.confidence).toBe(7);
    });

    it('round-trips a private chart attachment storage key and stamps an uploadedAt timestamp, exposing only a presence flag', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const storageKey = `trade-charts/${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
      const created = await createTrade(workspaceId, userId, {
        ...basePlanInput(fw),
        chartAttachmentStorageKey: storageKey,
      });
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.hasChartAttachment).toBe(true);
      expect(detail.trade.chartAttachmentUploadedAt).not.toBeNull();
      // Never a URL, and never the raw storage key — the read-side Trade
      // Detail payload carries only a truthful presence flag (Founder
      // review: private storage, no public URL).
      expect(JSON.stringify(detail.trade)).not.toContain(storageKey);
      expect(JSON.stringify(detail.trade)).not.toContain('chartAttachmentStorageKey');
      expect(JSON.stringify(detail.trade)).not.toContain('chartAttachmentUrl');
    });
  });

  describe('getWorkspaceTradeChartAttachmentKey — authorization proof (Founder review §4)', () => {
    it("the owning Workspace can retrieve its own Trade's storage key", async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const storageKey = `trade-charts/${crypto.randomUUID()}/${crypto.randomUUID()}.png`;
      const created = await createTrade(workspaceId, userId, {
        ...basePlanInput(fw),
        chartAttachmentStorageKey: storageKey,
      });
      if (!created.ok) throw new Error('create failed');

      const result = await getWorkspaceTradeChartAttachmentKey(created.tradeId);
      expect(result).toEqual({ ok: true, storageKey });
    });

    it('a Trade with no attachment resolves to no_attachment, never a key', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const result = await getWorkspaceTradeChartAttachmentKey(created.tradeId);
      expect(result).toEqual({ ok: false, code: 'no_attachment' });
    });

    it("a DIFFERENT Workspace cannot retrieve another Workspace's attachment key — identical denial to a nonexistent Trade", async () => {
      const ownerA = await freshWorkspace();
      const fwA = await createFramework(db, ownerA.workspaceId, ownerA.userId);
      const created = await createTrade(ownerA.workspaceId, ownerA.userId, {
        ...basePlanInput(fwA),
        chartAttachmentStorageKey: `trade-charts/${crypto.randomUUID()}/${crypto.randomUUID()}.png`,
      });
      if (!created.ok) throw new Error('create failed');

      // `freshWorkspace()` switches `currentSession` to this new owner as a
      // side effect — the DAL call below genuinely runs as a different user
      // in a different Workspace.
      await freshWorkspace();
      const crossWorkspaceResult = await getWorkspaceTradeChartAttachmentKey(created.tradeId);
      const nonexistentResult = await getWorkspaceTradeChartAttachmentKey(crypto.randomUUID());

      expect(crossWorkspaceResult).toEqual({ ok: false, code: 'trade_not_found' });
      expect(crossWorkspaceResult).toEqual(nonexistentResult);
    });

    it('a soft-deleted Trade is not_found, identically to one that never existed', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, {
        ...basePlanInput(fw),
        chartAttachmentStorageKey: `trade-charts/${crypto.randomUUID()}/${crypto.randomUUID()}.png`,
      });
      if (!created.ok) throw new Error('create failed');
      await softDeleteTrade(workspaceId, userId, created.tradeId);

      const result = await getWorkspaceTradeChartAttachmentKey(created.tradeId);
      expect(result).toEqual({ ok: false, code: 'trade_not_found' });
    });
  });

  describe('detail/list — soft-deleted Trade excluded, workspace isolation', () => {
    it('excludes a soft-deleted Trade from both list and detail', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await softDeleteTrade(workspaceId, userId, created.tradeId);

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail).toMatchObject({ ok: false, code: 'trade_not_found' });

      const list = await listWorkspaceTrades({});
      expect(list.items.some((i) => i.tradeId === created.tradeId)).toBe(false);
    });

    it('a cross-workspace Trade id is not-found from the other workspace', async () => {
      const first = await freshWorkspace();
      const fw = await createFramework(db, first.workspaceId, first.userId);
      const created = await createTrade(first.workspaceId, first.userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      // Switch the mocked session to a second, unrelated workspace.
      await freshWorkspace();

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail).toMatchObject({ ok: false, code: 'trade_not_found' });

      const list = await listWorkspaceTrades({});
      expect(list.items.some((i) => i.tradeId === created.tradeId)).toBe(false);
    });

    it('reads succeed identically whether the workspace is writable, over_limit, or read_only', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      await db
        .update(workspaceEntitlements)
        .set({
          status: 'canceled',
          currentPeriodStartedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          currentPeriodEndsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));

      const detailReadOnly = await getWorkspaceTradeDetail(created.tradeId);
      expect(detailReadOnly.ok).toBe(true);
      const listReadOnly = await listWorkspaceTrades({});
      expect(listReadOnly.items.some((i) => i.tradeId === created.tradeId)).toBe(true);
    });
  });

  describe('list pagination', () => {
    it('paginates deterministically, newest first, with no duplicate or skipped rows across pages', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const createdIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const created = await createTrade(
          workspaceId,
          userId,
          basePlanInput(fw, { mutationKey: crypto.randomUUID(), symbol: `PAGE${i}` }),
        );
        if (!created.ok) throw new Error('create failed');
        createdIds.push(created.tradeId);
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await listWorkspaceTrades({ limit: 2, cursor });
        for (const item of page.items) seen.push(item.tradeId);
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }

      for (const id of createdIds) {
        expect(seen).toContain(id);
      }
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('clamps an oversized limit request to the maximum page size', async () => {
      await freshWorkspace();
      const page = await listWorkspaceTrades({ limit: 10_000 });
      expect(page.items.length).toBeLessThanOrEqual(50);
    });
  });

  describe('getTradeCreateOptions — selector', () => {
    it('excludes archived Trading Accounts, Strategies, and Setups', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const archivedAccountId = await createAccount(db, workspaceId, { archived: true });

      const archivedStrategy = await createStrategy(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        name: 'Archived Strategy (selector test)',
      });
      if (!archivedStrategy.ok) throw new Error('strategy create failed');
      await archiveStrategy(workspaceId, userId, archivedStrategy.strategyId);

      const archivedSetup = await createSetup(workspaceId, userId, fw.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Archived Setup (selector test)',
        sortOrder: 1,
      });
      if (!archivedSetup.ok) throw new Error('setup create failed');
      await archiveSetup(workspaceId, userId, fw.strategyId, archivedSetup.setupId);

      const options = await getTradeCreateOptions();

      expect(options.tradingAccounts.some((a) => a.tradingAccountId === archivedAccountId)).toBe(
        false,
      );
      expect(options.tradingAccounts.some((a) => a.tradingAccountId === fw.tradingAccountId)).toBe(
        true,
      );
      expect(options.strategies.some((s) => s.strategyId === archivedStrategy.strategyId)).toBe(
        false,
      );
      const activeStrategyOption = options.strategies.find((s) => s.strategyId === fw.strategyId);
      expect(activeStrategyOption).toBeDefined();
      expect(activeStrategyOption?.setups.some((s) => s.setupId === archivedSetup.setupId)).toBe(
        false,
      );
      expect(activeStrategyOption?.setups.some((s) => s.setupId === fw.setupId)).toBe(true);
    });

    it('never includes a Version ID anywhere in the selector payload', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const options = await getTradeCreateOptions();
      const serialized = JSON.stringify(options);
      expect(serialized).not.toContain('versionId');
      expect(serialized).not.toContain('VersionId');
      expect(options.strategies.some((s) => s.strategyId === fw.strategyId)).toBe(true);
    });

    it("reports the caller's own workspaceId and a boolean chartUploadConfigured (Founder-UAT correction slice)", async () => {
      const { workspaceId } = await freshWorkspace();
      const options = await getTradeCreateOptions();
      expect(options.workspaceId).toBe(workspaceId);
      expect(typeof options.chartUploadConfigured).toBe('boolean');
      // No BLOB_READ_WRITE_TOKEN is configured in this test environment.
      expect(options.chartUploadConfigured).toBe(false);
    });
  });

  describe('detail includes System fields once resolved', () => {
    it('reflects resolved System R/outcome and open Actual fields', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, created.tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await resolveSystemTrade(workspaceId, userId, created.tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.systemStatus).toBe('resolved');
      expect(detail.trade.systemR).toBe('2.0000');
      expect(detail.trade.tradingAccountBaseCurrency).toBe('USD');
      expect(detail.trade.actualInitialRiskMinor).toBe('5000');
      expect(typeof detail.trade.enteredAt).toBe('string');
    });
  });
});
