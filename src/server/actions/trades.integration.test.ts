import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  auditLogs,
  tradeEmotions,
  tradeExits,
  trades,
  tradingAccounts,
  userPreferences,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import {
  createSetup,
  createStrategy,
  createStrategyRule,
} from '@/server/services/strategy-management';
import {
  addExit,
  buildAfterTradePayload,
  createAfterTradeDraft,
  setCloseMode,
  updateExit,
  updateFullClose,
  type AfterTradeDraft,
} from '@/components/trades/after-trade-draft';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { closeDb } from '../db/client';

/**
 * Exercises Phase 08C's Server Actions (`src/server/actions/trades.ts`)
 * against a real, disposable database — the exact mocking pattern
 * `src/server/actions/strategies.integration.test.ts` establishes:
 * `@/server/auth/dal` is mocked wholesale to control the trusted
 * `{ workspaceId, userId }` context and the `requireTradeManagement`
 * precheck directly, while the SERVICE layer underneath
 * (`trade-management.ts`/`trade-discipline.ts`) still runs for real against
 * the real database — it re-verifies membership/entitlement itself via its
 * own direct queries, never through `@/server/auth/dal`, so mocking that
 * module here does not weaken the real authorization boundary under test.
 */

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const actionState = vi.hoisted(() => ({
  context: null as null | { workspaceId: string; userId: string },
  unauthenticated: false,
  forbidden: false,
}));

vi.mock('@/server/auth/dal', () => {
  class UnauthenticatedError extends Error {
    constructor() {
      super('No authenticated session.');
      this.name = 'UnauthenticatedError';
    }
  }
  class ForbiddenError extends Error {
    constructor() {
      super('Not authorized for this workspace.');
      this.name = 'ForbiddenError';
    }
  }
  return {
    UnauthenticatedError,
    ForbiddenError,
    getActiveWorkspaceContext: async () => {
      if (actionState.unauthenticated || actionState.context === null) {
        throw new UnauthenticatedError();
      }
      return actionState.context;
    },
    requireTradeManagement: async () => {
      if (actionState.forbidden) throw new ForbiddenError();
      return 'member' as const;
    },
  };
});

const {
  adoptHistoricalExitSubtotalAction,
  applyHistoricalExitHistoryCorrectionAction,
  attachTradeMistakeAction,
  cancelTradeAction,
  closeTradeAction,
  correctSystemResolutionAction,
  correctTradeIdentityAction,
  createCompletedTradeAction,
  createTradeAction,
  editHistoricalFinalResultAction,
  markSystemCannotDetermineAction,
  markSystemNoTradeAction,
  openTradeAction,
  removeTradeMistakeAction,
  replaceTradeEmotionsAction,
  resolveSystemTradeAction,
  softDeleteTradeAction,
  updateTradePlanAction,
  updateTradeRuleCheckAction,
  updateTradeReviewNotesAction,
} = await import('./trades');

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

async function createWorkspace(
  db: Db,
  ownerUserId: string,
  entitlement: { status: string; planKey?: string | null } = {
    status: 'active',
    planKey: 'professional',
  },
): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 08C action test workspace',
      slug: `p08c-act-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(userPreferences).values({ userId: ownerUserId, activeWorkspaceId: workspace.id });

  if (entitlement.status === 'trialing_expired') {
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: 'trialing',
      trialStartedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      trialEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });
  } else {
    await db.insert(workspaceEntitlements).values({
      workspaceId: workspace.id,
      status: entitlement.status,
      planKey: entitlement.planKey ?? null,
      billingCurrency: 'USD',
      billingInterval: 'monthly',
      currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  }
  return workspace.id;
}

async function createAccount(db: Db, workspaceId: string) {
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
    name: 'Phase 08C Action Test Strategy',
  });
  if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
  const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
    mutationKey: crypto.randomUUID(),
    name: 'Phase 08C Action Test Setup',
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

function baseCreateInput(fw: Framework, overrides: Record<string, unknown> = {}) {
  return {
    mutationKey: crypto.randomUUID(),
    tradingAccountId: fw.tradingAccountId,
    strategyId: fw.strategyId,
    setupId: fw.setupId,
    conditionSetToken: createConditionSetToken(fw.setupVersionId),
    conditionAnswers: [],
    emotionKeys: [],
    symbol: 'EURUSD',
    direction: 'long' as const,
    plannedEntry: '1.1000000000',
    plannedStop: '1.0950000000',
    plannedTarget: '1.1100000000',
    ...overrides,
  };
}

/** Serializable = survives a JSON round-trip with no dropped/mangled keys and no `Error` leaking through as `{}`. */
function assertJsonSerializable(value: unknown): void {
  expect(value).not.toBeInstanceOf(Error);
  const json = JSON.stringify(value);
  expect(json).toBeDefined();
  expect(JSON.parse(json as string)).toEqual(value);
  expect(json).not.toMatch(/"stack"/);
  expect(json).not.toMatch(/"cause"/);
  expect(json).not.toMatch(/\d+n(?=[,}])/); // no stray bigint literal leaked through
}

const workspaceIds: string[] = [];
const userIds: string[] = [];

afterEach(async () => {
  actionState.context = null;
  actionState.unauthenticated = false;
  actionState.forbidden = false;
  revalidatePath.mockClear();
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

describe('Trade Server Actions (real PostgreSQL)', () => {
  const db = getTestDb();

  async function freshFixture() {
    const userId = await createUser(db, 'p08c-act');
    const workspaceId = await createWorkspace(db, userId);
    userIds.push(userId);
    workspaceIds.push(workspaceId);
    actionState.context = { workspaceId, userId };
    const fw = await createFramework(db, workspaceId, userId);
    return { userId, workspaceId, fw };
  }

  async function createdTrade() {
    const fixture = await freshFixture();
    const created = await createTradeAction(baseCreateInput(fixture.fw));
    if (!created.ok) throw new Error(`fixture create failed: ${created.error.code}`);
    return { ...fixture, tradeId: created.data.tradeId };
  }

  // -------------------------------------------------------------------------
  // createTradeAction
  // -------------------------------------------------------------------------
  describe('createTradeAction', () => {
    it('rejects unauthenticated calls without touching the database', async () => {
      actionState.unauthenticated = true;
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: crypto.randomUUID(),
        strategyId: crypto.randomUUID(),
        setupId: crypto.randomUUID(),
        conditionSetToken: 'a'.repeat(64),
        conditionAnswers: [],
        emotionKeys: [],
        symbol: 'EURUSD',
        direction: 'long',
        plannedEntry: '1.1',
        plannedStop: '1.09',
      });
      expect(result).toEqual({ ok: false, error: { code: 'unauthenticated' } });
      expect(revalidatePath).not.toHaveBeenCalled();
      assertJsonSerializable(result);
    });

    it('rejects a forbidden precheck as workspace_access_denied', async () => {
      const { fw } = await freshFixture();
      actionState.forbidden = true;
      const result = await createTradeAction(baseCreateInput(fw));
      expect(result).toEqual({ ok: false, error: { code: 'workspace_access_denied' } });
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('rejects an unrecognized field with sanitized field errors', async () => {
      const { fw } = await freshFixture();
      const result = await createTradeAction({
        ...baseCreateInput(fw),
        workspaceId: 'forged-workspace-id',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('validation_error');
      expect(JSON.stringify(result)).not.toContain('forged-workspace-id');
      expect(revalidatePath).not.toHaveBeenCalled();
      assertJsonSerializable(result);
    });

    it('succeeds fresh, revalidates both locales, and returns a minimal serializable payload', async () => {
      const { fw, workspaceId } = await freshFixture();
      const result = await createTradeAction(baseCreateInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.alreadyCreated).toBe(false);
      expect(typeof result.data.tradeId).toBe('string');
      expect(revalidatePath).toHaveBeenCalledWith('/en/app/trades');
      expect(revalidatePath).toHaveBeenCalledWith('/th/app/trades');
      expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/trades/new'));
      assertJsonSerializable(result);

      const createdTrade = await db.query.trades.findFirst({
        where: eq(trades.id, result.data.tradeId),
      });
      expect(createdTrade).toMatchObject({
        systemStatus: 'pending',
        systemCostR: null,
        systemResolutionKind: null,
        systemGrossR: null,
        systemR: null,
        systemOutcome: null,
        systemDependencySnapshot: null,
      });

      const events = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.created'), eq(auditLogs.workspaceId, workspaceId)));
      expect(events).toHaveLength(1);
    });

    it('maps a wrong-side Stop to invalid_plan with a plannedStop field error', async () => {
      const { fw } = await freshFixture();
      const result = await createTradeAction(baseCreateInput(fw, { plannedStop: '1.1050000000' }));
      expect(result).toMatchObject({
        ok: false,
        error: { code: 'invalid_plan', fieldErrors: { plannedStop: expect.any(Array) } },
      });
    });

    it('creates a Money-only Trade through the full action -> Zod -> service -> database path', async () => {
      const { fw } = await freshFixture();
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [],
        emotionKeys: [],
        symbol: 'EURUSD',
        direction: 'long',
        plannedRiskMinor: '5000',
        plannedRewardMinor: '15000',
      });
      expect(result.ok).toBe(true);
      assertJsonSerializable(result);
    });

    // Phase 14E — Open/Close-Only Trade Flow: the normal customer New Trade
    // form now supplies `actualResultMode`, producing an already-`open`
    // Trade through the same atomic action -> Zod -> service -> database
    // path, never a second `openTradeAction` call after.
    it('opens a Price-mode Trade atomically through the full action -> Zod -> service -> database path', async () => {
      const { fw, workspaceId } = await freshFixture();
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        emotionKeys: [],
        symbol: 'EURUSD',
        direction: 'long',
        actualResultMode: 'price',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        enteredAt: '2026-08-01T09:00:00.000Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      assertJsonSerializable(result);
      const [row] = await db.select().from(trades).where(eq(trades.id, result.data.tradeId));
      expect(row?.status).toBe('open');
      expect(row?.workspaceId).toBe(workspaceId);
      expect(row?.actualResultMode).toBe('price');
    });

    it('opens a Money-mode Trade atomically with no Actual Entry/Stop required', async () => {
      const { fw } = await freshFixture();
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        emotionKeys: [],
        symbol: 'EURUSD',
        direction: 'short',
        actualResultMode: 'money',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00.000Z',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const [row] = await db.select().from(trades).where(eq(trades.id, result.data.tradeId));
      expect(row?.status).toBe('open');
      expect(row?.actualResultMode).toBe('money');
      expect(row?.actualInitialRiskMinor).toBe(5000n);
    });

    it('rejects Price mode missing Entry/Stop as a schema validation_error, creating no Trade', async () => {
      const { fw, workspaceId } = await freshFixture();
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
        actualResultMode: 'price',
        enteredAt: '2026-08-01T09:00:00.000Z',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('validation_error');
      const rows = await db.select().from(trades).where(eq(trades.workspaceId, workspaceId));
      expect(rows).toHaveLength(0);
    });

    it('rejects Money mode missing Initial Risk as a schema validation_error, creating no Trade', async () => {
      const { fw, workspaceId } = await freshFixture();
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
        actualResultMode: 'money',
        enteredAt: '2026-08-01T09:00:00.000Z',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('validation_error');
      const rows = await db.select().from(trades).where(eq(trades.workspaceId, workspaceId));
      expect(rows).toHaveLength(0);
    });

    it('returns a stable public stale-Conditions error without creating a Trade', async () => {
      const { fw } = await freshFixture();
      const result = await createTradeAction(
        baseCreateInput(fw, { conditionSetToken: '0'.repeat(64) }),
      );
      expect(result).toEqual({ ok: false, error: { code: 'stale_setup_conditions' } });
      expect(revalidatePath).not.toHaveBeenCalled();
      assertJsonSerializable(result);
    });

    it('accepts neither Price nor Money present — the frozen Quick Capture contract (Phase 14C.1)', async () => {
      const { fw } = await freshFixture();
      // Deliberately omits Strategy/Setup too, matching the exact frozen
      // Quick Capture contract: Trading Account + Symbol + Direction alone
      // is a sufficient, persistable Trade. Migration 0016 dropped the
      // database's `trades_plan_minimum_check`, `CreateTradeSchema` no
      // longer refines for "at least one representation," and `createTrade`
      // no longer pre-checks it either — see the `trade-management` and
      // `trade-domain` integration suites for the equivalent service- and
      // DB-level proofs.
      const result = await createTradeAction({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        emotionKeys: [],
        symbol: 'EURUSD',
        direction: 'long',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(typeof result.data.tradeId).toBe('string');
      assertJsonSerializable(result);
    });

    it('rejects dual Price/Money create input at the schema authority boundary and persists nothing', async () => {
      const { fw, workspaceId } = await freshFixture();
      const result = await createTradeAction(
        baseCreateInput(fw, { plannedRiskMinor: '1000', plannedRewardMinor: '50000' }), // Money R = 50, Price R = 2
      );
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'validation_error',
          fieldErrors: { systemPlanBasis: ['conflicting_plan_basis'] },
        },
      });
      const events = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.created'), eq(auditLogs.workspaceId, workspaceId)));
      expect(events).toHaveLength(0);
    });

    describe('idempotent replay', () => {
      it('an exact replay returns the same Trade and revalidates again', async () => {
        const { fw } = await freshFixture();
        const input = baseCreateInput(fw);
        const first = await createTradeAction(input);
        revalidatePath.mockClear();
        const second = await createTradeAction(input);
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) return;
        expect(second.data.tradeId).toBe(first.data.tradeId);
        expect(second.data.alreadyCreated).toBe(true);
        expect(revalidatePath).toHaveBeenCalledWith('/en/app/trades');
      });

      it('remains replayable after the workspace becomes read_only', async () => {
        const userId = await createUser(db, 'p08c-act-ro-replay');
        const workspaceId = await createWorkspace(db, userId, { status: 'trialing_expired' });
        // Temporarily writable to create, then flip to read_only.
        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, workspaceId));
        userIds.push(userId);
        workspaceIds.push(workspaceId);
        actionState.context = { workspaceId, userId };
        const fw = await createFramework(db, workspaceId, userId);
        const input = baseCreateInput(fw);
        const created = await createTradeAction(input);
        expect(created.ok).toBe(true);

        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, workspaceId));

        const replay = await createTradeAction(input);
        expect(replay).toMatchObject({ ok: true, data: { alreadyCreated: true } });
      });

      it('denies createTrade fresh under a read_only workspace', async () => {
        const userId = await createUser(db, 'p08c-act-ro-fresh');
        const workspaceId = await createWorkspace(db, userId, { status: 'trialing_expired' });
        userIds.push(userId);
        workspaceIds.push(workspaceId);
        actionState.context = { workspaceId, userId };
        // Framework creation itself needs writable access — build it first
        // under a temporarily-writable window, matching the replay test above.
        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, workspaceId));
        const fw = await createFramework(db, workspaceId, userId);
        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, workspaceId));

        const result = await createTradeAction(baseCreateInput(fw));
        expect(result).toMatchObject({ ok: false, error: { code: 'read_only_workspace' } });
        expect(revalidatePath).not.toHaveBeenCalled();
      });

      it('denies a removed member from replaying an old mutationKey', async () => {
        const { fw, workspaceId, userId } = await freshFixture();
        const input = baseCreateInput(fw);
        const created = await createTradeAction(input);
        expect(created.ok).toBe(true);

        await db
          .delete(workspaceMembers)
          .where(
            and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
          );

        const replay = await createTradeAction(input);
        expect(replay).toMatchObject({ ok: false, error: { code: 'workspace_access_denied' } });
      });

      it("a mutationKey reused in a different workspace never leaks the first workspace's identity", async () => {
        const first = await freshFixture();
        const sharedKey = crypto.randomUUID();
        const createdFirst = await createTradeAction(
          baseCreateInput(first.fw, { mutationKey: sharedKey }),
        );
        expect(createdFirst.ok).toBe(true);

        const second = await freshFixture(); // switches actionState.context
        const createdSecond = await createTradeAction(
          baseCreateInput(second.fw, { mutationKey: sharedKey }),
        );
        expect(createdSecond.ok).toBe(true);
        if (!createdFirst.ok || !createdSecond.ok) return;
        expect(createdSecond.data.tradeId).not.toBe(createdFirst.data.tradeId);
        expect(createdSecond.data.alreadyCreated).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  // updateTradePlanAction / correctTradeIdentityAction
  // -------------------------------------------------------------------------
  describe('updateTradePlanAction', () => {
    it('updates the Plan and returns the recomputed plannedR', async () => {
      const { tradeId } = await createdTrade();
      const result = await updateTradePlanAction({ tradeId, plannedEntry: '1.1050000000' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.plannedR).toBe('0.5000');
      assertJsonSerializable(result);
    });

    it('omitting plannedTarget leaves it unchanged; explicit null clears it', async () => {
      const { tradeId } = await createdTrade();
      const cleared = await updateTradePlanAction({ tradeId, plannedTarget: null });
      expect(cleared.ok).toBe(true);
      if (!cleared.ok) return;
      expect(cleared.data.plannedR).toBeNull();
    });

    it('switches the existing Price plan to Money through the action layer', async () => {
      const { tradeId } = await createdTrade(); // Price R = 2.0000
      const result = await updateTradePlanAction({
        tradeId,
        systemPlanBasis: 'money',
        plannedRiskMinor: '1000',
        plannedRewardMinor: '2000', // Money R = 2.0000, agrees
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.plannedR).toBe('2.0000');
      assertJsonSerializable(result);
    });

    it('rejects adding Money fields to the existing Price plan without an explicit switch', async () => {
      const { tradeId } = await createdTrade(); // Price R = 2.0000
      const result = await updateTradePlanAction({
        tradeId,
        plannedRiskMinor: '1000',
        plannedRewardMinor: '50000', // Money R = 50.0000
      });
      expect(result).toEqual({ ok: false, error: { code: 'invalid_plan_authority' } });
    });
  });

  describe('correctTradeIdentityAction', () => {
    it('corrects the symbol without touching plannedR', async () => {
      const { tradeId } = await createdTrade();
      const result = await correctTradeIdentityAction({ tradeId, symbol: 'GBPUSD' });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.plannedR).toBe('2.0000');
    });
  });

  // -------------------------------------------------------------------------
  // openTradeAction / closeTradeAction / cancelTradeAction
  // -------------------------------------------------------------------------
  describe('openTradeAction / closeTradeAction / cancelTradeAction', () => {
    it('opens a planned Trade', async () => {
      const { tradeId } = await createdTrade();
      const result = await openTradeAction({
        tradeId,
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      expect(result).toMatchObject({ ok: true, data: { tradeId, status: 'open' } });
    });

    it('closes an open Trade, returning actualR/traderOutcome', async () => {
      const { tradeId } = await createdTrade();
      await openTradeAction({
        tradeId,
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      const result = await closeTradeAction({
        tradeId,
        actualExit: '1.1080000000',
        netPnlMinor: '7500',
        exitedAt: '2026-08-01T14:00:00Z',
      });
      expect(result).toMatchObject({
        ok: true,
        data: { tradeId, status: 'closed', actualR: '1.5000', traderOutcome: 'win' },
      });
      assertJsonSerializable(result);
    });

    it('an exact close retry succeeds; a differing retry is rejected', async () => {
      const { tradeId } = await createdTrade();
      await openTradeAction({
        tradeId,
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      const closeInput = {
        tradeId,
        actualExit: '1.1080000000',
        netPnlMinor: '7500',
        exitedAt: '2026-08-01T14:00:00Z',
      };
      await closeTradeAction(closeInput);
      const retry = await closeTradeAction(closeInput);
      expect(retry.ok).toBe(true);

      const differing = await closeTradeAction({ ...closeInput, netPnlMinor: '8000' });
      expect(differing).toMatchObject({ ok: false, error: { code: 'invalid_status_transition' } });
    });

    it('cancels a planned Trade', async () => {
      const { tradeId } = await createdTrade();
      const result = await cancelTradeAction({ tradeId });
      expect(result).toMatchObject({ ok: true, data: { tradeId, status: 'canceled' } });
    });
  });

  // -------------------------------------------------------------------------
  // System axis
  // -------------------------------------------------------------------------
  describe('resolveSystemTradeAction / markSystemNoTradeAction / correctSystemResolutionAction', () => {
    function resolveInput(tradeId: string) {
      return {
        tradeId,
        resolutionKind: 'price_exit' as const,
        systemExitPrice: '1.1100000000',
        systemExitedAt: '2026-08-01T12:00:00Z',
        systemExitReason: 'target_hit' as const,
        systemCostR: '0.0000',
      };
    }

    it('resolves the System result, returning systemR/systemOutcome', async () => {
      const { tradeId } = await createdTrade();
      const result = await resolveSystemTradeAction(resolveInput(tradeId));
      expect(result).toMatchObject({
        ok: true,
        data: { tradeId, systemStatus: 'resolved', systemR: '2.0000', systemOutcome: 'win' },
      });
      assertJsonSerializable(result);
    });

    it('marks no_trade with no System R and persists assessment metadata', async () => {
      const { tradeId } = await createdTrade();
      const result = await markSystemNoTradeAction({
        tradeId,
        systemPlanProvenance: 'reconstructed_later',
        planAdherence: 'partly',
      });
      expect(result).toMatchObject({ ok: true, data: { tradeId, systemStatus: 'no_trade' } });
      const [stored] = await getTestDb().select().from(trades).where(eq(trades.id, tradeId));
      expect(stored).toMatchObject({
        systemStatus: 'no_trade',
        systemGrossR: null,
        systemR: null,
        systemOutcome: null,
        systemPlanProvenance: 'reconstructed_later',
        planAdherence: 'partly',
      });
      expect(stored?.systemDependencySnapshot).not.toBeNull();
    });

    it('marks cannot_determine through the existing service and persists assessment metadata', async () => {
      const { tradeId } = await createdTrade();
      const result = await markSystemCannotDetermineAction({
        tradeId,
        systemPlanProvenance: 'unknown',
        planAdherence: 'not_followed',
      });
      expect(result).toMatchObject({
        ok: true,
        data: { tradeId, systemStatus: 'cannot_determine' },
      });
      const [stored] = await getTestDb().select().from(trades).where(eq(trades.id, tradeId));
      expect(stored).toMatchObject({
        systemStatus: 'cannot_determine',
        systemGrossR: null,
        systemR: null,
        systemOutcome: null,
        systemPlanProvenance: 'unknown',
        planAdherence: 'not_followed',
      });
      expect(stored?.systemDependencySnapshot).not.toBeNull();
    });

    it('corrects a resolved System result to no_trade, then back to resolved', async () => {
      const { tradeId } = await createdTrade();
      await resolveSystemTradeAction(resolveInput(tradeId));
      const toNoTrade = await correctSystemResolutionAction({ tradeId, target: 'no_trade' });
      expect(toNoTrade).toMatchObject({ ok: true, data: { systemStatus: 'no_trade' } });
      const backToResolved = await correctSystemResolutionAction({
        tradeId,
        target: 'resolved',
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        systemExitedAt: '2026-08-01T12:00:00Z',
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(backToResolved).toMatchObject({ ok: true, data: { systemStatus: 'resolved' } });
    });
  });

  // -------------------------------------------------------------------------
  // Rule checks / mistakes
  // -------------------------------------------------------------------------
  describe('updateTradeRuleCheckAction / attachTradeMistakeAction / removeTradeMistakeAction', () => {
    it('updates a Rule check', async () => {
      const fixture = await freshFixture();
      const ruleKey = crypto.randomUUID();
      const rule = await createStrategyRule(
        fixture.workspaceId,
        fixture.userId,
        fixture.fw.strategyId,
        {
          ruleKey,
          category: 'entry',
          title: 'Confirm setup',
        },
      );
      if (!rule.ok) throw new Error('rule creation failed');
      const created = await createTradeAction(baseCreateInput(fixture.fw));
      if (!created.ok) throw new Error('create failed');

      const result = await updateTradeRuleCheckAction({
        tradeId: created.data.tradeId,
        ruleKey,
        checkStatus: 'followed',
      });
      expect(result).toMatchObject({
        ok: true,
        data: { ruleKey, checkStatus: 'followed' },
      });
      assertJsonSerializable(result);
    });

    it('attaches and removes a canonical Mistake', async () => {
      const { tradeId } = await createdTrade();
      const [mistakeType] = await db.query.mistakeTypes.findMany({
        where: (m, { eq: eqOp }) => eqOp(m.key, 'moved_stop'),
      });
      if (mistakeType === undefined) throw new Error('canonical mistake type missing');

      const attached = await attachTradeMistakeAction({
        tradeId,
        mistakeTypeId: mistakeType.id,
        note: 'moved it under pressure',
      });
      expect(attached).toMatchObject({ ok: true, data: { alreadyAttached: false } });
      assertJsonSerializable(attached);

      const removed = await removeTradeMistakeAction({ tradeId, mistakeTypeId: mistakeType.id });
      expect(removed).toMatchObject({ ok: true, data: { alreadyRemoved: false } });

      const removedAgain = await removeTradeMistakeAction({
        tradeId,
        mistakeTypeId: mistakeType.id,
      });
      expect(removedAgain).toMatchObject({ ok: true, data: { alreadyRemoved: true } });
    });
  });

  describe('replaceTradeEmotionsAction / updateTradeReviewNotesAction', () => {
    it('validates and persists both correction operations through the public action boundary', async () => {
      const { tradeId } = await createdTrade();
      const emotions = await replaceTradeEmotionsAction({
        tradeId,
        emotionKeys: ['calm', 'focused'],
      });
      expect(emotions).toEqual({
        ok: true,
        data: { tradeId, emotionKeys: ['calm', 'focused'] },
      });
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, tradeId)),
      ).toHaveLength(2);

      const review = await updateTradeReviewNotesAction({
        tradeId,
        reviewNotes: 'Stayed patient.',
      });
      expect(review).toEqual({ ok: true, data: { tradeId, reviewNotes: 'Stayed patient.' } });
      const stored = await db.query.trades.findFirst({ where: eq(trades.id, tradeId) });
      expect(stored?.reviewNotes).toBe('Stayed patient.');
      assertJsonSerializable(review);
    });

    it('rejects duplicate Emotion keys at the strict schema boundary', async () => {
      const { tradeId } = await createdTrade();
      expect(
        await replaceTradeEmotionsAction({ tradeId, emotionKeys: ['calm', 'calm'] }),
      ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
    });
  });

  // -------------------------------------------------------------------------
  // Soft delete
  // -------------------------------------------------------------------------
  describe('softDeleteTradeAction', () => {
    it('soft-deletes a Trade and is idempotent on repeat', async () => {
      const { tradeId } = await createdTrade();
      const result = await softDeleteTradeAction({ tradeId });
      expect(result).toMatchObject({ ok: true, data: { tradeId, deleted: true } });
      const repeat = await softDeleteTradeAction({ tradeId });
      expect(repeat).toMatchObject({ ok: true, data: { deleted: true } });
    });
  });

  // -------------------------------------------------------------------------
  // Authorization matrix — fresh mutations denied under read_only/over_limit
  // -------------------------------------------------------------------------
  describe('authorization — every mutation family denied fresh under read_only/over_limit', () => {
    async function readOnlyTradeFixture() {
      const userId = await createUser(db, 'p08c-act-auth-ro');
      const workspaceId = await createWorkspace(db, userId, { status: 'trialing_expired' });
      userIds.push(userId);
      workspaceIds.push(workspaceId);
      actionState.context = { workspaceId, userId };
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      const fw = await createFramework(db, workspaceId, userId);
      const created = await createTradeAction(baseCreateInput(fw));
      if (!created.ok) throw new Error('fixture create failed');
      await openTradeAction({
        tradeId: created.data.tradeId,
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, workspaceId));
      return { tradeId: created.data.tradeId };
    }

    it('denies updateTradePlan/closeTrade/resolveSystemTrade/softDelete under read_only, without revalidating', async () => {
      const { tradeId } = await readOnlyTradeFixture();
      // The fixture's own create+open legitimately revalidated — clear
      // those calls before asserting the read_only denials trigger none.
      revalidatePath.mockClear();

      const planResult = await updateTradePlanAction({ tradeId, notes: 'x' });
      expect(planResult).toMatchObject({ ok: false, error: { code: 'read_only_workspace' } });

      const closeResult = await closeTradeAction({
        tradeId,
        actualExit: '1.108',
        netPnlMinor: '7500',
        exitedAt: '2026-08-01T14:00:00Z',
      });
      expect(closeResult).toMatchObject({ ok: false, error: { code: 'read_only_workspace' } });

      const resolveResult = await resolveSystemTradeAction({
        tradeId,
        resolutionKind: 'price_exit',
        systemExitPrice: '1.11',
        systemExitedAt: '2026-08-01T12:00:00Z',
        systemExitReason: 'target_hit',
        systemCostR: '0',
      });
      expect(resolveResult).toMatchObject({ ok: false, error: { code: 'read_only_workspace' } });

      const deleteResult = await softDeleteTradeAction({ tradeId });
      expect(deleteResult).toMatchObject({ ok: false, error: { code: 'read_only_workspace' } });

      expect(revalidatePath).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Public error mapping / serialization proof
  // -------------------------------------------------------------------------
  describe('createCompletedTradeAction', () => {
    /** Save Closed Trade: the Add Trade contract After Trade payload. */
    function completedPayload(fw: Framework, overrides: Record<string, unknown> = {}) {
      return {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        recordingTiming: 'after_trade',
        recordingContract: 'add_trade_v1',
        symbol: 'EURUSD',
        direction: 'long' as const,
        ...overrides,
      };
    }

    /*
      ACTUAL RISK IS RETIRED FROM CAPTURE (contract decision 56). Both new-trade
      Saves refuse it at the boundary — a stale client or a regression is
      visible, never quietly trimmed — and write nothing; the same Saves
      without it succeed and store no Actual Risk.
    */
    /*
      ONE CLOSING MODEL (decision 57), end to end: the payload the Record
      Closed form builds from how the Trade closed is accepted by the real
      Save and stored as an exit-derived result the service re-checked. A
      partial close stores its exits and no Final Net P&L.
    */
    describe('the close is the result (decision 57)', () => {
      function drafted(fw: Framework, close: (draft: AfterTradeDraft) => AfterTradeDraft) {
        const draft = close({
          ...createAfterTradeDraft(fw.tradingAccountId),
          symbol: 'EURUSD',
          direction: 'long',
          riskState: 'defined',
          risk: '50',
        });
        const payload = buildAfterTradePayload(draft, {
          currency: 'USD',
          timezone: 'UTC',
          now: new Date(),
          mutationKey: crypto.randomUUID(),
          options: { strategies: [], exitPlans: [] },
        });
        if (payload === null) throw new Error('draft not ready');
        return payload;
      }

      function inParts(
        draft: AfterTradeDraft,
        legs: readonly Partial<Omit<AfterTradeDraft['exits'][number], 'id'>>[],
      ) {
        let next = setCloseMode(draft, 'in_parts');
        legs.forEach((leg, index) => {
          next = updateExit(addExit(next, `leg-${index}`), `leg-${index}`, leg);
        });
        return next;
      }

      async function saved(tradeId: string) {
        const [row] = await db.select().from(trades).where(eq(trades.id, tradeId));
        const exits = await db.select().from(tradeExits).where(eq(tradeExits.tradeId, tradeId));
        return { row, exits };
      }

      it('saves a full close of +80 as Final Net P&L +80 and +1.60R, from its one exit', async () => {
        const { fw } = await freshFixture();
        const result = await createCompletedTradeAction(
          drafted(fw, (draft) =>
            updateFullClose(setCloseMode(draft, 'all_at_once'), { pnl: '80' }),
          ),
        );
        if (!result.ok) throw new Error(`save failed: ${result.error.code}`);
        const { row, exits } = await saved(result.data.tradeId);
        expect(row).toMatchObject({
          netPnlMinor: 8_000n,
          finalPnlSource: 'exit_history',
          exitHistoryCompleteness: 'complete',
          actualR: '1.6000',
          traderOutcome: null,
        });
        expect(exits).toHaveLength(1);
        expect(exits[0]).toMatchObject({ exitScope: 'all_remaining', realizedPnlMinor: 8_000n });
      });

      it('saves closed parts as the sum of their P&L', async () => {
        const { fw } = await freshFixture();
        const result = await createCompletedTradeAction(
          drafted(fw, (draft) =>
            inParts(draft, [
              { scope: 'part', closedPercent: '30', pnl: '20' },
              { scope: 'part', closedPercent: '30', pnl: '15' },
              { scope: 'all_remaining', pnl: '45' },
            ]),
          ),
        );
        if (!result.ok) throw new Error(`save failed: ${result.error.code}`);
        const { row, exits } = await saved(result.data.tradeId);
        expect(row).toMatchObject({
          netPnlMinor: 8_000n,
          finalPnlSource: 'exit_history',
          exitHistoryCompleteness: 'complete',
          actualR: '1.6000',
        });
        expect(exits).toHaveLength(3);
      });

      it('saves a partial close with its exits and no Final Net P&L', async () => {
        const { fw } = await freshFixture();
        const result = await createCompletedTradeAction(
          drafted(fw, (draft) =>
            inParts(draft, [
              { scope: 'part', closedPercent: '30', pnl: '20' },
              { scope: 'part', closedPercent: '30', pnl: '15' },
            ]),
          ),
        );
        if (!result.ok) throw new Error(`save failed: ${result.error.code}`);
        const { row, exits } = await saved(result.data.tradeId);
        expect(row).toMatchObject({
          netPnlMinor: null,
          finalPnlSource: null,
          exitHistoryCompleteness: null,
          actualR: null,
        });
        expect(exits).toHaveLength(2);
      });
    });

    it('refuses a retired Actual Risk on Record Open and Record Closed, and saves without it', async () => {
      const { fw } = await freshFixture();
      const openPayload = (overrides: Record<string, unknown> = {}) => ({
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        recordingTiming: 'at_entry',
        recordingContract: 'add_trade_v1',
        systemPlanBasis: 'money',
        symbol: 'XAUUSD',
        direction: 'long' as const,
        plannedRiskState: 'defined',
        plannedRiskMinor: '5000',
        ...overrides,
      });
      const before = (await db.select().from(trades)).length;

      for (const retired of [
        { actualRiskAnswer: 'matched' },
        { actualRiskAnswer: 'different', actualInitialRiskMinor: '6000' },
        { actualInitialRiskMinor: '6000' },
      ]) {
        expect(await createTradeAction(openPayload(retired))).toMatchObject({
          ok: false,
          error: { code: 'validation_error' },
        });
        expect(
          await createCompletedTradeAction(
            completedPayload(fw, { plannedRiskMinor: '5000', ...retired }),
          ),
        ).toMatchObject({ ok: false, error: { code: 'validation_error' } });
      }
      // A Record Open amount is named at its field.
      expect(
        await createTradeAction(openPayload({ actualInitialRiskMinor: '6000' })),
      ).toMatchObject({ error: { fieldErrors: { actualInitialRiskMinor: expect.any(Array) } } });
      // Nothing was written by any refused Save.
      expect((await db.select().from(trades)).length).toBe(before);

      // Normal saves still work, and store no Actual Risk.
      const opened = await createTradeAction(openPayload());
      const closed = await createCompletedTradeAction(
        completedPayload(fw, { plannedRiskMinor: '5000', finalPnlMinor: '7500' }),
      );
      if (!opened.ok || !closed.ok) throw new Error('normal saves failed');
      for (const tradeId of [opened.data.tradeId, closed.data.tradeId]) {
        const [row] = await db.select().from(trades).where(eq(trades.id, tradeId));
        expect(row).toMatchObject({ actualRiskAnswer: null, actualInitialRiskMinor: null });
      }
    });

    it('returns a stable serializable closed result and exact replay', async () => {
      const { fw } = await freshFixture();
      const exitedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const input = completedPayload(fw, {
        exitedAt,
        plannedRiskMinor: '5000',
        finalPnlMinor: '10000',
        traderOutcome: 'win',
      });
      const first = await createCompletedTradeAction(input);
      expect(first).toMatchObject({
        ok: true,
        data: {
          alreadyCreated: false,
          status: 'closed',
          actualR: '2.0000',
          traderOutcome: 'win',
          systemStatus: 'pending',
          recordedRetrospectively: true,
        },
      });
      assertJsonSerializable(first);
      if (!first.ok) return;

      expect(
        await db.query.trades.findFirst({ where: eq(trades.id, first.data.tradeId) }),
      ).toMatchObject({
        status: 'closed',
        recordingContract: 'add_trade_v1',
        actualResultMode: 'money',
        netPnlMinor: 10000n,
        actualR: '2.0000',
        traderOutcome: 'win',
        systemStatus: 'pending',
        systemR: null,
        systemOutcome: null,
      });

      const replay = await createCompletedTradeAction(input);
      expect(replay).toEqual({
        ...first,
        data: { ...(first.ok ? first.data : {}), alreadyCreated: true },
      });
      assertJsonSerializable(replay);
    });

    it('normalizes blank historical facts to not recorded, never zero, and chooses no outcome', async () => {
      const { fw } = await freshFixture();
      const result = await createCompletedTradeAction(
        completedPayload(fw, {
          enteredAt: '',
          exitedAt: '',
          plannedRiskMinor: '',
          finalPnlMinor: '400',
          plannedRewardMinor: '',
          targetPrice: '',
          exits: [],
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        data: { actualR: null, traderOutcome: null, recordedRetrospectively: false },
      });
      assertJsonSerializable(result);
      if (!result.ok) return;
      expect(
        await db.query.trades.findFirst({ where: eq(trades.id, result.data.tradeId) }),
      ).toMatchObject({
        enteredAt: null,
        exitedAt: null,
        plannedRiskMinor: null,
        netPnlMinor: 400n,
        finalPnlSource: 'manual_total',
        actualR: null,
        traderOutcome: null,
        traderOutcomeSelectedAt: null,
      });
    });

    it('accepts an outcome that contradicts the P&L sign — a notice, never a block', async () => {
      const { fw } = await freshFixture();
      const result = await createCompletedTradeAction(
        completedPayload(fw, { finalPnlMinor: '-250', traderOutcome: 'win' }),
      );
      expect(result).toMatchObject({ ok: true, data: { traderOutcome: 'win' } });
    });

    it('refuses the retired result basis, unknown fields and malformed coverage at the strict boundary', async () => {
      const { fw } = await freshFixture();
      for (const invalid of [
        completedPayload(fw, { actualResultBasis: 'price' }),
        completedPayload(fw, { actualEntry: '1.1', actualInitialStop: '1.09' }),
        completedPayload(fw, { exits: [{ closedBps: 9_999, injected: true }] }),
        completedPayload(fw, { recordingContract: undefined }),
      ]) {
        const result = await createCompletedTradeAction(invalid);
        expect(result).toMatchObject({ ok: false, error: { code: 'validation_error' } });
        expect(
          await db.query.trades.findFirst({ where: eq(trades.mutationKey, invalid.mutationKey) }),
        ).toBeUndefined();
        assertJsonSerializable(result);
      }
      expect(revalidatePath).not.toHaveBeenCalled();
    });

    it('blocks only an explicitly chosen answer that is incomplete as chosen', async () => {
      const { fw } = await freshFixture();
      const fixed = await createCompletedTradeAction(
        completedPayload(fw, { targetState: 'fixed' }),
      );
      expect(fixed).toMatchObject({
        ok: false,
        error: { code: 'validation_error', fieldErrors: { targetState: expect.any(Array) } },
      });
      // Retired from capture (decision 56): not a field of this Save at all.
      const matched = await createCompletedTradeAction(
        completedPayload(fw, { actualRiskAnswer: 'matched' }),
      );
      expect(matched).toMatchObject({ ok: false, error: { code: 'validation_error' } });
      const inherited = await createCompletedTradeAction(
        completedPayload(fw, {
          strategyId: fw.strategyId,
          exitPlan: {
            state: 'saved',
            exitPlanId: crypto.randomUUID(),
            provenance: 'strategy_default',
          },
        }),
      );
      expect(inherited).toMatchObject({
        ok: false,
        error: { code: 'validation_error', fieldErrors: { exitPlan: expect.any(Array) } },
      });
    });

    it('exposes serializable explicit adoption, correction, and manual-ownership actions', async () => {
      const { fw } = await freshFixture();
      const created = await createCompletedTradeAction(
        completedPayload(fw, {
          plannedRiskMinor: '200',
          traderOutcome: 'win',
          exitHistoryCompleteness: 'complete',
          exits: [
            { closedBps: 4000, exitScope: 'part', realizedPnlMinor: '100', exitedAt: '' },
            {
              closedBps: 6000,
              exitScope: 'all_remaining',
              realizedPnlMinor: '300',
              exitedAt: '',
            },
          ],
        }),
      );
      if (!created.ok) throw new Error('historical action fixture failed');

      const adopted = await adoptHistoricalExitSubtotalAction({ tradeId: created.data.tradeId });
      expect(adopted).toMatchObject({
        ok: true,
        data: {
          tradeId: created.data.tradeId,
          netPnlMinor: '400',
          finalPnlSource: 'exit_history',
          exitSubtotalMinor: '400',
          reconciliation: 'matched',
          actualR: '2.0000',
          traderOutcome: 'win',
        },
      });
      assertJsonSerializable(adopted);

      const exits = await db
        .select()
        .from(tradeExits)
        .where(eq(tradeExits.tradeId, created.data.tradeId))
        .orderBy(tradeExits.sequence);
      // Editing exits after adoption never rewrites Final Net P&L on a contract row.
      const corrected = await applyHistoricalExitHistoryCorrectionAction({
        tradeId: created.data.tradeId,
        exitHistoryCompleteness: 'complete',
        exits: [
          { exitId: exits[0]!.id, closedBps: 4000, realizedPnlMinor: '-100' },
          { exitId: exits[1]!.id, closedBps: 6000, realizedPnlMinor: '100' },
        ],
      });
      expect(corrected).toMatchObject({
        ok: true,
        data: {
          netPnlMinor: '400',
          finalPnlSource: 'manual_total',
          reconciliation: 'conflict',
          traderOutcome: 'win',
        },
      });
      assertJsonSerializable(corrected);

      const manual = await editHistoricalFinalResultAction({
        tradeId: created.data.tradeId,
        finalPnlMinor: '0',
      });
      expect(manual).toMatchObject({
        ok: true,
        data: {
          netPnlMinor: '0',
          finalPnlSource: 'manual_total',
          reconciliation: 'matched',
          traderOutcome: 'win',
        },
      });
      assertJsonSerializable(manual);
    });
  });

  // -------------------------------------------------------------------------
  describe('public error mapping and serialization', () => {
    it('never leaks a raw SQL/internal error for a not-found Trade', async () => {
      await freshFixture();
      const result = await updateTradePlanAction({ tradeId: crypto.randomUUID(), notes: 'x' });
      expect(result).toMatchObject({ ok: false, error: { code: 'trade_not_found' } });
      assertJsonSerializable(result);
    });

    it('a cross-workspace Trade id collapses to trade_not_found, not a distinguishable error', async () => {
      const first = await createdTrade();
      await freshFixture(); // switches actionState.context to a second workspace
      const result = await updateTradePlanAction({ tradeId: first.tradeId, notes: 'x' });
      expect(result).toMatchObject({ ok: false, error: { code: 'trade_not_found' } });
    });

    it('every successful Action result in this suite is JSON round-trip safe', async () => {
      const { tradeId } = await createdTrade();
      const result = await openTradeAction({
        tradeId,
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      assertJsonSerializable(result);
    });
  });
});
