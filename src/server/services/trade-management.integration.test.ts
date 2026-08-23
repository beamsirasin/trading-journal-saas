import { and, asc, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  auditLogs,
  strategies,
  strategySetupVersions,
  strategyVersions,
  tradeExits,
  tradeRuleChecks,
  trades,
  tradeSetupConditionChecks,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import {
  createSetup,
  createSetupCondition,
  createStrategy,
  createStrategyRule,
} from './strategy-management';
import { createCompletedTrade, type CreateCompletedTradeInput } from './trade-completed';
import { addTradeExit, closeRemainingTrade, correctTradeExit } from './trade-execution';
import {
  assignTradeClassification,
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
  type ResolveSystemTradeInput,
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
    it('atomically creates a Trade and snapshots its authoritative Setup Conditions', async () => {
      const fw = await freshFramework();
      const condition = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'Breakout candle closed', sortOrder: 0 },
      );
      if (!condition.ok) throw new Error(`condition creation failed: ${condition.code}`);
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, {
          conditionAnswers: [{ conditionKey: condition.conditionKey, status: 'met' }],
        }),
      );
      expect(result).toMatchObject({ ok: true, alreadyCreated: false });
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.status).toBe('planned');
      expect(row?.systemStatus).toBe('pending');
      const snapshots = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, result.tradeId));
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        workspaceId,
        setupVersionId: fw.setupVersionId,
        conditionKey: condition.conditionKey,
        label: 'Breakout candle closed',
        sortOrder: 0,
        checkStatus: 'met',
      });
    });

    it('persists mixed met/not_met answers and an exact replay does not duplicate snapshots', async () => {
      const fw = await freshFramework();
      const first = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'First condition', sortOrder: 20 },
      );
      const second = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'Second condition', sortOrder: 10 },
      );
      if (!first.ok || !second.ok) throw new Error('condition creation failed');
      const input = basePlanInput(fw, {
        conditionAnswers: [
          { conditionKey: first.conditionKey, status: 'not_met' },
          { conditionKey: second.conditionKey, status: 'met' },
        ],
      });

      const created = await createTrade(workspaceId, actorUserId, input);
      const replay = await createTrade(workspaceId, actorUserId, input);
      expect(created).toMatchObject({ ok: true, alreadyCreated: false });
      expect(replay).toMatchObject({ ok: true, alreadyCreated: true });
      if (!created.ok) return;

      const snapshots = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, created.tradeId))
        .orderBy(asc(tradeSetupConditionChecks.sortOrder));
      expect(snapshots).toHaveLength(2);
      expect(snapshots.map((snapshot) => [snapshot.label, snapshot.checkStatus])).toEqual([
        ['Second condition', 'met'],
        ['First condition', 'not_met'],
      ]);
    });

    it('creates zero Condition snapshots for a genuinely unconfigured Setup', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const snapshots = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, result.tradeId));
      expect(snapshots).toHaveLength(0);
    });

    it('rolls back the Trade when the Condition answer set is incomplete', async () => {
      const fw = await freshFramework();
      const condition = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'Must be answered', sortOrder: 0 },
      );
      if (!condition.ok) throw new Error('condition creation failed');
      const input = basePlanInput(fw, { conditionAnswers: [] });
      const result = await createTrade(workspaceId, actorUserId, input);
      expect(result).toEqual({ ok: false, code: 'incomplete_condition_answers' });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(0);
    });

    it('rejects a cross-workspace Condition key and rolls back the Trade', async () => {
      const fw = await freshFramework();
      const other = await freshFramework(otherWorkspaceId, otherActorUserId);
      const foreign = await createSetupCondition(
        otherWorkspaceId,
        otherActorUserId,
        other.strategyId,
        other.setupId,
        { label: 'Foreign Condition', sortOrder: 0 },
      );
      if (!foreign.ok) throw new Error('foreign condition creation failed');
      const input = basePlanInput(fw, {
        conditionAnswers: [{ conditionKey: foreign.conditionKey, status: 'met' }],
      });
      const result = await createTrade(workspaceId, actorUserId, input);
      expect(result).toEqual({ ok: false, code: 'unknown_condition_answer' });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(0);
    });

    it('rejects answers rendered from the prior Version after a concurrent Strategy edit', async () => {
      const fw = await freshFramework();
      const lockVersion = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!lockVersion.ok) throw new Error('version-locking Trade create failed');
      const changed = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'Added concurrently', sortOrder: 0, changeNote: 'Add entry evidence' },
      );
      if (!changed.ok) throw new Error(`condition edit failed: ${changed.code}`);
      const input = basePlanInput(fw);
      const result = await createTrade(workspaceId, actorUserId, input);
      expect(result).toEqual({ ok: false, code: 'stale_setup_conditions' });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(0);
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
          basePlanInput(fw, {
            tradingAccountId: secondAccount,
            conditionSetToken: createConditionSetToken(setupV2.id),
          }),
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
  // Open/Close-Only Trade Flow (Phase 14E) — the normal customer New Trade
  // form now supplies `actualResultMode` (+ its Price/Money basis), so
  // `createTrade` produces `status = 'open'` in ONE atomic transaction,
  // never a separate `openTrade` call after. Omitting `actualResultMode`
  // still produces the pre-14E `status = 'planned'` shape byte-for-byte
  // (already covered above) — retained internally for backward
  // compatibility, no longer reachable from the normal customer form.
  // -------------------------------------------------------------------------
  describe('createTrade — atomic open-at-creation (Phase 14E)', () => {
    it('creates an already-open Trade from Price mode in one atomic transaction, with no Plan required', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'ATOMICPRICE',
        direction: 'long',
        actualResultMode: 'price',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(result).toMatchObject({ ok: true, alreadyCreated: false });
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.status).toBe('open');
      expect(row?.systemStatus).toBe('pending');
      expect(row?.actualResultMode).toBe('price');
      expect(row?.actualEntry).toBe('1.1005000000');
      expect(row?.actualInitialStop).toBe('1.0950000000');
      expect(row?.actualInitialRiskMinor).toBeNull();
      expect(row?.enteredAt).toEqual(new Date('2026-08-01T09:00:00Z'));
      // No Plan supplied — Plan is optional data, never required to open.
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedStop).toBeNull();
      expect(row?.strategyId).toBeNull();
      expect(row?.setupId).toBeNull();
    });

    it('creates an already-open Trade from Money mode, with no Actual Entry/Stop required', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'ATOMICMONEY',
        direction: 'short',
        actualResultMode: 'money',
        actualInitialRiskMinor: 5_000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(result).toMatchObject({ ok: true, alreadyCreated: false });
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.status).toBe('open');
      expect(row?.actualResultMode).toBe('money');
      expect(row?.actualEntry).toBeNull();
      expect(row?.actualInitialStop).toBeNull();
      expect(row?.actualInitialRiskMinor).toBe(5000n);
    });

    it('rejects Price mode missing Entry or Stop with invalid_execution_context, before any insert', async () => {
      const fw = await freshFramework();
      const input = {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'REJECTPRICE',
        direction: 'long' as const,
        actualResultMode: 'price' as const,
        actualEntry: '1.1005000000',
        actualInitialStop: null,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      };
      const result = await createTrade(workspaceId, actorUserId, input);
      expect(result).toEqual({ ok: false, code: 'invalid_execution_context' });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(0);
    });

    it('rejects Money mode with a non-positive Initial Risk with invalid_initial_risk, before any insert', async () => {
      const fw = await freshFramework();
      const input = {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'REJECTMONEY',
        direction: 'long' as const,
        actualResultMode: 'money' as const,
        actualInitialRiskMinor: 0n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      };
      const result = await createTrade(workspaceId, actorUserId, input);
      expect(result).toEqual({ ok: false, code: 'invalid_initial_risk' });
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(0);
    });

    it('records `newStatus: "open"` in the audit trail for an atomic open-at-creation, distinct from a legacy planned create', async () => {
      const fw = await freshFramework();
      const opened = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'AUDITOPEN',
        direction: 'long',
        actualResultMode: 'price',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      const [openedEvent] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.created'), eq(auditLogs.entityId, opened.tradeId)));
      expect(openedEvent?.metadata).toMatchObject({ newStatus: 'open' });

      const planned = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      const [plannedEvent] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.created'), eq(auditLogs.entityId, planned.tradeId)));
      expect(plannedEvent?.metadata).toMatchObject({ newStatus: 'planned' });
    });

    it('an exact replay of an atomic open-at-creation is idempotent and never double-creates', async () => {
      const fw = await freshFramework();
      const input = {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'REPLAYOPEN',
        direction: 'long' as const,
        actualResultMode: 'price' as const,
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      };
      const first = await createTrade(workspaceId, actorUserId, input);
      const replay = await createTrade(workspaceId, actorUserId, input);
      expect(first).toMatchObject({ ok: true, alreadyCreated: false });
      expect(replay).toMatchObject({ ok: true, alreadyCreated: true });
      if (!first.ok || !replay.ok) return;
      expect(replay.tradeId).toBe(first.tradeId);
      const rows = await db
        .select({ id: trades.id })
        .from(trades)
        .where(eq(trades.mutationKey, input.mutationKey));
      expect(rows).toHaveLength(1);
    });
  });

  describe('createTrade — recording-model foundation (Phase 15G.5A)', () => {
    const enteredAt = new Date('2026-08-23T09:00:00Z');

    async function createCanonical(overrides: Partial<CreateTradeInput>) {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'FOUNDATION',
        direction: 'long',
        recordingTiming: 'at_entry',
        enteredAt,
        ...overrides,
      });
      if (!result.ok) throw new Error(`canonical create failed: ${result.code}`);
      const row = await readTrade(result.tradeId);
      if (row === undefined) throw new Error('created Trade missing');
      return row;
    }

    function expectPendingOpen(row: Awaited<ReturnType<typeof createCanonical>>) {
      expect(row).toMatchObject({
        status: 'open',
        actualR: null,
        traderOutcome: null,
        systemStatus: 'pending',
        systemR: null,
      });
      expect(row.exitedAt).toBeNull();
    }

    it('maps Price Plan to Price Actual by default', async () => {
      const row = await createCanonical({
        systemPlanBasis: 'price',
        plannedEntry: '100.0000000000',
        plannedStop: '90.0000000000',
        plannedTarget: '120.0000000000',
      });
      expect(row).toMatchObject({
        plannedEntry: '100.0000000000',
        plannedStop: '90.0000000000',
        plannedTarget: '120.0000000000',
        plannedRiskMinor: null,
        plannedRewardMinor: null,
        plannedR: '2.0000',
        actualResultMode: 'price',
        actualEntry: '100.0000000000',
        actualInitialStop: '90.0000000000',
        actualInitialRiskMinor: null,
      });
      expectPendingOpen(row);
    });

    it('supports Price Plan / Money Actual as an explicit override', async () => {
      const row = await createCanonical({
        systemPlanBasis: 'price',
        plannedEntry: '100.0000000000',
        plannedStop: '90.0000000000',
        plannedTarget: null,
        actualResultMode: 'money',
        actualInitialRiskMinor: 1_200n,
      });
      expect(row).toMatchObject({
        plannedR: null,
        actualResultMode: 'money',
        actualEntry: null,
        actualInitialStop: null,
        actualInitialRiskMinor: 1_200n,
      });
      expectPendingOpen(row);
    });

    it('maps Money Plan to Money Actual by default', async () => {
      const row = await createCanonical({
        systemPlanBasis: 'money',
        plannedRiskMinor: 1_000n,
        plannedRewardMinor: 3_000n,
      });
      expect(row).toMatchObject({
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
        plannedRiskMinor: 1_000n,
        plannedRewardMinor: 3_000n,
        plannedR: '3.0000',
        actualResultMode: 'money',
        actualInitialRiskMinor: 1_000n,
      });
      expectPendingOpen(row);
    });

    it('keeps Money Plan risk independent from corrected Actual risk and System resolution', async () => {
      const row = await createCanonical({
        systemPlanBasis: 'money',
        plannedRiskMinor: 1_000n,
        plannedRewardMinor: 3_000n,
      });
      expect(
        await correctTradeExecution(workspaceId, actorUserId, row.id, {
          actualInitialRiskMinor: 1_200n,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await updateTradePlan(workspaceId, actorUserId, row.id, {
          plannedRiskMinor: 800n,
        }),
      ).toMatchObject({ ok: true, plannedR: '3.7500' });
      expect(
        await addTradeExit(workspaceId, actorUserId, row.id, {
          mutationKey: crypto.randomUUID(),
          closedBps: 10_000,
          realizedPnlMinor: 1_200n,
          exitedAt: new Date('2026-08-23T10:00:00Z'),
        }),
      ).toMatchObject({ ok: true, actualR: '1.0000' });
      expect(
        await resolveSystemTrade(workspaceId, actorUserId, row.id, {
          resolutionKind: 'money_target',
          systemExitedAt: new Date('2026-08-23T10:30:00Z'),
          systemCostR: '0',
        }),
      ).toMatchObject({ ok: true, systemR: '3.7500' });

      expect(await readTrade(row.id)).toMatchObject({
        plannedRiskMinor: 800n,
        plannedRewardMinor: 3_000n,
        actualInitialRiskMinor: 1_200n,
        actualR: '1.0000',
        systemR: '3.7500',
      });
    });

    it('supports Money Plan / Price Actual as an explicit override', async () => {
      const row = await createCanonical({
        systemPlanBasis: 'money',
        plannedRiskMinor: 1_000n,
        plannedRewardMinor: null,
        actualResultMode: 'price',
        actualEntry: '102.0000000000',
        actualInitialStop: '91.0000000000',
      });
      expect(row).toMatchObject({
        plannedR: null,
        actualResultMode: 'price',
        actualEntry: '102.0000000000',
        actualInitialStop: '91.0000000000',
        actualInitialRiskMinor: null,
      });
      expectPendingOpen(row);
    });

    it('rejects after_trade before any row is created', async () => {
      const fw = await freshFramework();
      const mutationKey = crypto.randomUUID();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey,
        tradingAccountId: fw.tradingAccountId,
        symbol: 'AFTERTRADE',
        direction: 'long',
        recordingTiming: 'after_trade',
        systemPlanBasis: 'money',
        plannedRiskMinor: 1_000n,
      });
      expect(result).toEqual({ ok: false, code: 'completed_trade_path_required' });
      expect(
        await db.select().from(trades).where(eq(trades.mutationKey, mutationKey)),
      ).toHaveLength(0);
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
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [],
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

    it('rejects dual Plan input even when the two R values agree', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedRiskMinor: 5000n, plannedRewardMinor: 10000n }), // Money R = 2.0000, matches Price R
      );
      expect(result).toEqual({ ok: false, code: 'invalid_plan_authority' });
    });

    it('rejects Price and Money that disagree beyond tolerance — nothing is persisted', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { plannedRiskMinor: 5000n, plannedRewardMinor: 50000n }), // Money R = 10.0000, Price R = 2.0000
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_plan_authority' });
    });

    it('accepts neither Price nor Money present, and no Strategy/Setup — the frozen Quick Capture contract (Phase 14C.1)', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedStop).toBeNull();
      expect(row?.plannedTarget).toBeNull();
      expect(row?.plannedRiskMinor).toBeNull();
      expect(row?.plannedRewardMinor).toBeNull();
      expect(row?.plannedR).toBeNull();
      expect(row?.strategyId).toBeNull();
      expect(row?.setupId).toBeNull();
    });

    it('rejects a non-positive plannedRiskMinor at the database layer even if it slipped past the service (defense in depth)', async () => {
      const fw = await freshFramework();
      const result = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        conditionSetToken: createConditionSetToken(fw.setupVersionId),
        conditionAnswers: [],
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
    }, 30_000);
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
        resolutionKind: 'price_exit',
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
        resolutionKind: 'price_exit',
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

    it('switches Price → Money explicitly and clears every old Price field', async () => {
      const { tradeId } = await createPlanned({ plannedPositionSize: '2' });
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        systemPlanBasis: 'money',
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 2000n,
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedStop).toBeNull();
      expect(row?.plannedTarget).toBeNull();
      expect(row?.plannedPositionSize).toBeNull();
      expect(row?.plannedRiskMinor).toBe(1000n);
      // Money alone now determines planned_r: 2000/1000 = 2.0000.
      expect(row?.plannedR).toBe('2.0000');
    });

    it('switches Money → Price explicitly and clears every old Money field', async () => {
      const { tradeId } = await createPlanned({
        plannedEntry: null,
        plannedStop: null,
        plannedTarget: null,
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 3000n,
      });
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        systemPlanBasis: 'price',
        plannedEntry: '1.1000000000',
        plannedStop: '1.0950000000',
        plannedTarget: '1.1100000000',
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.plannedRiskMinor).toBeNull();
      expect(row?.plannedRewardMinor).toBeNull();
      expect(row?.plannedEntry).toBe('1.1000000000');
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

    it('rejects adding another representation without an explicit switch — nothing persists', async () => {
      const { tradeId } = await createPlanned(); // Price R = 2.0000
      const before = await readTrade(tradeId);
      const result = await updateTradePlan(workspaceId, actorUserId, tradeId, {
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 50000n, // Money R = 50.0000
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_plan_authority' });
      const after = await readTrade(tradeId);
      expect(after).toEqual(before);
    });

    it('rejects clearing the Price plan while the System result is already resolved (system_requires_price_plan)', async () => {
      const { tradeId } = await createPlanned();
      const resolved = await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        resolutionKind: 'price_exit',
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
        systemPlanBasis: 'money',
        plannedRiskMinor: 1000n,
        plannedRewardMinor: 2000n,
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
        resolutionKind: 'price_exit',
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
        actualResultMode: 'money' as const,
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

    it('opens and fully closes a genuinely no-Plan, unclassified Trade on Actual basis alone — Money mode (Phase 14C.1 §9)', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
      });
      if (!created.ok) throw new Error('create failed');
      const opened = await openTrade(workspaceId, actorUserId, created.tradeId, openInput());
      expect(opened.ok).toBe(true);

      const closed = await closeTrade(workspaceId, actorUserId, created.tradeId, {
        actualExit: '1.1080000000',
        netPnlMinor: 7500n,
        exitedAt: new Date('2026-08-01T14:00:00Z'),
      });
      expect(closed.ok).toBe(true);

      const row = await readTrade(created.tradeId);
      // Actual side is fully finalized — Trader-eligible (`status = 'closed'`)
      // exactly like any other closed Trade.
      expect(row?.status).toBe('closed');
      expect(row?.actualR).toBe('1.5000');
      expect(row?.traderOutcome).toBe('win');
      // Plan and classification remain genuinely absent throughout — Open
      // and Close never fabricated either, and never required them.
      expect(row?.plannedEntry).toBeNull();
      expect(row?.plannedRiskMinor).toBeNull();
      expect(row?.plannedR).toBeNull();
      expect(row?.strategyId).toBeNull();
      expect(row?.setupId).toBeNull();
      // System stays independently Pending — Actual finalizing never
      // advances it.
      expect(row?.systemStatus).toBe('pending');
    });

    it('opens and fully closes a genuinely no-Plan Trade on Actual basis alone — Price mode (Phase 14C.1 §9)', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'GBPUSD',
        direction: 'long',
      });
      if (!created.ok) throw new Error('create failed');
      const opened = await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualResultMode: 'price',
        actualEntry: '1.2500000000',
        actualInitialStop: '1.2400000000',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(opened.ok).toBe(true);

      // Price-mode full close goes through `addTradeExit` (Phase 13E), not
      // `closeTrade` — that legacy helper is Money-mode only.
      const closed = await addTradeExit(workspaceId, actorUserId, created.tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 10_000,
        exitPrice: '1.2700000000',
        exitedAt: new Date('2026-08-01T14:00:00Z'),
      });
      expect(closed.ok).toBe(true);

      const row = await readTrade(created.tradeId);
      expect(row?.status).toBe('closed');
      // actualR = (1.2700 - 1.2500) / (1.2500 - 1.2400) = 0.0200 / 0.0100 = 2.0000
      expect(row?.actualR).toBe('2.0000');
      expect(row?.traderOutcome).toBe('win');
      expect(row?.plannedEntry).toBeNull();
      expect(row?.systemStatus).toBe('pending');
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
        actualResultMode: 'money',
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
        actualResultMode: 'money',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(result).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    });

    it('a post-close Exit correction recomputes Actual R and outcome', async () => {
      const { tradeId } = await createOpen();
      await closeTrade(workspaceId, actorUserId, tradeId, closeInput());
      const exit = await db.query.tradeExits.findFirst({ where: eq(tradeExits.tradeId, tradeId) });
      if (exit === undefined) throw new Error('close did not create an Exit');
      const result = await correctTradeExit(workspaceId, actorUserId, tradeId, exit.id, {
        closedBps: 10_000,
        exitPrice: exit.exitPrice,
        realizedPnlMinor: -2000n,
        exitReason: null,
        exitedAt: exit.exitedAt,
      });
      expect(result.ok).toBe(true);
      const row = await readTrade(tradeId);
      expect(row?.actualR).toBe('-0.4000');
      expect(row?.traderOutcome).toBe('loss');
    });
  });

  describe('Actual execution V2 and partial closes', () => {
    async function createPlannedTrade() {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!created.ok) throw new Error(`create failed: ${created.code}`);
      return created.tradeId;
    }

    it('opens genuine Price-only and Money-only contexts and freezes mode after the first Exit', async () => {
      const priceTradeId = await createPlannedTrade();
      expect(
        await openTrade(workspaceId, actorUserId, priceTradeId, {
          actualResultMode: 'price',
          actualEntry: '100',
          actualInitialStop: '90',
          enteredAt: new Date('2026-08-01T09:00:00Z'),
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(priceTradeId)).toMatchObject({
        actualResultMode: 'price',
        actualInitialRiskMinor: null,
      });

      const moneyTradeId = await createPlannedTrade();
      expect(
        await openTrade(workspaceId, actorUserId, moneyTradeId, {
          actualResultMode: 'money',
          actualInitialRiskMinor: 100n,
          enteredAt: new Date('2026-08-01T09:00:00Z'),
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(moneyTradeId)).toMatchObject({
        actualResultMode: 'money',
        actualEntry: null,
        actualInitialStop: null,
      });

      expect(
        await correctTradeExecution(workspaceId, actorUserId, moneyTradeId, {
          actualResultMode: 'price',
          actualEntry: '100',
          actualInitialStop: '90',
          actualInitialRiskMinor: null,
        }),
      ).toMatchObject({ ok: true });
      expect(await readTrade(moneyTradeId)).toMatchObject({
        actualResultMode: 'price',
        actualInitialRiskMinor: null,
      });

      const partial = await addTradeExit(workspaceId, actorUserId, moneyTradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 2_500,
        exitPrice: '120',
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });
      if (!partial.ok) throw new Error(`partial Exit failed: ${partial.code}`);
      expect(
        await correctTradeExit(workspaceId, actorUserId, moneyTradeId, partial.exitId, {
          closedBps: 3_000,
          exitPrice: '120',
          exitedAt: new Date('2026-08-01T10:00:00Z'),
        }),
      ).toMatchObject({ ok: true, status: 'open', closedBps: 3_000 });
      expect(
        await correctTradeExit(workspaceId, actorUserId, moneyTradeId, partial.exitId, {
          closedBps: 10_000,
          exitPrice: '120',
          exitedAt: new Date('2026-08-01T10:00:00Z'),
        }),
      ).toMatchObject({ ok: false, code: 'invalid_closed_bps' });
      expect(
        await correctTradeExecution(workspaceId, actorUserId, moneyTradeId, {
          actualResultMode: 'money',
          actualInitialRiskMinor: 100n,
        }),
      ).toMatchObject({ ok: false, code: 'invalid_status_transition' });
    }, 60_000);

    it('derives Price partial progress, Close Remaining finalization, deterministic final time, and any-leg corrections', async () => {
      const tradeId = await createPlannedTrade();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualResultMode: 'price',
        actualEntry: '100',
        actualInitialStop: '90',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const first = await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 5_000,
        exitPrice: '120',
        exitReason: 'first target',
        exitedAt: new Date('2026-08-01T14:00:00Z'),
      });
      expect(first).toMatchObject({
        ok: true,
        status: 'open',
        closedBps: 5_000,
        remainingBps: 5_000,
        realizedR: '1.0000',
        actualR: null,
        traderOutcome: null,
      });
      expect(await readTrade(tradeId)).toMatchObject({
        status: 'open',
        actualR: null,
        traderOutcome: null,
        exitedAt: null,
        netPnlMinor: null,
      });
      expect(
        await addTradeExit(workspaceId, actorUserId, tradeId, {
          mutationKey: crypto.randomUUID(),
          closedBps: 5_001,
          exitPrice: '130',
          exitedAt: new Date('2026-08-01T14:30:00Z'),
        }),
      ).toMatchObject({ ok: false, code: 'invalid_closed_bps' });
      const second = await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 2_500,
        exitPrice: '140',
        exitedAt: new Date('2026-08-01T15:00:00Z'),
      });
      expect(second).toMatchObject({ ok: true, status: 'open', realizedR: '2.0000' });
      const final = await closeRemainingTrade(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        exitPrice: '160',
        exitedAt: new Date('2026-08-01T13:00:00Z'),
      });
      expect(final).toMatchObject({
        ok: true,
        status: 'closed',
        closedBps: 10_000,
        remainingBps: 0,
        actualR: '3.5000',
        traderOutcome: 'win',
      });
      expect(await readTrade(tradeId)).toMatchObject({
        status: 'closed',
        actualExit: '140.0000000000',
        exitedAt: new Date('2026-08-01T15:00:00Z'),
        netPnlMinor: null,
        actualR: '3.5000',
      });

      const exits = await db
        .select()
        .from(tradeExits)
        .where(eq(tradeExits.tradeId, tradeId))
        .orderBy(asc(tradeExits.sequence));
      expect(exits).toHaveLength(3);
      for (const [index, exitPrice] of ['110', '130', '150'].entries()) {
        const exit = exits[index]!;
        const corrected = await correctTradeExit(workspaceId, actorUserId, tradeId, exit.id, {
          closedBps: exit.closedBps,
          exitPrice,
          exitReason: exit.exitReason,
          exitedAt: exit.exitedAt,
        });
        expect(corrected).toMatchObject({ ok: true, status: 'closed', closedBps: 10_000 });
      }
      expect(await readTrade(tradeId)).toMatchObject({ status: 'closed', actualR: '2.5000' });
      expect(
        await correctTradeExit(workspaceId, actorUserId, tradeId, exits[0]!.id, {
          closedBps: 4_999,
          exitPrice: '110',
          exitedAt: exits[0]!.exitedAt,
        }),
      ).toMatchObject({ ok: false, code: 'invalid_closed_bps' });
      expect((await readTrade(tradeId))?.status).toBe('closed');
    }, 60_000);

    it('uses Money leg sums without bps double-weighting, supports price context, replay, scope, and audit', async () => {
      const tradeId = await createPlannedTrade();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualResultMode: 'money',
        actualEntry: '100',
        actualInitialStop: '90',
        actualInitialRiskMinor: 100n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      const replayInput = {
        mutationKey: crypto.randomUUID(),
        closedBps: 5_000,
        exitPrice: '120',
        realizedPnlMinor: 100n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      };
      const first = await addTradeExit(workspaceId, actorUserId, tradeId, replayInput);
      expect(first).toMatchObject({ ok: true, alreadyAdded: false, realizedR: '1.0000' });
      expect(await addTradeExit(workspaceId, actorUserId, tradeId, replayInput)).toMatchObject({
        ok: true,
        alreadyAdded: true,
        exitId: first.ok ? first.exitId : '',
      });
      expect(
        await addTradeExit(otherWorkspaceId, otherActorUserId, tradeId, {
          ...replayInput,
          mutationKey: crypto.randomUUID(),
        }),
      ).toMatchObject({ ok: false, code: 'trade_not_found' });
      await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 2_500,
        realizedPnlMinor: 100n,
        exitedAt: new Date('2026-08-01T11:00:00Z'),
      });
      const final = await closeRemainingTrade(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        realizedPnlMinor: 150n,
        exitedAt: new Date('2026-08-01T12:00:00Z'),
      });
      expect(final).toMatchObject({ ok: true, actualR: '3.5000' });
      expect(await readTrade(tradeId)).toMatchObject({
        status: 'closed',
        netPnlMinor: 350n,
        actualR: '3.5000',
      });
      expect(
        await db
          .select()
          .from(auditLogs)
          .where(and(eq(auditLogs.entityId, tradeId), eq(auditLogs.action, 'trade.closed'))),
      ).toHaveLength(1);
      expect(
        await db.select().from(auditLogs).where(eq(auditLogs.action, 'trade.exit_added')),
      ).not.toHaveLength(0);
    }, 60_000);

    it('serializes concurrent Close Remaining requests so cumulative bps never exceeds 10000', async () => {
      const tradeId = await createPlannedTrade();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualResultMode: 'money',
        actualInitialRiskMinor: 100n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 7_500,
        realizedPnlMinor: 75n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });
      const [a, b] = await Promise.all([
        closeRemainingTrade(workspaceId, actorUserId, tradeId, {
          mutationKey: crypto.randomUUID(),
          realizedPnlMinor: 25n,
          exitedAt: new Date('2026-08-01T11:00:00Z'),
        }),
        closeRemainingTrade(workspaceId, actorUserId, tradeId, {
          mutationKey: crypto.randomUUID(),
          realizedPnlMinor: 25n,
          exitedAt: new Date('2026-08-01T11:00:00Z'),
        }),
      ]);
      expect([a, b].filter((result) => result.ok)).toHaveLength(1);
      expect([a, b].filter((result) => !result.ok)).toHaveLength(1);
      const exits = await db.select().from(tradeExits).where(eq(tradeExits.tradeId, tradeId));
      expect(exits.reduce((total, exit) => total + exit.closedBps, 0)).toBe(10_000);
      expect(exits).toHaveLength(2);
    }, 60_000);
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
        actualResultMode: 'money',
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

    function resolveInput(
      overrides: Partial<Extract<ResolveSystemTradeInput, { resolutionKind: 'price_exit' }>> = {},
    ): Extract<ResolveSystemTradeInput, { resolutionKind: 'price_exit' }> {
      return {
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
        ...overrides,
      };
    }

    async function createMoneyOnly(plannedRewardMinor: bigint | null = 50n) {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, {
          plannedEntry: null,
          plannedStop: null,
          plannedTarget: null,
          plannedRiskMinor: 10n,
          plannedRewardMinor,
        }),
      );
      if (!created.ok) throw new Error('create failed');
      return { fw, tradeId: created.tradeId };
    }

    it('resolves a Money-only Target from Planned R and applies System Cost', async () => {
      const { tradeId } = await createMoneyOnly();
      const result = await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        resolutionKind: 'money_target',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemCostR: '0.1000',
      });
      expect(result).toMatchObject({ ok: true, systemR: '4.9000', systemOutcome: 'win' });
      const row = await readTrade(tradeId);
      expect(row).toMatchObject({
        systemResolutionKind: 'money_target',
        systemExitPrice: null,
        systemGrossRInput: '5.0000',
        systemExitReason: 'target_hit',
        systemR: '4.9000',
      });
    });

    it.each([
      ['money_stop', undefined, '-1.1000', 'stop_hit'],
      ['money_break_even', undefined, '-0.1000', 'break_even_rule'],
      ['money_custom', '2.75', '2.6500', 'manual_system_valid_exit'],
    ] as const)(
      'resolves Money-only %s without fabricating an exit price',
      async (kind, gross, expected, reason) => {
        const { tradeId } = await createMoneyOnly();
        const result = await resolveSystemTrade(
          workspaceId,
          actorUserId,
          tradeId,
          kind === 'money_custom'
            ? {
                resolutionKind: kind,
                systemGrossRInput: gross,
                systemExitedAt: new Date('2026-08-01T12:00:00Z'),
                systemCostR: '0.1000',
              }
            : {
                resolutionKind: kind,
                systemExitedAt: new Date('2026-08-01T12:00:00Z'),
                systemCostR: '0.1000',
              },
        );
        expect(result).toMatchObject({ ok: true, systemR: expected });
        const row = await readTrade(tradeId);
        expect(row?.systemExitPrice).toBeNull();
        expect(row?.systemExitReason).toBe(reason);
      },
    );

    it('rejects Money Target without Planned R and rejects Money authority when Price exists', async () => {
      const missingTarget = await createMoneyOnly(null);
      await expect(
        resolveSystemTrade(workspaceId, actorUserId, missingTarget.tradeId, {
          resolutionKind: 'money_target',
          systemExitedAt: new Date('2026-08-01T12:00:00Z'),
          systemCostR: '0',
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_system_status_transition',
        calcReason: 'missing_input',
      });

      const fw = await freshFramework();
      const both = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!both.ok) throw new Error('create failed');
      // Historical compatibility fixture: pre-15G.5A rows may physically
      // contain both representations. Canonical create no longer permits
      // constructing this shape, so the fixture mirrors a legacy persisted
      // row directly and verifies the unchanged Price precedence on reads.
      await db
        .update(trades)
        .set({ plannedRiskMinor: 10n, plannedRewardMinor: 20n })
        .where(eq(trades.id, both.tradeId));
      await expect(
        resolveSystemTrade(workspaceId, actorUserId, both.tradeId, {
          resolutionKind: 'money_target',
          systemExitedAt: new Date('2026-08-01T12:00:00Z'),
          systemCostR: '0',
        }),
      ).resolves.toMatchObject({ ok: false, code: 'invalid_system_status_transition' });
      await expect(
        resolveSystemTrade(workspaceId, actorUserId, both.tradeId, resolveInput()),
      ).resolves.toMatchObject({ ok: true, systemR: '2.0000' });
    });

    it('rejects every System resolution kind on a genuinely no-Plan Trade with its own truthful-input code, never a fabricated result (Phase 14C.1)', async () => {
      const fw = await freshFramework();
      const created = await createTrade(workspaceId, actorUserId, {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
      });
      if (!created.ok) throw new Error('create failed');
      const tradeId = created.tradeId;

      await expect(
        resolveSystemTrade(workspaceId, actorUserId, tradeId, resolveInput()),
      ).resolves.toMatchObject({ ok: false, code: 'system_requires_price_plan' });

      // A genuinely absent Risk (never entered at all, unlike an entered-
      // but-missing-Reward Money Target) fails the shared Risk-presence
      // guard every money_* kind checks first — `invalid_planned_risk`, not
      // `missing_input` (see `resolveSystemGrossR`, `src/lib/calc/trade.ts`).
      await expect(
        resolveSystemTrade(workspaceId, actorUserId, tradeId, {
          resolutionKind: 'money_target',
          systemExitedAt: new Date('2026-08-01T12:00:00Z'),
          systemCostR: '0',
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_system_status_transition',
        calcReason: 'invalid_planned_risk',
      });

      await expect(
        resolveSystemTrade(workspaceId, actorUserId, tradeId, {
          resolutionKind: 'money_stop',
          systemExitedAt: new Date('2026-08-01T12:00:00Z'),
          systemCostR: '0',
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: 'invalid_system_status_transition',
        calcReason: 'invalid_planned_risk',
      });

      // System `no_trade` needs no Plan geometry at all and remains fully
      // available — the System Outcome axis stays truthful and unblocked
      // even while the Trade has no Plan.
      const noTrade = await markSystemNoTrade(workspaceId, actorUserId, tradeId);
      expect(noTrade).toMatchObject({ ok: true });
      const row = await readTrade(tradeId);
      expect(row?.systemStatus).toBe('no_trade');
    });

    it('corrects between Money kinds, clears stale Custom authority, and supports no_trade', async () => {
      const { tradeId } = await createMoneyOnly();
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        resolutionKind: 'money_custom',
        systemGrossRInput: '2.75',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemCostR: '0.25',
      });
      await expect(
        correctSystemResolution(workspaceId, actorUserId, tradeId, {
          target: 'resolved',
          resolutionKind: 'money_stop',
          systemExitedAt: new Date('2026-08-01T13:00:00Z'),
          systemCostR: '0.10',
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(await readTrade(tradeId)).toMatchObject({
        systemResolutionKind: 'money_stop',
        systemGrossRInput: '-1.0000',
        systemR: '-1.1000',
      });
      await correctSystemResolution(workspaceId, actorUserId, tradeId, { target: 'no_trade' });
      expect(await readTrade(tradeId)).toMatchObject({
        systemStatus: 'no_trade',
        systemResolutionKind: null,
        systemGrossRInput: null,
      });
    });

    it('resolves independently while Actual execution is partially open', async () => {
      const { tradeId } = await createMoneyOnly();
      await openTrade(workspaceId, actorUserId, tradeId, {
        actualResultMode: 'money',
        actualInitialRiskMinor: 100n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 5_000,
        realizedPnlMinor: 100n,
        exitedAt: new Date('2026-08-01T10:00:00Z'),
      });
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        resolutionKind: 'money_target',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemCostR: '0',
      });
      expect(await readTrade(tradeId)).toMatchObject({
        status: 'open',
        actualR: null,
        systemStatus: 'resolved',
        systemR: '5.0000',
      });
    });

    it('keeps Money retries idempotent and tenant-scoped', async () => {
      const { tradeId } = await createMoneyOnly();
      const input = {
        resolutionKind: 'money_stop' as const,
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemCostR: '0',
      };
      await resolveSystemTrade(workspaceId, actorUserId, tradeId, input);
      const before = await readTrade(tradeId);
      await expect(
        resolveSystemTrade(workspaceId, actorUserId, tradeId, input),
      ).resolves.toMatchObject({
        ok: true,
      });
      expect((await readTrade(tradeId))?.updatedAt).toEqual(before?.updatedAt);
      await expect(
        correctSystemResolution(otherWorkspaceId, otherActorUserId, tradeId, {
          target: 'resolved',
          ...input,
        }),
      ).resolves.toMatchObject({ ok: false, code: 'trade_not_found' });
    });

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
        actualResultMode: 'money',
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
        actualResultMode: 'money',
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
        actualResultMode: 'money',
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
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T12:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(resolved.ok).toBe(true);

      const exit = await db.query.tradeExits.findFirst({
        where: eq(tradeExits.tradeId, created.tradeId),
      });
      if (exit === undefined) throw new Error('close did not create an Exit');
      const corrected = await correctTradeExit(workspaceId, actorUserId, created.tradeId, exit.id, {
        closedBps: 10_000,
        exitPrice: exit.exitPrice,
        realizedPnlMinor: 8000n,
        exitReason: exit.exitReason,
        exitedAt: exit.exitedAt,
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
        actualResultMode: 'money',
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
          resolutionKind: 'price_exit',
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

  // -------------------------------------------------------------------------
  // Phase 14B — Independent Trade Lifecycle: optional classification
  // -------------------------------------------------------------------------
  describe('Phase 14B — optional Strategy/Setup classification', () => {
    function unclassifiedInput(
      tradingAccountId: string,
      overrides: Partial<CreateTradeInput> = {},
    ): CreateTradeInput {
      return {
        mutationKey: crypto.randomUUID(),
        tradingAccountId,
        symbol: 'EURUSD',
        direction: 'long',
        plannedEntry: '1.1000000000',
        plannedStop: '1.0950000000',
        plannedTarget: '1.1100000000',
        ...overrides,
      };
    }

    // A.
    it('A: creates a planned Trade with no Strategy/Setup classification', async () => {
      const fw = await freshFramework();
      const result = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const row = await readTrade(result.tradeId);
      expect(row).toMatchObject({
        strategyId: null,
        strategyVersionId: null,
        setupId: null,
        setupVersionId: null,
        strategyAssignedAt: null,
        setupAssignedAt: null,
        status: 'planned',
      });
    });

    // B, D, E.
    it('B/D/E: opens (Price), fully closes, and resolves System on an unclassified Trade', async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');
      const tradeId = created.tradeId;

      const opened = await openTrade(workspaceId, actorUserId, tradeId, {
        actualResultMode: 'price',
        actualEntry: '1.1005000000',
        actualInitialStop: '1.0950000000',
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(opened.ok).toBe(true);

      const closed = await addTradeExit(workspaceId, actorUserId, tradeId, {
        mutationKey: crypto.randomUUID(),
        closedBps: 10_000,
        exitPrice: '1.1100000000',
        exitedAt: new Date('2026-08-01T12:00:00Z'),
      });
      expect(closed).toMatchObject({ ok: true, status: 'closed' });
      const closedRow = await readTrade(tradeId);
      expect(closedRow?.status).toBe('closed');
      expect(closedRow?.actualR).not.toBeNull();
      expect(closedRow?.traderOutcome).not.toBeNull();

      const systemResult = await resolveSystemTrade(workspaceId, actorUserId, tradeId, {
        resolutionKind: 'price_exit',
        systemExitPrice: '1.1100000000',
        systemExitedAt: new Date('2026-08-01T13:00:00Z'),
        systemExitReason: 'target_hit',
        systemCostR: '0.0000',
      });
      expect(systemResult.ok).toBe(true);
      const finalRow = await readTrade(tradeId);
      expect(finalRow).toMatchObject({
        systemStatus: 'resolved',
        strategyId: null,
        strategyVersionId: null,
        setupId: null,
        setupVersionId: null,
      });
    });

    // C.
    it('C: opens an unclassified Money-mode Trade', async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId, {
          plannedEntry: null,
          plannedStop: null,
          plannedTarget: null,
          plannedRiskMinor: 100n,
        }),
      );
      if (!created.ok) throw new Error('create failed');
      const opened = await openTrade(workspaceId, actorUserId, created.tradeId, {
        actualResultMode: 'money',
        actualInitialRiskMinor: 5000n,
        enteredAt: new Date('2026-08-01T09:00:00Z'),
      });
      expect(opened.ok).toBe(true);
      expect(await readTrade(created.tradeId)).toMatchObject({
        actualResultMode: 'money',
        actualInitialRiskMinor: 5000n,
      });
    });

    // J, K.
    it('J/K: assigns Strategy then Setup progressively, recording first-assignment timing only', async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');
      const tradeId = created.tradeId;

      const beforeStrategy = await readTrade(tradeId);
      expect(beforeStrategy?.strategyAssignedAt).toBeNull();

      const strategyOnly = await assignTradeClassification(workspaceId, actorUserId, tradeId, {
        strategyId: fw.strategyId,
      });
      expect(strategyOnly).toMatchObject({
        ok: true,
        strategyId: fw.strategyId,
        strategyVersionId: fw.strategyVersionId,
        setupId: null,
      });
      const afterStrategy = await readTrade(tradeId);
      expect(afterStrategy?.strategyId).toBe(fw.strategyId);
      expect(afterStrategy?.strategyAssignedAt).not.toBeNull();
      expect(afterStrategy?.setupId).toBeNull();
      expect(afterStrategy?.setupAssignedAt).toBeNull();

      // Re-assigning a Strategy once already pinned is unsupported in this
      // phase — arbitrary reclassification is deliberately rejected.
      expect(
        await assignTradeClassification(workspaceId, actorUserId, tradeId, {
          strategyId: fw.strategyId,
        }),
      ).toMatchObject({ ok: false, code: 'invalid_classification_request' });

      const firstAssignedAt = afterStrategy?.strategyAssignedAt;
      const withSetup = await assignTradeClassification(workspaceId, actorUserId, tradeId, {
        setupId: fw.setupId,
      });
      expect(withSetup).toMatchObject({
        ok: true,
        strategyId: fw.strategyId,
        setupId: fw.setupId,
        setupVersionId: fw.setupVersionId,
      });
      const afterSetup = await readTrade(tradeId);
      expect(afterSetup?.setupId).toBe(fw.setupId);
      expect(afterSetup?.setupAssignedAt).not.toBeNull();
      // Assigning a Setup must never move the already-recorded Strategy
      // timing — it is FIRST-assignment timing, not "last changed at".
      expect(afterSetup?.strategyAssignedAt?.getTime()).toBe(firstAssignedAt?.getTime());
    });

    // L.
    it('L: assigning a Setup with configured Conditions late creates ZERO retrospective Condition checks', async () => {
      const fw = await freshFramework();
      const condition = await createSetupCondition(
        workspaceId,
        actorUserId,
        fw.strategyId,
        fw.setupId,
        { label: 'Above the 200 EMA', sortOrder: 0 },
      );
      if (!condition.ok) throw new Error(`condition creation failed: ${condition.code}`);

      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');

      const result = await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
        strategyId: fw.strategyId,
        setupId: fw.setupId,
      });
      expect(result.ok).toBe(true);

      const checks = await db
        .select()
        .from(tradeSetupConditionChecks)
        .where(eq(tradeSetupConditionChecks.tradeId, created.tradeId));
      expect(checks).toHaveLength(0);
    });

    // M.
    it('M: late Strategy assignment pins whatever Version is CURRENT at assignment time, never a stale one', async () => {
      const fw = await freshFramework();
      // Reference (and thereby lock) version 1 via an unrelated control
      // Trade, then edit the Strategy — this Version being locked forces
      // the edit through copy-on-write to a brand-new version 2.
      const control = await createTrade(workspaceId, actorUserId, basePlanInput(fw));
      if (!control.ok) throw new Error('control create failed');
      const cow = await createStrategyRule(workspaceId, actorUserId, fw.strategyId, {
        ruleKey: crypto.randomUUID(),
        category: 'entry',
        title: 'Trigger COW for Phase 14B test M',
        changeNote: 'Phase 14B test M — force copy-on-write',
      });
      expect(cow).toMatchObject({ ok: true, copied: true });
      const strategyRow = await db.query.strategies.findFirst({
        where: eq(strategies.id, fw.strategyId),
      });
      const currentVersionId = strategyRow?.currentVersionId ?? null;
      expect(currentVersionId).not.toBeNull();
      expect(currentVersionId).not.toBe(fw.strategyVersionId);

      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');

      const result = await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
        strategyId: fw.strategyId,
      });
      expect(result).toMatchObject({ ok: true, strategyVersionId: currentVersionId });
      expect(result.ok && result.strategyVersionId).not.toBe(fw.strategyVersionId);

      const lockedVersion = await db.query.strategyVersions.findFirst({
        where: eq(strategyVersions.id, currentVersionId as string),
      });
      expect(lockedVersion?.lockedAt).not.toBeNull();
    });

    // N.
    it("N: archiving the Strategy after late classification never rewrites the Trade's pinned reference", async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');
      await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
        strategyId: fw.strategyId,
        setupId: fw.setupId,
      });

      const { archiveStrategy } = await import('./strategy-management');
      await archiveStrategy(workspaceId, actorUserId, fw.strategyId);

      const row = await readTrade(created.tradeId);
      expect(row).toMatchObject({
        strategyId: fw.strategyId,
        strategyVersionId: fw.strategyVersionId,
        setupId: fw.setupId,
        setupVersionId: fw.setupVersionId,
      });
    });

    // O.
    it('O: rejects a cross-workspace Strategy/Setup on assignment', async () => {
      const fw = await freshFramework();
      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');
      const foreignFw = await freshFramework(otherWorkspaceId, otherActorUserId);

      expect(
        await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
          strategyId: foreignFw.strategyId,
        }),
      ).toMatchObject({ ok: false, code: 'strategy_not_found' });

      const withOwnStrategy = await assignTradeClassification(
        workspaceId,
        actorUserId,
        created.tradeId,
        { strategyId: fw.strategyId },
      );
      expect(withOwnStrategy.ok).toBe(true);
      expect(
        await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
          setupId: foreignFw.setupId,
        }),
      ).toMatchObject({ ok: false, code: 'setup_not_found' });
    });

    // P.
    it('P: denies assignTradeClassification under read_only and over_limit workspaces', async () => {
      const roUser = await createUser(db, 'p14b-ro');
      const roWs = await createWorkspace(db, roUser, {
        entitlement: {
          status: 'trialing',
          planKey: null,
          trialStartedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          trialEndsAt: new Date(Date.now() + 60 * 60 * 1000),
          currentPeriodStartedAt: null,
          currentPeriodEndsAt: null,
        },
      });
      allWorkspaceIds.push(roWs);
      const roFw = await createFramework(db, roWs, roUser);
      const roTrade = await createTrade(roWs, roUser, unclassifiedInput(roFw.tradingAccountId));
      if (!roTrade.ok) throw new Error('read-only fixture create failed');
      await db
        .update(workspaceEntitlements)
        .set({ trialEndsAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(workspaceEntitlements.workspaceId, roWs));
      expect(
        await assignTradeClassification(roWs, roUser, roTrade.tradeId, {
          strategyId: roFw.strategyId,
        }),
      ).toMatchObject({ ok: false, code: 'read_only_workspace' });

      const olUser = await createUser(db, 'p14b-ol');
      const olWs = await createWorkspace(db, olUser, {
        entitlement: { status: 'active', planKey: 'starter' },
      });
      allWorkspaceIds.push(olWs);
      const olFw = await createFramework(db, olWs, olUser);
      const olTrade = await createTrade(olWs, olUser, unclassifiedInput(olFw.tradingAccountId));
      if (!olTrade.ok) throw new Error('over-limit fixture create failed');
      await createAccount(db, olWs);
      expect(
        await assignTradeClassification(olWs, olUser, olTrade.tradeId, {
          strategyId: olFw.strategyId,
        }),
      ).toMatchObject({ ok: false, code: 'over_limit_workspace' });
    });

    // Q.
    it('Q: rejects Setup-without-Strategy at the database CHECK level', async () => {
      const fw = await freshFramework();
      await expect(
        db.insert(trades).values({
          workspaceId,
          tradingAccountId: fw.tradingAccountId,
          setupId: fw.setupId,
          setupVersionId: fw.setupVersionId,
          setupAssignedAt: new Date(),
          symbol: 'EURUSD',
          direction: 'long',
          plannedRiskMinor: 100n,
        }),
      ).rejects.toThrow();
    });

    // R.
    it('R: rejects a Setup with no snapshot in the Strategy Version being pinned', async () => {
      const fw = await freshFramework();
      const setupResult = await createSetup(workspaceId, actorUserId, fw.strategyId, {
        mutationKey: crypto.randomUUID(),
        name: 'Ghost Setup',
        sortOrder: 1,
      });
      if (!setupResult.ok) throw new Error('setup creation failed');
      // Simulate a malformed state by deleting the snapshot directly — never
      // done by a real service, and only possible here because this Setup
      // Version is still unlocked (nothing has referenced it yet); the exact
      // precedent `strategy-management.integration.test.ts`'s "rejects a
      // Setup with no snapshot in the current Version as malformed" already
      // establishes for `updateSetupContent`.
      await db
        .delete(strategySetupVersions)
        .where(
          and(
            eq(strategySetupVersions.strategyVersionId, setupResult.versionId),
            eq(strategySetupVersions.setupId, setupResult.setupId),
          ),
        );

      const created = await createTrade(
        workspaceId,
        actorUserId,
        unclassifiedInput(fw.tradingAccountId),
      );
      if (!created.ok) throw new Error('create failed');

      expect(
        await assignTradeClassification(workspaceId, actorUserId, created.tradeId, {
          strategyId: fw.strategyId,
          setupId: setupResult.setupId,
        }),
      ).toMatchObject({ ok: false, code: 'setup_snapshot_missing' });
    });
  });

  describe('createCompletedTrade', () => {
    function completedInput(
      fw: Framework,
      systemPlanBasis: 'price' | 'money',
      actualResultBasis: 'price' | 'money',
      overrides: Partial<CreateCompletedTradeInput> = {},
    ): CreateCompletedTradeInput {
      const exitedAt = new Date(Date.now() - 60 * 60 * 1000);
      const enteredAt = new Date(exitedAt.getTime() - 60 * 60 * 1000);
      return {
        mutationKey: crypto.randomUUID(),
        tradingAccountId: fw.tradingAccountId,
        recordingTiming: 'after_trade',
        systemPlanBasis,
        symbol: 'EURUSD',
        direction: 'long',
        ...(systemPlanBasis === 'price'
          ? {
              plannedEntry: '1.1000000000',
              plannedStop: '1.0950000000',
              plannedTarget: '1.1100000000',
            }
          : { plannedRiskMinor: 5_000n, plannedRewardMinor: 10_000n }),
        actualResultBasis,
        ...(actualResultBasis === 'price'
          ? {
              actualEntry: '1.1000000000',
              actualInitialStop: '1.0950000000',
              exits: [{ closedBps: 10_000, exitPrice: '1.1100000000' }],
            }
          : {
              actualInitialRiskMinor: 5_000n,
              exits: [{ closedBps: 10_000, realizedPnlMinor: 10_000n }],
            }),
        enteredAt,
        exitedAt,
        ...overrides,
      };
    }

    it.each([
      ['price', 'price'],
      ['price', 'money'],
      ['money', 'price'],
      ['money', 'money'],
    ] as const)(
      'atomically creates a closed %s Plan / %s Actual Trade',
      async (systemPlanBasis, actualResultBasis) => {
        const fw = await freshFramework();
        const result = await createCompletedTrade(
          workspaceId,
          actorUserId,
          completedInput(fw, systemPlanBasis, actualResultBasis),
        );
        expect(result).toMatchObject({
          ok: true,
          alreadyCreated: false,
          status: 'closed',
          systemStatus: 'pending',
          recordedRetrospectively: true,
        });
        if (!result.ok) return;
        const row = await readTrade(result.tradeId);
        expect(row).toMatchObject({ status: 'closed', exitedAt: expect.any(Date) });
        expect(row?.actualR).not.toBeNull();
        expect(row?.traderOutcome).not.toBeNull();
      },
    );

    it('persists partial exits, resolves System, emits one truthful event, and replays exactly', async () => {
      const fw = await freshFramework();
      const input = completedInput(fw, 'price', 'money', {
        actualInitialRiskMinor: 5_000n,
        exits: [
          { closedBps: 4_000, realizedPnlMinor: 2_000n },
          { closedBps: 6_000, realizedPnlMinor: 8_000n },
        ],
        systemResult: {
          status: 'resolved',
          resolutionKind: 'price_exit',
          systemExitPrice: '1.1100000000',
          systemExitReason: 'target_hit',
          systemExitedAt: new Date(Date.now() - 90 * 60 * 1000),
          systemCostR: '0.1',
        },
      });
      const first = await createCompletedTrade(workspaceId, actorUserId, input);
      expect(first).toMatchObject({ ok: true, systemStatus: 'resolved', alreadyCreated: false });
      if (!first.ok) return;
      const replay = await createCompletedTrade(workspaceId, actorUserId, input);
      expect(replay).toEqual({ ...first, alreadyCreated: true });

      const exits = await db.select().from(tradeExits).where(eq(tradeExits.tradeId, first.tradeId));
      expect(exits).toHaveLength(2);
      const events = await db.select().from(auditLogs).where(eq(auditLogs.entityId, first.tradeId));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'trade.created',
        metadata: expect.objectContaining({
          newStatus: 'closed',
          recordingTiming: 'after_trade',
          systemStatus: 'resolved',
          exitCount: 2,
        }),
      });
    });

    it('rolls back the entire graph on invalid Exit, System resolution, or coverage', async () => {
      const fw = await freshFramework();
      const invalidExit = completedInput(fw, 'price', 'price', {
        exits: [{ closedBps: 10_000, realizedPnlMinor: 5_000n }],
      });
      expect(await createCompletedTrade(workspaceId, actorUserId, invalidExit)).toMatchObject({
        ok: false,
        code: 'invalid_exit_shape',
      });

      const invalidSystem = completedInput(fw, 'money', 'price', {
        systemResult: {
          status: 'resolved',
          resolutionKind: 'price_exit',
          systemExitPrice: '1.11',
          systemExitReason: 'target_hit',
          systemExitedAt: new Date(Date.now() - 90 * 60 * 1000),
          systemCostR: '0',
        },
      });
      expect(await createCompletedTrade(workspaceId, actorUserId, invalidSystem)).toMatchObject({
        ok: false,
        code: 'system_requires_price_plan',
      });

      const invalidCoverage = completedInput(fw, 'price', 'price', {
        exits: [{ closedBps: 9_999, exitPrice: '1.11' }],
      });
      expect(await createCompletedTrade(workspaceId, actorUserId, invalidCoverage)).toMatchObject({
        ok: false,
        code: 'invalid_completed_exit_coverage',
      });
      const rows = await db
        .select()
        .from(trades)
        .where(
          inArray(trades.mutationKey, [
            invalidExit.mutationKey,
            invalidSystem.mutationKey,
            invalidCoverage.mutationKey,
          ]),
        );
      expect(rows).toHaveLength(0);
    });

    it('denies a foreign actor and leaves no Trade behind', async () => {
      const fw = await freshFramework();
      const input = completedInput(fw, 'price', 'price');
      expect(await createCompletedTrade(workspaceId, otherActorUserId, input)).toMatchObject({
        ok: false,
        code: 'workspace_access_denied',
      });
      expect(
        await db.query.trades.findFirst({ where: eq(trades.mutationKey, input.mutationKey) }),
      ).toBeUndefined();
    });
  });
});
