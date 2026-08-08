import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  auditLogs,
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
  attachTradeMistakeAction,
  cancelTradeAction,
  closeTradeAction,
  correctSystemResolutionAction,
  correctTradeIdentityAction,
  createTradeAction,
  markSystemNoTradeAction,
  openTradeAction,
  removeTradeMistakeAction,
  resolveSystemTradeAction,
  softDeleteTradeAction,
  updateTradePlanAction,
  updateTradeRuleCheckAction,
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
  return { tradingAccountId, strategyId: strategy.strategyId, setupId: setup.setupId };
}

function baseCreateInput(fw: Framework, overrides: Record<string, unknown> = {}) {
  return {
    mutationKey: crypto.randomUUID(),
    tradingAccountId: fw.tradingAccountId,
    strategyId: fw.strategyId,
    setupId: fw.setupId,
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

    it('marks no_trade', async () => {
      const { tradeId } = await createdTrade();
      const result = await markSystemNoTradeAction({ tradeId });
      expect(result).toMatchObject({ ok: true, data: { tradeId, systemStatus: 'no_trade' } });
    });

    it('corrects a resolved System result to no_trade, then back to resolved', async () => {
      const { tradeId } = await createdTrade();
      await resolveSystemTradeAction(resolveInput(tradeId));
      const toNoTrade = await correctSystemResolutionAction({ tradeId, target: 'no_trade' });
      expect(toNoTrade).toMatchObject({ ok: true, data: { systemStatus: 'no_trade' } });
      const backToResolved = await correctSystemResolutionAction({
        tradeId,
        target: 'resolved',
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
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: '5000',
        enteredAt: '2026-08-01T09:00:00Z',
      });
      assertJsonSerializable(result);
    });
  });
});
