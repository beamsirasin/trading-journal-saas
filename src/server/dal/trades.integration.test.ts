import { eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
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
  createSetupCondition,
  createStrategy,
  createStrategyRule,
  updateSetupContent,
  updateStrategyContent,
} from '@/server/services/strategy-management';
import { attachTradeMistake, updateTradeReviewNotes } from '@/server/services/trade-discipline';
import { addTradeExit } from '@/server/services/trade-execution';
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
  getWorkspaceTradeAttentionCounts,
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
  readonly setupVersionId: string;
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
  const snapshot = await db.query.strategySetupVersions.findFirst({
    where: (table, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(table.strategyVersionId, setup.versionId), eqOp(table.setupId, setup.setupId)),
  });
  if (snapshot === undefined) throw new Error('setup snapshot missing');
  return {
    tradingAccountId,
    strategyId: strategy.strategyId,
    setupId: setup.setupId,
    setupVersionId: snapshot.id,
  };
}

function basePlanInput(fw: Framework, overrides: Partial<CreateTradeInput> = {}): CreateTradeInput {
  return {
    mutationKey: crypto.randomUUID(),
    tradingAccountId: fw.tradingAccountId,
    strategyId: fw.strategyId,
    setupId: fw.setupId,
    conditionSetToken: createConditionSetToken(fw.setupVersionId),
    conditionAnswers: [],
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

      const refreshedOptions = await getTradeCreateOptions();
      const currentSetup = refreshedOptions.strategies
        .find((strategy) => strategy.strategyId === fw.strategyId)
        ?.setups.find((setup) => setup.setupId === fw.setupId);
      if (currentSetup === undefined) throw new Error('refreshed Setup option missing');

      const newTrade = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, {
          mutationKey: crypto.randomUUID(),
          conditionSetToken: currentSetup.conditionSetToken,
          conditionAnswers: currentSetup.conditions.map((condition) => ({
            conditionKey: condition.conditionKey,
            status: 'not_met',
          })),
        }),
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
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [],
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

    it('round-trips Confidence across the five allowed steps (Founder-UAT Confidence redesign)', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw, { confidence: 25 }));
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.confidence).toBe(25);
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
    it('returns the ten active canonical Emotion keys in deterministic order without IDs', async () => {
      await freshWorkspace();
      const options = await getTradeCreateOptions();
      expect(options.emotionCatalog.map((emotion) => emotion.key)).toEqual([
        'calm',
        'focused',
        'fearful',
        'fomo',
        'greedy',
        'hesitant',
        'revenge',
        'excited',
        'tired',
        'frustrated',
      ]);
      expect(JSON.stringify(options.emotionCatalog)).not.toContain('id');
    });

    it('returns current Setup Conditions in deterministic order with an opaque concurrency token', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const later = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Later',
        sortOrder: 20,
      });
      const earlier = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Earlier',
        sortOrder: 10,
      });
      if (!later.ok || !earlier.ok) throw new Error('condition creation failed');

      const options = await getTradeCreateOptions();
      const setup = options.strategies
        .find((strategy) => strategy.strategyId === fw.strategyId)
        ?.setups.find((candidate) => candidate.setupId === fw.setupId);
      expect(setup?.conditionSetToken).toBe(createConditionSetToken(fw.setupVersionId));
      expect(setup?.conditions).toEqual([
        { conditionKey: earlier.conditionKey, label: 'Earlier', sortOrder: 10 },
        { conditionKey: later.conditionKey, label: 'Later', sortOrder: 20 },
      ]);
    });

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
    it('returns the persisted Emotion marker so old absence and recorded zero stay distinct', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await db
        .update(trades)
        .set({ emotionsRecordedAt: null })
        .where(eq(trades.id, created.tradeId));
      const historical = await getWorkspaceTradeDetail(created.tradeId);
      expect(historical).toMatchObject({
        ok: true,
        trade: { emotionsRecordedAt: null, emotions: [] },
      });
      await db
        .update(trades)
        .set({ emotionsRecordedAt: new Date('2026-08-15T00:00:00Z') })
        .where(eq(trades.id, created.tradeId));
      const recordedZero = await getWorkspaceTradeDetail(created.tradeId);
      expect(recordedZero).toMatchObject({
        ok: true,
        trade: { emotionsRecordedAt: '2026-08-15T00:00:00.000Z', emotions: [] },
      });
    });

    it('reflects resolved System R/outcome and open Actual fields', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, created.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await resolveSystemTrade(workspaceId, userId, created.tradeId, {
        resolutionKind: 'price_exit',
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

  describe('getWorkspaceTradeDetail — archived Strategy/Setup/Account disclosure (Phase 13G)', () => {
    it('discloses the LIVE Strategy/Setup/Account as archived without rewriting the pinned historical label', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const beforeArchive = await getWorkspaceTradeDetail(created.tradeId);
      expect(beforeArchive.ok).toBe(true);
      if (!beforeArchive.ok) return;
      expect(beforeArchive.trade.strategyIsArchived).toBe(false);
      expect(beforeArchive.trade.setupIsArchived).toBe(false);
      expect(beforeArchive.trade.tradingAccountIsArchived).toBe(false);

      await archiveSetup(workspaceId, userId, fw.strategyId, fw.setupId);
      await archiveStrategy(workspaceId, userId, fw.strategyId);
      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.id, fw.tradingAccountId));

      const afterArchive = await getWorkspaceTradeDetail(created.tradeId);
      expect(afterArchive.ok).toBe(true);
      if (!afterArchive.ok) return;
      expect(afterArchive.trade.strategyIsArchived).toBe(true);
      expect(afterArchive.trade.setupIsArchived).toBe(true);
      expect(afterArchive.trade.tradingAccountIsArchived).toBe(true);
      // The historical Trade still reads exactly the same pinned names as before archiving.
      expect(afterArchive.trade.strategyName).toBe(beforeArchive.trade.strategyName);
      expect(afterArchive.trade.setupName).toBe(beforeArchive.trade.setupName);
    });
  });

  describe('listWorkspaceTrades — archived Strategy/Setup/Account disclosure (Phase 13I)', () => {
    it('discloses the LIVE Strategy/Setup/Account as archived without rewriting the pinned historical label', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const beforeArchive = await listWorkspaceTrades({});
      const beforeRow = beforeArchive.items.find((item) => item.tradeId === created.tradeId);
      if (beforeRow === undefined) throw new Error('Trade missing from list before archive');
      expect(beforeRow.strategyIsArchived).toBe(false);
      expect(beforeRow.setupIsArchived).toBe(false);
      expect(beforeRow.tradingAccountIsArchived).toBe(false);

      await archiveSetup(workspaceId, userId, fw.strategyId, fw.setupId);
      await archiveStrategy(workspaceId, userId, fw.strategyId);
      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.id, fw.tradingAccountId));

      const afterArchive = await listWorkspaceTrades({});
      const afterRow = afterArchive.items.find((item) => item.tradeId === created.tradeId);
      if (afterRow === undefined) throw new Error('Trade missing from list after archive');
      expect(afterRow.strategyIsArchived).toBe(true);
      expect(afterRow.setupIsArchived).toBe(true);
      expect(afterRow.tradingAccountIsArchived).toBe(true);
      // The historical Trade still reads exactly the same pinned names as before archiving.
      expect(afterRow.strategyName).toBe(beforeRow.strategyName);
      expect(afterRow.setupName).toBe(beforeRow.setupName);
    });
  });

  describe('getWorkspaceTradeDetail — Setup Condition three-state disclosure (Phase 13G)', () => {
    it('is not_configured when the pinned Setup Version genuinely has zero Conditions', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.setupConditionState).toBe('not_configured');
      expect(detail.trade.setupConditionChecks).toEqual([]);
    });

    it('is recorded, with met/not_met snapshots in sort order, when the Trade captured answers', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const first = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Above the 200 EMA',
        sortOrder: 0,
      });
      const second = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Volume confirms breakout',
        sortOrder: 1,
      });
      if (!first.ok || !second.ok) throw new Error('condition creation failed');

      const options = await getTradeCreateOptions();
      const setupOption = options.strategies
        .find((s) => s.strategyId === fw.strategyId)
        ?.setups.find((s) => s.setupId === fw.setupId);
      if (setupOption === undefined) throw new Error('setup option missing');

      const created = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, {
          conditionSetToken: setupOption.conditionSetToken,
          conditionAnswers: [
            { conditionKey: first.conditionKey, status: 'met' },
            { conditionKey: second.conditionKey, status: 'not_met' },
          ],
        }),
      );
      if (!created.ok) throw new Error('create failed');

      const detail = await getWorkspaceTradeDetail(created.tradeId);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.setupConditionState).toBe('recorded');
      expect(
        detail.trade.setupConditionChecks.map((c) => ({ label: c.label, status: c.checkStatus })),
      ).toEqual([
        { label: 'Above the 200 EMA', status: 'met' },
        { label: 'Volume confirms breakout', status: 'not_met' },
      ]);
    });

    it('is not_recorded (never not_configured) for a historical Trade whose Setup Version DID have Conditions', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const condition = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Above the 200 EMA',
        sortOrder: 0,
      });
      if (!condition.ok) throw new Error('condition creation failed');

      const options = await getTradeCreateOptions();
      const setupOption = options.strategies
        .find((s) => s.strategyId === fw.strategyId)
        ?.setups.find((s) => s.setupId === fw.setupId);
      if (setupOption === undefined) throw new Error('setup option missing');

      const created = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, {
          conditionSetToken: setupOption.conditionSetToken,
          conditionAnswers: [{ conditionKey: condition.conditionKey, status: 'met' }],
        }),
      );
      if (!created.ok) throw new Error('create failed');

      // Simulate a pre-13C historical Trade: the Setup Version genuinely had
      // Conditions, but no per-Trade answer snapshot was ever captured. The
      // snapshot table is DB-trigger-protected against mutation once written
      // (`trade_setup_condition_checks_protect_snapshot`), so this clones the
      // already-valid Trade row into a fresh Trade that never went through
      // `snapshotTradeSetupConditionsInTx` at all, rather than deleting rows.
      const [sourceRow] = await db.select().from(trades).where(eq(trades.id, created.tradeId));
      if (sourceRow === undefined) throw new Error('source Trade row missing');
      const {
        id: _id,
        mutationKey: _mutationKey,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...clonedFields
      } = sourceRow;
      const [historical] = await db
        .insert(trades)
        .values({ ...clonedFields, mutationKey: crypto.randomUUID() })
        .returning({ id: trades.id });
      if (historical === undefined) throw new Error('failed to insert cloned historical Trade');

      const detail = await getWorkspaceTradeDetail(historical.id);
      expect(detail.ok).toBe(true);
      if (!detail.ok) return;
      expect(detail.trade.setupConditionState).toBe('not_recorded');
      expect(detail.trade.setupConditionChecks).toEqual([]);
    });
  });

  describe('listWorkspaceTrades — batched partial-close Realized R and Setup Condition adherence (Phase 13G)', () => {
    it('derives remaining bps and Realized R for a partially-exited open Trade via one batched Exit read', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(workspaceId, userId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, created.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const exit = await addTradeExit(workspaceId, userId, created.tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 5_000,
        realizedPnlMinor: 2_500n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });
      expect(exit.ok).toBe(true);

      const list = await listWorkspaceTrades({});
      const item = list.items.find((i) => i.tradeId === created.tradeId);
      expect(item).toBeDefined();
      expect(item?.closedBps).toBe(5_000);
      expect(item?.remainingBps).toBe(5_000);
      expect(item?.realizedRToDate).toBe('0.5000');
      // Not yet closed — the final authoritative `actualR` stays absent, never a fake early value.
      expect(item?.actualR).toBeNull();
      expect(item?.plannedR).toBe('2.0000');
    });

    it('reports null Setup Condition adherence for an unrecorded Trade and correct counts for a recorded one', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      // A second, untouched Setup for the zero-Condition ("unrecorded" —
      // never distinguished from "not configured" on the List) comparison,
      // since adding a Condition to `fw`'s own Setup below copy-on-writes it
      // to a new Version and invalidates `fw.setupVersionId`'s token.
      const fw2 = await createFramework(db, workspaceId, userId);
      const condition = await createSetupCondition(workspaceId, userId, fw.strategyId, fw.setupId, {
        label: 'Above the 200 EMA',
        sortOrder: 0,
      });
      if (!condition.ok) throw new Error('condition creation failed');
      const options = await getTradeCreateOptions();
      const setupOption = options.strategies
        .find((s) => s.strategyId === fw.strategyId)
        ?.setups.find((s) => s.setupId === fw.setupId);
      if (setupOption === undefined) throw new Error('setup option missing');

      const recorded = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, {
          mutationKey: crypto.randomUUID(),
          symbol: 'RECORDEDONE',
          conditionSetToken: setupOption.conditionSetToken,
          conditionAnswers: [{ conditionKey: condition.conditionKey, status: 'met' }],
        }),
      );
      const unrecorded = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw2, { mutationKey: crypto.randomUUID(), symbol: 'ZEROCOND' }),
      );
      if (!recorded.ok || !unrecorded.ok) throw new Error('create failed');

      const list = await listWorkspaceTrades({});
      const recordedItem = list.items.find((i) => i.tradeId === recorded.tradeId);
      const unrecordedItem = list.items.find((i) => i.tradeId === unrecorded.tradeId);
      expect(recordedItem?.setupConditionMetCount).toBe(1);
      expect(recordedItem?.setupConditionTotalCount).toBe(1);
      expect(unrecordedItem?.setupConditionMetCount).toBeNull();
      expect(unrecordedItem?.setupConditionTotalCount).toBeNull();
    });
  });

  describe('getWorkspaceTradeAttentionCounts (Phase 14C)', () => {
    it('counts open Trades, pending System Outcomes, unclassified Trades, and closed-but-unreviewed Trades independently', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);

      // A: planned only — classified, not opened, System pending by default.
      // Contributes to nothing except (trivially) the unclassified/open counts
      // staying at zero for this Trade.
      const planned = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'PLANNEDONE' }),
      );
      if (!planned.ok) throw new Error('create failed');

      // B: unclassified (no Strategy/Setup) and left planned — counts toward
      // unclassifiedTrades only.
      const unclassified = await createTrade(workspaceId, userId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'UNCLASSIFIEDONE',
        direction: 'long',
        plannedEntry: '1.1000000000',
        plannedStop: '1.0950000000',
        plannedTarget: '1.1100000000',
      });
      if (!unclassified.ok) throw new Error('create failed');

      // C: opened, System still pending — counts toward openTrades AND
      // pendingSystemOutcomes.
      const openPending = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'OPENPENDING' }),
      );
      if (!openPending.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, openPending.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });

      // D: opened, fully closed, System resolved, and reviewed — counts
      // toward NONE of the four (closed excludes it from openTrades, System
      // resolved excludes it from pendingSystemOutcomes, review notes
      // present excludes it from reviewsPending).
      const reviewed = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'REVIEWEDDONE' }),
      );
      if (!reviewed.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, reviewed.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await addTradeExit(workspaceId, userId, reviewed.tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 10_000,
        realizedPnlMinor: 5_000n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });
      await resolveSystemTrade(workspaceId, userId, reviewed.tradeId, {
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      await updateTradeReviewNotes(workspaceId, userId, reviewed.tradeId, 'Followed the plan.');

      // E: closed but never reviewed — counts toward reviewsPending only.
      const unreviewed = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'UNREVIEWEDONE' }),
      );
      if (!unreviewed.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, unreviewed.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await addTradeExit(workspaceId, userId, unreviewed.tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 10_000,
        realizedPnlMinor: 5_000n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });

      const counts = await getWorkspaceTradeAttentionCounts();
      expect(counts).toEqual({
        openTrades: 1, // openPending only — reviewed/unreviewed are closed
        pendingSystemOutcomes: 4, // every Trade except `reviewed`
        unclassifiedTrades: 1, // `unclassified` only
        reviewsPending: 1, // `unreviewed` only — closed with no review notes
      });
    });

    it('is scoped per workspace — a second workspace never contributes to the first workspace’s counts', async () => {
      const first = await freshWorkspace();
      const fw1 = await createFramework(db, first.workspaceId, first.userId);
      const created1 = await createTrade(
        first.workspaceId,
        first.userId,
        basePlanInput(fw1, { symbol: 'FIRSTWORKSPACE' }),
      );
      if (!created1.ok) throw new Error('create failed');
      await openTrade(first.workspaceId, first.userId, created1.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const firstCounts = await getWorkspaceTradeAttentionCounts();
      expect(firstCounts.openTrades).toBe(1);

      await freshWorkspace();
      const secondCounts = await getWorkspaceTradeAttentionCounts();
      expect(secondCounts).toEqual({
        openTrades: 0,
        pendingSystemOutcomes: 0,
        unclassifiedTrades: 0,
        reviewsPending: 0,
      });
    });
  });

  describe('listWorkspaceTrades — journalDateRange (Trading Calendar selected-day filter, Phase 14D)', () => {
    it('filters to Trades whose journal-chronology date (coalesce(exited_at, entered_at, created_at)) falls in range — never a different axis', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const inRange = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'INRANGE' }),
      );
      const outOfRange = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'OUTOFRANGE' }),
      );
      if (!inRange.ok || !outOfRange.ok) throw new Error('create failed');
      await openTrade(workspaceId, userId, inRange.tradeId, {
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await resolveSystemTrade(workspaceId, userId, inRange.tradeId, {
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        // System resolves a day OUTSIDE the selected range — must NOT pull
        // this Trade in via its System date; it belongs via `created_at`
        // instead (journal chronology), unaffected by System's own date.
        systemExitedAt: new Date('2026-09-15T00:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });

      const page = await listWorkspaceTrades({
        journalDateRange: {
          start: new Date('2026-01-01T00:00:00Z'),
          end: new Date('2026-01-02T00:00:00Z'),
        },
      });
      // Both Trades were created "now" (real time), not Jan 2026 — so an
      // arbitrary past range correctly excludes both, proving the filter is
      // genuinely applied rather than a no-op.
      expect(page.items.some((item) => item.symbol === 'INRANGE')).toBe(false);
      expect(page.items.some((item) => item.symbol === 'OUTOFRANGE')).toBe(false);

      const wideOpen = await listWorkspaceTrades({
        journalDateRange: {
          start: new Date('2020-01-01T00:00:00Z'),
          end: new Date('2030-01-01T00:00:00Z'),
        },
      });
      expect(wideOpen.items.some((item) => item.symbol === 'INRANGE')).toBe(true);
      expect(wideOpen.items.some((item) => item.symbol === 'OUTOFRANGE')).toBe(true);
    });

    it('composes with the existing tradingAccountId filter', async () => {
      const { userId, workspaceId } = await freshWorkspace();
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTrade(
        workspaceId,
        userId,
        basePlanInput(fw, { symbol: 'ACCOUNTSCOPED' }),
      );
      if (!created.ok) throw new Error('create failed');

      const wideRange = {
        start: new Date('2020-01-01T00:00:00Z'),
        end: new Date('2030-01-01T00:00:00Z'),
      };
      const matchingAccount = await listWorkspaceTrades({
        tradingAccountId: fw.tradingAccountId,
        journalDateRange: wideRange,
      });
      expect(matchingAccount.items.some((item) => item.symbol === 'ACCOUNTSCOPED')).toBe(true);

      const foreignAccountId = '018f0000-0000-7000-8000-000000000fff';
      const nonMatchingAccount = await listWorkspaceTrades({
        tradingAccountId: foreignAccountId,
        journalDateRange: wideRange,
      });
      expect(nonMatchingAccount.items.some((item) => item.symbol === 'ACCOUNTSCOPED')).toBe(false);
    });
  });
});
