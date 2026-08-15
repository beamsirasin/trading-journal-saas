import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  strategyVersions,
  tradeRuleChecks,
  trades,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { createSetup, createStrategy, createStrategyRule } from './strategy-management';
import {
  cancelTrade,
  closeTrade,
  correctSystemResolution,
  correctTradeExecution,
  correctTradeIdentity,
  createTrade,
  markSystemNoTrade,
  openTrade,
  resolveSystemTrade,
  softDeleteTrade,
  updateTradePlan,
  type CreateTradeInput,
} from './trade-management';

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

interface WorkspaceOptions {
  readonly entitlement?: Partial<typeof workspaceEntitlements.$inferInsert>;
}

async function createWorkspace(
  db: Db,
  ownerUserId: string,
  options: WorkspaceOptions = {},
): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 08B test workspace',
      slug: `p08b-${crypto.randomUUID()}`,
      kind: 'personal',
    })
    .returning({ id: workspaces.id });
  if (workspace === undefined) throw new Error('failed to insert test workspace');
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ownerUserId, role: 'owner' });
  await db.insert(workspaceEntitlements).values({
    workspaceId: workspace.id,
    status: 'active',
    planKey: 'professional',
    billingCurrency: 'USD',
    billingInterval: 'monthly',
    currentPeriodStartedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    currentPeriodEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    ...options.entitlement,
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
  readonly strategyVersionId: string;
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
    name: 'Phase 08B Test Strategy',
  });
  if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
  const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
    mutationKey: crypto.randomUUID(),
    name: 'Phase 08B Test Setup',
    sortOrder: 0,
  });
  if (!setup.ok) throw new Error(`setup creation failed: ${setup.code}`);
  // `createSetup`'s own `versionId` is the STRATEGY Version id (matching
  // `createStrategy`'s return shape) — the Setup Version SNAPSHOT row id
  // (`strategy_setup_versions.id`, what `trades.setup_version_id` actually
  // references) must be resolved separately.
  const snapshot = await db.query.strategySetupVersions.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.strategyVersionId, setup.versionId), eqOp(t.setupId, setup.setupId)),
  });
  if (snapshot === undefined) throw new Error('setup snapshot missing immediately after creation');
  return {
    tradingAccountId,
    strategyId: strategy.strategyId,
    strategyVersionId: strategy.versionId,
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
    symbol: 'EURUSD',
    direction: 'long',
    plannedEntry: '1.1000000000',
    plannedStop: '1.0950000000',
    plannedTarget: '1.1100000000',
    ...overrides,
  };
}

describe('trade-management (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let otherActorUserId: string;
  const allWorkspaceIds: string[] = [];

  beforeAll(async () => {
    actorUserId = await createUser(db, 'p08b-actor');
    otherActorUserId = await createUser(db, 'p08b-other-actor');
    workspaceId = await createWorkspace(db, actorUserId);
    otherWorkspaceId = await createWorkspace(db, otherActorUserId);
    allWorkspaceIds.push(workspaceId, otherWorkspaceId);
  });

  afterAll(async () => {
    for (const id of allWorkspaceIds) {
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await closeTestDb();
  });

  // Every test that calls freshFramework()/createAccount() adds another
  // active Trading Account to the shared `workspaceId`/`otherWorkspaceId`.
  // Archiving them after each test keeps the count under the Professional
  // plan's 15-account limit across the whole suite — archived accounts
  // never count toward it, and no test in this file depends on a PREVIOUS
  // test's account still being active.
  afterEach(async () => {
    await db
      .update(tradingAccounts)
      .set({ isArchived: true })
      .where(
        and(
          inArray(tradingAccounts.workspaceId, [workspaceId, otherWorkspaceId]),
          eq(tradingAccounts.isArchived, false),
        ),
      );
  });

  async function freshFramework(ws: string = workspaceId, actor: string = actorUserId) {
    return createFramework(db, ws, actor);
  }

  async function readTrade(tradeId: string) {
    const [row] = await db.select().from(trades).where(eq(trades.id, tradeId));
    return row;
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------
  describe('createTrade', () => {
    it('accepts a valid planned Trade', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result).toMatchObject({ ok: true, alreadyCreated: false });
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.status).toBe('planned');
      expect(row?.systemStatus).toBe('pending');
    });

    it('Target optional => planned_r null', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedTarget: null }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.plannedTarget).toBeNull();
      expect(row?.plannedR).toBeNull();
    });

    it('Target present => planned_r calculated by composePlanned', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      // risk = 1.10 - 1.095 = 0.005; reward = 1.11 - 1.10 = 0.01; R = 2.0000
      expect(row?.plannedR).toBe('2.0000');
    });

    it('rejects a wrong-side Stop', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedStop: '1.1050000000' }), // above entry for a long
      );
      expect(result).toMatchObject({
        ok: false,
        code: 'invalid_plan',
        calcReason: 'invalid_risk_direction',
      });
    });

    it('rejects a wrong-side Target', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedTarget: '1.0900000000' }), // below entry for a long
      );
      expect(result).toMatchObject({
        ok: false,
        code: 'invalid_plan',
        calcReason: 'invalid_target_direction',
      });
    });

    it('rejects an archived Trading Account', async () => {
      const fw = await freshFramework();
      const archivedAccountId = await createAccount(db, workspaceId, { archived: true });
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { tradingAccountId: archivedAccountId }),
      );
      expect(result).toMatchObject({ ok: false, code: 'trading_account_archived' });
    });

    it('rejects an archived Strategy', async () => {
      const fw = await freshFramework();
      const { archiveStrategy } = await import('./strategy-management');
      await archiveStrategy(workspaceId, actorUserId, fw.strategyId);
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });
    });

    it('rejects an archived Setup', async () => {
      const fw = await freshFramework();
      const { archiveSetup } = await import('./strategy-management');
      await archiveSetup(workspaceId, actorUserId, fw.strategyId, fw.setupId);
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result).toMatchObject({ ok: false, code: 'setup_archived' });
    });

    it('rejects a cross-workspace Trading Account', async () => {
      const fw = await freshFramework();
      const foreignAccountId = await createAccount(db, otherWorkspaceId);
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { tradingAccountId: foreignAccountId }),
      );
      expect(result).toMatchObject({ ok: false, code: 'trading_account_not_found' });
    });

    it('rejects a cross-workspace Strategy', async () => {
      const fw = await freshFramework();
      const foreignFw = await freshFramework(otherWorkspaceId, otherActorUserId);
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { strategyId: foreignFw.strategyId }),
      );
      expect(result).toMatchObject({ ok: false, code: 'strategy_not_found' });
    });

    it('rejects a cross-workspace Setup', async () => {
      const fw = await freshFramework();
      const foreignFw = await freshFramework(otherWorkspaceId, otherActorUserId);
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { setupId: foreignFw.setupId }),
      );
      expect(result).toMatchObject({ ok: false, code: 'setup_not_found' });
    });

    it('pins the current Strategy Version and the correct Setup Version', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.strategyVersionId).toBe(fw.strategyVersionId);
      expect(row?.setupVersionId).toBe(fw.setupVersionId);
    });

    it('never observes a Setup Version belonging to a different Setup in the same Version', async () => {
      const fw = await freshFramework();
      const setupB = await createSetup(workspaceId, actorUserId, fw.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Setup B',
        sortOrder: 1,
      });
      if (!setupB.ok) throw new Error('setup B creation failed');
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { setupId: fw.setupId }),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.setupVersionId).toBe(fw.setupVersionId);
      expect(row?.setupVersionId).not.toBe(setupB.versionId);
    });

    it('locks the Strategy Version on first reference and emits exactly one lock event', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);

      const [versionRow] = await db
        .select()
        .from(strategyVersions)
        .where(eq(strategyVersions.id, fw.strategyVersionId));
      expect(versionRow?.lockedAt).not.toBeNull();

      const lockEvents = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'strategy.version.locked'),
            eq(auditLogs.entityId, fw.strategyVersionId),
          ),
        );
      expect(lockEvents).toHaveLength(1);
    });

    it('a second Trade against the SAME Version does not re-lock or re-emit', async () => {
      const fw = await freshFramework();
      await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      await createTrade(workspaceId, actorUserId, basePlanInput(fw));

      const lockEvents = await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.action, 'strategy.version.locked'),
            eq(auditLogs.entityId, fw.strategyVersionId),
          ),
        );
      expect(lockEvents).toHaveLength(1);
    });

    it('snapshots applicable Strategy-level and selected-Setup-level Rules, excludes other Setups', async () => {
      const fw = await freshFramework();
      const setupB = await createSetup(workspaceId, actorUserId, fw.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Setup B',
        sortOrder: 1,
      });
      if (!setupB.ok) throw new Error('setup B creation failed');

      const strategyRuleKey = crypto.randomUUID();
      const setupARuleKey = crypto.randomUUID();
      const setupBRuleKey = crypto.randomUUID();
      const strategyRule = await createStrategyRule(workspaceId, actorUserId, fw.strategyId, {
        ruleKey: strategyRuleKey,
        category: 'risk',
        title: 'Strategy-level risk rule',
      });
      const setupARule = await createStrategyRule(workspaceId, actorUserId, fw.strategyId, {
        ruleKey: setupARuleKey,
        setupId: fw.setupId,
        category: 'entry',
        title: 'Setup A entry rule',
      });
      const setupBRule = await createStrategyRule(workspaceId, actorUserId, fw.strategyId, {
        ruleKey: setupBRuleKey,
        setupId: setupB.setupId,
        category: 'entry',
        title: 'Setup B entry rule',
      });
      if (!strategyRule.ok || !setupARule.ok || !setupBRule.ok) {
        throw new Error('rule creation failed');
      }

      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const checks = await db
        .select()
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.tradeId, result.tradeId));
      const ruleKeys = checks.map((c) => c.ruleKey).sort();
      expect(ruleKeys).toEqual([strategyRuleKey, setupARuleKey].sort());
      expect(ruleKeys).not.toContain(setupBRuleKey);
      expect(checks.every((c) => c.checkStatus === 'not_checked')).toBe(true);
    });

    it('a Trade against a Strategy with no Rules gets no Rule checks', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const checks = await db
        .select()
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.tradeId, result.tradeId));
      expect(checks).toHaveLength(0);
    });

    describe('idempotent replay', () => {
      it('an exact mutationKey replay returns the same Trade, with no duplicate rows, checks, or audit events', async () => {
        const fw = await freshFramework();
        const input = basePlanInput(fw);
        const first = await createTrade(workspaceId, actorUserId, input);
        const second = await createTrade(workspaceId, actorUserId, input);
        expect(first.ok && second.ok).toBe(true);
        if (!first.ok || !second.ok) return;
        expect(second.tradeId).toBe(first.tradeId);
        expect(second.alreadyCreated).toBe(true);

        const rows = await db
          .select()
          .from(trades)
          .where(eq(trades.mutationKey, input.mutationKey));
        expect(rows).toHaveLength(1);

        const createdEvents = await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.action, 'trade.created'), eq(auditLogs.entityId, first.tradeId)));
        expect(createdEvents).toHaveLength(1);
      });

      it('remains replayable after the workspace becomes read_only', async () => {
        const roUser = await createUser(db, 'p08b-ro-user');
        const roWorkspace = await createWorkspace(db, roUser, {
          entitlement: {
            status: 'trialing',
            planKey: null,
            trialStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
            trialEndsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
            currentPeriodStartedAt: null,
            currentPeriodEndsAt: null,
          },
        });
        allWorkspaceIds.push(roWorkspace);

        // Create while the trial is still writable by setting a future end
        // date first, then flip it to expired to simulate the pass of time.
        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, roWorkspace));

        const fw = await freshFramework(roWorkspace, roUser);
        const input = basePlanInput(fw);
        const created = await createTrade(roWorkspace, roUser, input);
        expect(created.ok).toBe(true);

        await db
          .update(workspaceEntitlements)
          .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
          .where(eq(workspaceEntitlements.workspaceId, roWorkspace));

        const replay = await createTrade(roWorkspace, roUser, input);
        expect(replay).toMatchObject({ ok: true, alreadyCreated: true });
      });

      it('denies a removed member replaying an old mutationKey', async () => {
        const memberUser = await createUser(db, 'p08b-removed-member');
        const memberWorkspace = await createWorkspace(db, memberUser);
        allWorkspaceIds.push(memberWorkspace);

        const fw = await freshFramework(memberWorkspace, memberUser);
        const input = basePlanInput(fw);
        const created = await createTrade(memberWorkspace, memberUser, input);
        expect(created.ok).toBe(true);

        await db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, memberWorkspace),
              eq(workspaceMembers.userId, memberUser),
            ),
          );

        const replay = await createTrade(memberWorkspace, memberUser, input);
        expect(replay).toMatchObject({ ok: false, code: 'workspace_access_denied' });
      });

      it("a mutationKey reused in a different workspace never leaks the first workspace's Trade identity", async () => {
        const sharedKey = crypto.randomUUID();
        const fwA = await freshFramework(workspaceId, actorUserId);
        const fwB = await freshFramework(otherWorkspaceId, otherActorUserId);

        const createdA = await createTrade(
          workspaceId,
          actorUserId,
          basePlanInput(fwA, { mutationKey: sharedKey }),
        );
        const createdB = await createTrade(
          otherWorkspaceId,
          otherActorUserId,
          basePlanInput(fwB, { mutationKey: sharedKey }),
        );
        expect(createdA.ok && createdB.ok).toBe(true);
        if (!createdA.ok || !createdB.ok) return;
        expect(createdB.tradeId).not.toBe(createdA.tradeId);
        expect(createdB.alreadyCreated).toBe(false);

        const rowB = await readTrade(createdB.tradeId);
        expect(rowB?.workspaceId).toBe(otherWorkspaceId);
      });
    });

    describe('version-pinning across a copy-on-write', () => {
      it('a later Trade against the same Strategy pins the NEW current Version after copy-on-write', async () => {
        const fw = await freshFramework();
        const first = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
        expect(first.ok).toBe(true);

        // The first Trade locked v1; editing it now forces copy-on-write to v2.
        const { updateStrategyContent } = await import('./strategy-management');
        const updated = await updateStrategyContent(workspaceId, actorUserId, fw.strategyId, {
          name: 'Phase 08B Test Strategy v2',
          changeNote: 'force copy-on-write for version-pinning test',
        });
        if (!updated.ok) throw new Error('update failed');
        expect(updated.versionId).not.toBe(fw.strategyVersionId);

        const setupV2 = await db.query.strategySetupVersions.findFirst({
          where: (t, { and: andOp, eq: eqOp }) =>
            andOp(eqOp(t.strategyVersionId, updated.versionId), eqOp(t.setupId, fw.setupId)),
        });
        if (setupV2 === undefined) throw new Error('setup snapshot missing in v2');

        const secondAccount = await createAccount(db, workspaceId);
        const second = await createTrade(
          workspaceId,
          actorUserId,
          basePlanInput(fw, { tradingAccountId: secondAccount }),
        );
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        const row = await readTrade(second.tradeId);
        expect(row?.strategyVersionId).toBe(updated.versionId);
        expect(row?.setupVersionId).toBe(setupV2.id);
      });

      it('an early validation failure never reaches — and never spuriously repeats — the Version-lock step', async () => {
        const fw = await freshFramework();
        await createTrade(workspaceId, actorUserId, basePlanInput(fw)); // locks the version once

        const { archiveSetup } = await import('./strategy-management');
        await archiveSetup(workspaceId, actorUserId, fw.strategyId, fw.setupId);
        const failed = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
        expect(failed).toMatchObject({ ok: false, code: 'setup_archived' });

        const lockEvents = await db
          .select()
          .from(auditLogs)
          .where(
            and(
              eq(auditLogs.action, 'strategy.version.locked'),
              eq(auditLogs.entityId, fw.strategyVersionId),
            ),
          );
        expect(lockEvents).toHaveLength(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Price/Money independence (Founder-UAT Trade Plan UX correction slice,
  // migration 0010) — against a real database, so `trades_planned_price_shape_check`/
  // `trades_planned_money_check`/`trades_plan_minimum_check`/`trades_confidence_check`
  // are exercised for real, not merely assumed from the Zod/service layer.
  // -------------------------------------------------------------------------
  describe('createTrade — Price/Money independence (migration 0010)', () => {
    it('accepts a Money-only Plan (no Price fields at all) and persists null Price columns', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedRiskMinor: 5000n,
        plannedRewardMinor: 15000n,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedStop).toBeNull();
      expect(row?.plannedTarget).toBeNull();
      expect(row?.plannedRiskMinor).toBe(5000n);
      expect(row?.plannedRewardMinor).toBe(15000n);
      expect(row?.plannedR).toBe('3.0000');
    });

    it('accepts Price and Money together when they agree, Price-precedence stored in planned_r', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedRiskMinor: 5000n, plannedRewardMinor: 10000n }), // Money R = 2.0000, matches Price R
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.plannedR).toBe('2.0000');
      expect(row?.plannedRiskMinor).toBe(5000n);
    });

    it('rejects Price and Money that disagree beyond tolerance — nothing is persisted', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedRiskMinor: 5000n, plannedRewardMinor: 50000n }), // Money R = 10.0000, Price R = 2.0000
      );
      expect(result).toMatchObject({ ok: false, code: 'planned_r_mismatch' });
    });

    it('rejects neither Price nor Money present (no_plan_representation)', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        symbol: 'EURUSD',
        direction: 'long',
      });
      expect(result).toMatchObject({ ok: false, code: 'no_plan_representation' });
    });

    it('rejects a non-positive plannedRiskMinor at the database layer even if it slipped past the service (defense in depth)', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedRiskMinor: -1n,
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'invalid_plan',
        calcReason: 'invalid_planned_risk',
      });
    });

    it('persists Confidence across the five allowed steps (Founder-UAT Confidence redesign)', async () => {
      for (const confidence of [0, 25, 50, 75, 100] as const) {
        const fw = await freshFramework();
        const result = await createTrade(
          workspaceId,
          actorUserId,
          basePlanInput(fw, { confidence }),
        );
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const row = await readTrade(result.tradeId);
        expect(row?.confidence).toBe(confidence);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Plan correction
  // -------------------------------------------------------------------------
  describe('updateTradePlan', () => {
    async function createPlanned(overrides: Partial<CreateTradeInput> = {}) {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw, overrides));
      if (!result.ok) throw new Error(`create failed: ${result.code}`);
      return { fw, tradeId: result.tradeId };
    }

    it('adding a Target calculates planned_r', async () => {
      const { tradeId } = await createPlanned({ plannedTarget: null });
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedTarget: '1.1100000000',
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.plannedR).toBe('2.0000');
    });

    it('removing the Target clears planned_r', async () => {
      const { tradeId } = await createPlanned();
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedTarget: null,
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.plannedTarget).toBeNull();
      expect(row?.plannedR).toBeNull();
    });

    it('an Entry/Stop correction recalculates planned_r', async () => {
      const { tradeId } = await createPlanned();
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: '1.1050000000',
      });
      expect(result.ok).toBe(true);
      // risk = 1.105 - 1.095 = 0.010; reward = 1.11 - 1.105 = 0.005; R = 0.5000
      const row = await readTrade(tradeId);
      expect(row?.plannedR).toBe('0.5000');
    });

    it('an invalid correction is rejected atomically — nothing persists', async () => {
      const { tradeId } = await createPlanned();
      const before = await readTrade(tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: '1.0900000000', // now below the stop for a long
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_plan' });
      const after = await readTrade(tradeId);
      expect(after).toEqual(before);
    });

    it('recomputes a resolved System result when Entry/Stop change', async () => {
      const { tradeId } = await createPlanned();
      const resolved = await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(resolved.ok).toBe(true);
      const beforeRow = await readTrade(tradeId);
      expect(beforeRow?.systemR).toBe('2.0000');

      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: '1.1050000000',
      });
      expect(result.ok).toBe(true);
      const afterRow = await readTrade(tradeId);
      // systemGrossR = (1.11 - 1.105) / (1.105 - 1.095) = 0.005 / 0.010 = 0.5
      expect(afterRow?.systemR).toBe('0.5000');
    });

    it('does NOT recompute the resolved System result when only Target changes', async () => {
      const { tradeId } = await createPlanned();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      const before = await readTrade(tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedTarget: '1.1200000000',
      });
      expect(result.ok).toBe(true);
      const after = await readTrade(tradeId);
      expect(after?.systemR).toBe(before?.systemR);
    });

    it('is not gated by Trade status — leaves status unchanged for a canceled Trade', async () => {
      const { tradeId } = await createPlanned();
      await cancelTrade(workspaceId, actorUserId, tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        notes: 'typo fix',
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.status).toBe('canceled');
    });

    // -----------------------------------------------------------------------
    // Price/Money independence (migration 0010)
    // -----------------------------------------------------------------------

    it('clears Entry/Stop down to a Money-only Plan when a Money representation already exists', async () => {
      const { tradeId } = await createPlanned({
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 2000n, // agrees with basePlanInput's Price R (2.0000)
      });
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedStop).toBeNull();
      // Money alone now determines planned_r: 2000/1000 = 2.0000.
      expect(row?.plannedR).toBe('2.0000');
    });

    it('rejects clearing Entry/Stop when no Money representation exists (no_plan_representation)', async () => {
      const { tradeId } = await createPlanned();
      const before = await readTrade(tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: null,
        plannedStop: null,
      });
      expect(result).toMatchObject({ ok: false, code: 'no_plan_representation' });
      const after = await readTrade(tradeId);
      expect(after).toEqual(before);
    });

    it('rejects a patch that would leave Price and Money disagreeing (planned_r_mismatch) — nothing persists', async () => {
      const { tradeId } = await createPlanned(); // Price R = 2.0000
      const before = await readTrade(tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 50000n, // Money R = 50.0000
      });
      expect(result).toMatchObject({ ok: false, code: 'planned_r_mismatch' });
      const after = await readTrade(tradeId);
      expect(after).toEqual(before);
    });

    it('rejects clearing the Price plan while the System result is already resolved (system_requires_price_plan)', async () => {
      const { tradeId } = await createPlanned({
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 2000n, // agrees with basePlanInput's Price R (2.0000)
      });
      const resolved = await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(resolved.ok).toBe(true);
      const before = await readTrade(tradeId);

      // Target must be cleared alongside Entry/Stop here — otherwise a
      // stale Target would orphan itself (Target present, Entry/Stop
      // absent), which `composePlannedR` correctly rejects first as its own
      // `invalid_plan`/`missing_input` fragment error, a real but DIFFERENT
      // validation failure than the one this test targets. A genuine UI
      // correction always resends Target's current value (or null)
      // alongside Entry/Stop — see `PlanCorrectionDialog`.
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
      });
      expect(result).toMatchObject({ ok: false, code: 'system_requires_price_plan' });
      const after = await readTrade(tradeId);
      expect(after).toEqual(before);
    });
  });

  describe('correctTradeIdentity', () => {
    it('a Direction-only flip against a fixed Entry/Stop is always invalid — long/short validity are strict negations', async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, {
          direction: 'long',
          plannedEntry: '1.1000000000',
          plannedStop: '1.0950000000',
          plannedTarget: null,
        }),
      );
      if (!created.ok) throw new Error('create failed');

      const result = await correctTradeIdentity(workspaceId, actorUserId, created.tradeId, {
        direction: 'short',
      });
      // stop (1.095) stays BELOW entry (1.10) — invalid for a short.
      expect(result).toMatchObject({
        ok: false,
        code: 'invalid_plan',
        calcReason: 'invalid_risk_direction',
      });
      const row = await readTrade(created.tradeId);
      expect(row?.direction).toBe('long'); // rejected atomically — nothing persisted
    });

    it('a Direction correction supplied together with corrected Entry/Stop recomputes planned_r (target-less) and system_r when resolved', async () => {
      const fw = await freshFramework();
      // No Target, so the correction cannot also trip an
      // invalid_target_direction failure — isolates the Direction/Entry/Stop
      // recompute behavior specifically.
      const created = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, {
          direction: 'long',
          plannedEntry: '1.1000000000',
          plannedStop: '1.0950000000',
          plannedTarget: null,
        }),
      );
      if (!created.ok) throw new Error('create failed');
      const resolved = await resolveSystemTrade(workspaceId, actorUserId, created.tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(resolved.ok).toBe(true);
      const beforeRow = await readTrade(created.tradeId);
      expect(beforeRow?.systemR).toBe('2.0000'); // (1.11-1.10)/(1.10-1.095)

      // The trader realizes this was actually a short: entry stays, stop
      // moves to the mirrored short-valid side (stop > entry).
      const result = await correctTradeIdentity(workspaceId, actorUserId, created.tradeId, {
        direction: 'short',
        plannedStop: '1.1050000000',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.changedFields).toEqual(
        expect.arrayContaining(['direction', 'plannedStop', 'systemR']),
      );

      const row = await readTrade(created.tradeId);
      expect(row?.direction).toBe('short');
      expect(row?.plannedR).toBeNull(); // still target-less
      // systemGrossR (short) = (entry - exit) / (stop - entry) = (1.10-1.11)/(1.105-1.10) = -2.0000
      expect(row?.systemR).toBe('-2.0000');
      expect(row?.systemOutcome).toBe('loss');
    });

    it('a Symbol-only correction never touches planned_r/system_r', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      const beforeRow = await readTrade(created.tradeId);

      const result = await correctTradeIdentity(workspaceId, actorUserId, created.tradeId, {
        symbol: 'GBPUSD',
      });
      expect(result.ok).toBe(true);
      const afterRow = await readTrade(created.tradeId);
      expect(afterRow?.plannedR).toBe(beforeRow?.plannedR);
      expect(afterRow?.symbol).toBe('GBPUSD');
    });

    it('rejects a blank Symbol', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      const result = await correctTradeIdentity(workspaceId, actorUserId, created.tradeId, {
        symbol: '   ',
      });
      expect(result).toMatchObject({ ok: false, code: 'blank_symbol' });
    });
  });

  // -------------------------------------------------------------------------
  // Open
  // -------------------------------------------------------------------------
  describe('openTrade', () => {
    async function createPlanned() {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!result.ok) throw new Error(`create failed: ${result.code}`);
      return { fw, tradeId: result.tradeId };
    }

    function openInput(overrides: Partial<Parameters<typeof openTrade>[3]> = {}) {
      return {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
        ...overrides,
      };
    }

    it('planned -> open succeeds and persists the exact actual_initial_risk_minor supplied', async () => {
      const { tradeId } = await createPlanned();
      const result = await openTrade(workspaceId, actorUserId, tradeId, openInput());
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.status).toBe('open');
      expect(row?.actualInitialRiskMinor).toBe(5000n);
    });

    it('rejects a non-positive actual_initial_risk_minor', async () => {
      const { tradeId } = await createPlanned();
      const result = await openTrade(
        workspaceId,
        actorUserId,
        tradeId,
        openInput({ actualInitialRiskMinor: 0n }),
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_initial_risk' });
    });

    it('leaves Rule checks not_checked after Open', async () => {
      const fw = await freshFramework();
      await createStrategyRule(workspaceId, actorUserId, fw.strategyId, {
        ruleKey: crypto.randomUUID(),
        category: 'entry',
        title: 'Confirm setup',
      });
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, actorUserId, created.tradeId, openInput());
      const checks = await db
        .select()
        .from(tradeRuleChecks)
        .where(eq(tradeRuleChecks.tradeId, created.tradeId));
      expect(checks.every((c) => c.checkStatus === 'not_checked')).toBe(true);
    });

    it('blocks Open when the Trading Account was archived after Plan', async () => {
      const { fw, tradeId } = await createPlanned();
      // Direct write, not `archiveTradingAccount` — that service refuses to
      // archive a workspace's LAST active account, which this fixture's
      // account often is by this point in the suite; this test's concern is
      // openTrade's own archived-flag recheck, not that business rule.
      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.id, fw.tradingAccountId));
      const result = await openTrade(workspaceId, actorUserId, tradeId, openInput());
      expect(result).toMatchObject({ ok: false, code: 'trading_account_archived' });
    });

    it('blocks Open when the Strategy was archived after Plan', async () => {
      const { fw, tradeId } = await createPlanned();
      const { archiveStrategy } = await import('./strategy-management');
      await archiveStrategy(workspaceId, actorUserId, fw.strategyId);
      const result = await openTrade(workspaceId, actorUserId, tradeId, openInput());
      expect(result).toMatchObject({ ok: false, code: 'strategy_archived' });
    });

    it('blocks Open when the Setup was archived after Plan', async () => {
      const { fw, tradeId } = await createPlanned();
      const { archiveSetup } = await import('./strategy-management');
      await archiveSetup(workspaceId, actorUserId, fw.strategyId, fw.setupId);
      const result = await openTrade(workspaceId, actorUserId, tradeId, openInput());
      expect(result).toMatchObject({ ok: false, code: 'setup_archived' });
    });

    it('rejects opening an already-canceled Trade', async () => {
      const { tradeId } = await createPlanned();
      await cancelTrade(workspaceId, actorUserId, tradeId);
      const result = await openTrade(workspaceId, actorUserId, tradeId, openInput());
      expect(result).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    });
  });

  // -------------------------------------------------------------------------
  // Close
  // -------------------------------------------------------------------------
  describe('closeTrade', () => {
    async function createOpen() {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      const opened = await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      if (!opened.ok) throw new Error('open failed');
      return { fw, tradeId: created.tradeId };
    }

    function closeInput(overrides: Partial<Parameters<typeof closeTrade>[3]> = {}) {
      return {
        actualExit: '1.1080000000',
        netPnlMinor: 7500n,
        exitedAt: new Date('2026-08-01T14:00:00Z'),
        ...overrides,
      };
    }

    it("open -> closed persists composeTraderClose's result", async () => {
      const { tradeId } = await createOpen();
      const result = await closeTrade(workspaceId, actorUserId, tradeId, closeInput());
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.status).toBe('closed');
      // actualR = 7500 / 5000 = 1.5000
      expect(row?.actualR).toBe('1.5000');
      expect(row?.traderOutcome).toBe('win');
      expect(row?.calcVersion).toBe(1);
    });

    it('an exact retry against an already-closed Trade returns success without rewriting', async () => {
      const { tradeId } = await createOpen();
      const input = closeInput();
      await closeTrade(workspaceId, actorUserId, tradeId, input);
      const before = await readTrade(tradeId);
      const retry = await closeTrade(workspaceId, actorUserId, tradeId, input);
      expect(retry.ok).toBe(true);
      const after = await readTrade(tradeId);
      expect(after?.updatedAt).toEqual(before?.updatedAt);
    });

    it('a differing retry against an already-closed Trade is rejected', async () => {
      const { tradeId } = await createOpen();
      await closeTrade(workspaceId, actorUserId, tradeId, closeInput());
      const result = await closeTrade(
        workspaceId,
        actorUserId,
        tradeId,
        closeInput({ netPnlMinor: 8000n }),
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    });

    it('rejects exited_at before entered_at', async () => {
      const { tradeId } = await createOpen();
      const result = await closeTrade(
        workspaceId,
        actorUserId,
        tradeId,
        closeInput({ exitedAt: new Date('2026-08-01T00:00:00Z') }), // before enteredAt 09:00
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_exit_time' });
    });

    it('rejects re-opening a closed Trade', async () => {
      const { tradeId } = await createOpen();
      await closeTrade(workspaceId, actorUserId, tradeId, closeInput());
      const result = await openTrade(workspaceId, actorUserId, tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    });

    it('a post-close correction to net P&L recomputes Actual R and outcome', async () => {
      const { tradeId } = await createOpen();
      await closeTrade(workspaceId, actorUserId, tradeId, closeInput());
      const result = await correctTradeExecution(workspaceId, actorUserId, tradeId, {
        netPnlMinor: -2000n,
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.actualR).toBe('-0.4000');
      expect(row?.traderOutcome).toBe('loss');
    });
  });

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------
  describe('cancelTrade', () => {
    it('planned -> canceled succeeds and carries no Trader result', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      const result = await cancelTrade(workspaceId, actorUserId, created.tradeId);
      expect(result.ok).toBe(true);
      const row = await readTrade(created.tradeId);
      expect(row?.status).toBe('canceled');
      expect(row?.actualR).toBeNull();
      expect(row?.traderOutcome).toBeNull();
    });

    it('is a safe no-op when repeated', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await cancelTrade(workspaceId, actorUserId, created.tradeId);
      const retry = await cancelTrade(workspaceId, actorUserId, created.tradeId);
      expect(retry.ok).toBe(true);
    });

    it('rejects canceling an open Trade', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const result = await cancelTrade(workspaceId, actorUserId, created.tradeId);
      expect(result).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    });
  });

  // -------------------------------------------------------------------------
  // System axis
  // -------------------------------------------------------------------------
  describe('resolveSystemTrade / markSystemNoTrade / correctSystemResolution', () => {
    async function createPlanned() {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      return { fw, tradeId: created.tradeId };
    }

    function resolveInput(overrides: Partial<Parameters<typeof resolveSystemTrade>[3]> = {}) {
      return {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
        ...overrides,
      };
    }

    it('pending -> resolved persists System R/outcome', async () => {
      const { tradeId } = await createPlanned();
      const result = await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.systemStatus).toBe('resolved');
      expect(row?.systemR).toBe('2.0000');
      expect(row?.systemOutcome).toBe('win');
    });

    it('pending -> no_trade persists the no_trade terminal shape', async () => {
      const { tradeId } = await createPlanned();
      const result = await markSystemNoTrade(workspaceId, actorUserId, tradeId);
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.systemStatus).toBe('no_trade');
      expect(row?.systemExitReason).toBe('setup_invalidated');
      expect(row?.systemR).toBeNull();
      expect(row?.systemCostR).toBe('0.0000');
    });

    it('System may resolve while the Trade is still planned', async () => {
      const { tradeId } = await createPlanned();
      const result = await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.status).toBe('planned');
      expect(row?.systemStatus).toBe('resolved');
    });

    it('System may resolve while the Trade is open', async () => {
      const { tradeId } = await createPlanned();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const result = await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      expect(result.ok).toBe(true);
    });

    it('System may remain pending after the Trade closes', async () => {
      const { tradeId } = await createPlanned();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await closeTrade(workspaceId, actorUserId, tradeId, {
        actualExit: '1.1080000000',
        netPnlMinor: 7500n,
        exitedAt: new Date('2026-08-01T14:00:00Z'),
      });
      const row = await readTrade(tradeId);
      expect(row?.status).toBe('closed');
      expect(row?.systemStatus).toBe('pending');
    });

    it('an exact resolved retry is safe and does not rewrite', async () => {
      const { tradeId } = await createPlanned();
      const input = resolveInput();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, input);
      const before = await readTrade(tradeId);
      const retry = await resolveSystemTrade(workspaceId, actorUserId, tradeId, input);
      expect(retry.ok).toBe(true);
      const after = await readTrade(tradeId);
      expect(after?.updatedAt).toEqual(before?.updatedAt);
    });

    it('a differing resolved retry is rejected, directing the caller to correction', async () => {
      const { tradeId } = await createPlanned();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      const result = await resolveSystemTrade(
        workspaceId,
        actorUserId,
        tradeId,
        resolveInput({ systemCostR: '0.1000' }),
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_system_status_transition' });
    });

    it('rejects setup_invalidated as a resolve reason', async () => {
      const { tradeId } = await createPlanned();
      const result = await resolveSystemTrade(
        workspaceId,
        actorUserId,
        tradeId,
        resolveInput({ systemExitReason: 'setup_invalidated' }),
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_system_exit_reason' });
    });

    it('correctSystemResolution: resolved -> resolved recomputes System R/outcome', async () => {
      const { tradeId } = await createPlanned();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      const result = await correctSystemResolution(workspaceId, actorUserId, tradeId, {
        target: 'resolved',
        ...resolveInput({ systemCostR: '0.5000' }),
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.systemR).toBe('1.5000');
    });

    it('correctSystemResolution: resolved -> no_trade', async () => {
      const { tradeId } = await createPlanned();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      const result = await correctSystemResolution(workspaceId, actorUserId, tradeId, {
        target: 'no_trade',
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.systemStatus).toBe('no_trade');
      expect(row?.systemR).toBeNull();
    });

    it('correctSystemResolution: no_trade -> resolved', async () => {
      const { tradeId } = await createPlanned();
      await markSystemNoTrade(workspaceId, actorUserId, tradeId);
      const result = await correctSystemResolution(workspaceId, actorUserId, tradeId, {
        target: 'resolved',
        ...resolveInput(),
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.systemStatus).toBe('resolved');
      expect(row?.systemR).toBe('2.0000');
    });

    it('correctSystemResolution rejects when System is still pending — nothing to correct', async () => {
      const { tradeId } = await createPlanned();
      const result = await correctSystemResolution(workspaceId, actorUserId, tradeId, {
        target: 'resolved',
        ...resolveInput(),
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_system_status_transition' });
    });

    it('markSystemNoTrade rejects when already resolved', async () => {
      const { tradeId } = await createPlanned();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput());
      const result = await markSystemNoTrade(workspaceId, actorUserId, tradeId);
      expect(result).toMatchObject({ ok: false, code: 'invalid_system_status_transition' });
    });
  });

  // -------------------------------------------------------------------------
  // Archived historical parents
  // -------------------------------------------------------------------------
  describe('archived historical parents', () => {
    it('an existing open Trade can still close, System can still resolve, and framework IDs never change', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });

      const { archiveTradingAccount } = await import('./trading-account-management');
      const { archiveStrategy, archiveSetup } = await import('./strategy-management');
      await archiveTradingAccount(workspaceId, actorUserId, fw.tradingAccountId);
      await archiveStrategy(workspaceId, actorUserId, fw.strategyId);
      await archiveSetup(workspaceId, actorUserId, fw.strategyId, fw.setupId);

      const closed = await closeTrade(workspaceId, actorUserId, created.tradeId, {
        actualExit: '1.1080000000',
        netPnlMinor: 7500n,
        exitedAt: new Date('2026-08-01T14:00:00Z'),
      });
      expect(closed.ok).toBe(true);

      const resolved = await resolveSystemTrade(workspaceId, actorUserId, created.tradeId, {
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(resolved.ok).toBe(true);

      const corrected = await correctTradeExecution(workspaceId, actorUserId, created.tradeId, {
        netPnlMinor: 8000n,
      });
      expect(corrected.ok).toBe(true);

      const row = await readTrade(created.tradeId);
      expect(row?.tradingAccountId).toBe(fw.tradingAccountId);
      expect(row?.strategyId).toBe(fw.strategyId);
      expect(row?.strategyVersionId).toBe(fw.strategyVersionId);
      expect(row?.setupId).toBe(fw.setupId);
      expect(row?.setupVersionId).toBe(fw.setupVersionId);
    });
  });

  // -------------------------------------------------------------------------
  // Soft delete
  // -------------------------------------------------------------------------
  describe('softDeleteTrade', () => {
    it('sets deleted_at, keeps the physical row, and is a safe no-op when repeated', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const result = await softDeleteTrade(workspaceId, actorUserId, created.tradeId);
      expect(result.ok).toBe(true);
      const row = await readTrade(created.tradeId);
      expect(row).not.toBeUndefined();
      expect(row?.deletedAt).not.toBeNull();

      const retry = await softDeleteTrade(workspaceId, actorUserId, created.tradeId);
      expect(retry.ok).toBe(true);
    });

    it('denies further mutations as not-found after soft delete', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');
      await softDeleteTrade(workspaceId, actorUserId, created.tradeId);

      const result = await updateTradePlan(workspaceId, actorUserId, created.tradeId, {
        notes: 'should be denied',
      });
      expect(result).toMatchObject({ ok: false, code: 'trade_not_found' });
    });
  });

  // -------------------------------------------------------------------------
  // Authorization
  // -------------------------------------------------------------------------
  describe('authorization', () => {
    async function readOnlyWorkspace() {
      const user = await createUser(db, 'p08b-ro-auth');
      const ws = await createWorkspace(db, user, {
        entitlement: {
          status: 'trialing',
          planKey: null,
          trialStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          trialEndsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
        },
      });
      allWorkspaceIds.push(ws);
      return { user, ws };
    }

    /** Starter's active-account limit is 1 — still writable at exactly 1. */
    async function overLimitWorkspace() {
      const user = await createUser(db, 'p08b-ol-auth');
      const ws = await createWorkspace(db, user, {
        entitlement: { status: 'active', planKey: 'starter' },
      });
      allWorkspaceIds.push(ws);
      return { user, ws };
    }

    it('denies createTrade under a read_only workspace', async () => {
      const { user, ws } = await readOnlyWorkspace();
      // Build the framework while writable (a future-dated trial end),
      // matching entitlement's own required test ordering: the denial being
      // tested is createTrade's, not an incidental failure inside setup.
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, ws));
      const fw = await createFramework(db, ws, user);
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, ws));

      const result = await createTrade(ws, user, basePlanInput(fw));
      expect(result).toMatchObject({ ok: false, code: 'read_only_workspace' });
    });

    it('denies createTrade under an over_limit workspace', async () => {
      const { user, ws } = await overLimitWorkspace();
      // createFramework's own account brings the count to exactly 1 —
      // still writable at the Starter limit. A second account (inserted
      // directly, bypassing the account-creation service's own entitlement
      // gate — the scenario being simulated is an external state change,
      // e.g. a plan downgrade) pushes the workspace over_limit afterward.
      const fw = await createFramework(db, ws, user);
      await createAccount(db, ws);

      const result = await createTrade(ws, user, basePlanInput(fw));
      expect(result).toMatchObject({ ok: false, code: 'over_limit_workspace' });
    });

    it('allows createTrade under a writable workspace', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
    });

    it('denies updateTradePlan / openTrade / closeTrade / resolveSystemTrade / softDeleteTrade under read_only', async () => {
      const { user, ws } = await readOnlyWorkspace();
      // Temporarily writable to create + open a Trade, then flip to read_only.
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, ws));
      const fw = await createFramework(db, ws, user);
      const created = await createTrade(ws, user, basePlanInput(fw));
      if (!created.ok) throw new Error('setup create failed');
      await openTrade(ws, user, created.tradeId, {
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, ws));

      await expect(
        updateTradePlan(ws, user, created.tradeId, { notes: 'x' }),
      ).resolves.toMatchObject({ ok: false, code: 'read_only_workspace' });
      await expect(
        closeTrade(ws, user, created.tradeId, {
          actualExit: '1.1080000000',
          netPnlMinor: 7500n,
          exitedAt: new Date('2026-08-01T14:00:00Z'),
        }),
      ).resolves.toMatchObject({ ok: false, code: 'read_only_workspace' });
      await expect(
        resolveSystemTrade(ws, user, created.tradeId, {
          systemExitPrice: '1.1100000000',
          systemExitedAt: new Date('2026-08-01T12:00:00Z'),
          systemExitReason: 'target_hit',
          systemCostR: '0.0000',
        }),
      ).resolves.toMatchObject({ ok: false, code: 'read_only_workspace' });
      await expect(softDeleteTrade(ws, user, created.tradeId)).resolves.toMatchObject({
        ok: false,
        code: 'read_only_workspace',
      });
    });

    it('a cross-workspace Trade id collapses to not-found', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      const result = await updateTradePlan(otherWorkspaceId, otherActorUserId, created.tradeId, {
        notes: 'should not be visible',
      });
      expect(result).toMatchObject({ ok: false, code: 'trade_not_found' });
    });

    it('denies a removed member from mutating an existing Trade', async () => {
      const memberUser = await createUser(db, 'p08b-removed-mutator');
      const memberWorkspace = await createWorkspace(db, memberUser);
      allWorkspaceIds.push(memberWorkspace);
      const fw = await createFramework(db, memberWorkspace, memberUser);
      const created = await createTrade(memberWorkspace, memberUser, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      await db
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, memberWorkspace),
            eq(workspaceMembers.userId, memberUser),
          ),
        );

      const result = await updateTradePlan(memberWorkspace, memberUser, created.tradeId, {
        notes: 'denied',
      });
      expect(result).toMatchObject({ ok: false, code: 'workspace_access_denied' });
    });
  });

  // -------------------------------------------------------------------------
  // Audit
  // -------------------------------------------------------------------------
  describe('audit', () => {
    it('trade.plan_updated metadata carries only identifiers and field names — never notes/prices', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      await updateTradePlan(workspaceId, actorUserId, created.tradeId, {
        notes: 'a secret note that must never be audited',
        plannedEntry: '1.1010000000',
      });

      const [event] = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'trade.plan_updated'), eq(auditLogs.entityId, created.tradeId)),
        );
      expect(event).toBeDefined();
      const metadata = event?.metadata as Record<string, unknown>;
      expect(metadata.tradeId).toBe(created.tradeId);
      expect(Array.isArray(metadata.changedFields)).toBe(true);
      const serialized = JSON.stringify(metadata);
      expect(serialized).not.toContain('a secret note');
      expect(serialized).not.toContain('1.1010000000');
    });

    it('no-op corrections emit no audit event', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      // Identical values -> no changed fields -> no audit event.
      await updateTradePlan(workspaceId, actorUserId, created.tradeId, {
        plannedEntry: basePlanInput(fw).plannedEntry ?? '1.1000000000',
      });

      const events = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.action, 'trade.plan_updated'), eq(auditLogs.entityId, created.tradeId)),
        );
      expect(events).toHaveLength(0);
    });
  });
});
