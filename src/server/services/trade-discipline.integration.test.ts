import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  auditLogs,
  mistakeTypes,
  tradeMistakes,
  tradeRuleChecks,
  tradingAccounts,
  users,
  workspaceEntitlements,
  workspaceMembers,
  workspaces,
} from '@/server/db/schema';
import { closeTestDb, getTestDb } from '@/test/integration-db';

import { createSetup, createStrategy, createStrategyRule } from './strategy-management';
import { attachTradeMistake, removeTradeMistake, updateTradeRuleCheck } from './trade-discipline';
import { createTrade, softDeleteTrade, type CreateTradeInput } from './trade-management';

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

async function createWorkspace(db: Db, ownerUserId: string): Promise<string> {
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: 'Phase 08B discipline test workspace',
      slug: `p08b-disc-${crypto.randomUUID()}`,
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
  });
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
    name: 'Phase 08B Discipline Test Strategy',
  });
  if (!strategy.ok) throw new Error(`strategy creation failed: ${strategy.code}`);
  const setup = await createSetup(workspaceId, actorUserId, strategy.strategyId, {
    mutationKey: crypto.randomUUID(),
    name: 'Phase 08B Discipline Test Setup',
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

describe('trade-discipline (real database)', () => {
  const db = getTestDb();
  let actorUserId: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let otherActorUserId: string;
  const allWorkspaceIds: string[] = [];

  beforeAll(async () => {
    actorUserId = await createUser(db, 'p08b-disc-actor');
    otherActorUserId = await createUser(db, 'p08b-disc-other-actor');
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

  async function createTradeWithRule(ws: string = workspaceId, actor: string = actorUserId) {
    const fw = await createFramework(db, ws, actor);
    const ruleKey = crypto.randomUUID();
    const rule = await createStrategyRule(ws, actor, fw.strategyId, {
      ruleKey,
      category: 'entry',
      title: 'Confirm setup alignment',
    });
    if (!rule.ok) throw new Error('rule creation failed');
    const created = await createTrade(ws, actor, basePlanInput(fw));
    if (!created.ok) throw new Error(`create failed: ${created.code}`);
    return { fw, tradeId: created.tradeId, ruleKey };
  }

  async function canonicalMistakeTypeId(): Promise<string> {
    const [row] = await db
      .select({ id: mistakeTypes.id })
      .from(mistakeTypes)
      .where(eq(mistakeTypes.key, 'moved_stop'));
    if (row === undefined) throw new Error('canonical mistake type "moved_stop" not seeded');
    return row.id;
  }

  // -------------------------------------------------------------------------
  // Rule checks
  // -------------------------------------------------------------------------
  describe('updateTradeRuleCheck', () => {
    it('sets each of the four check statuses', async () => {
      const { tradeId, ruleKey } = await createTradeWithRule();
      for (const status of ['followed', 'violated', 'not_applicable', 'not_checked'] as const) {
        const result = await updateTradeRuleCheck(
          workspaceId,
          actorUserId,
          tradeId,
          ruleKey,
          status,
        );
        expect(result.ok).toBe(true);
        const [row] = await db
          .select()
          .from(tradeRuleChecks)
          .where(and(eq(tradeRuleChecks.tradeId, tradeId), eq(tradeRuleChecks.ruleKey, ruleKey)));
        expect(row?.checkStatus).toBe(status);
      }
    });

    it('rejects an unknown check status', async () => {
      const { tradeId, ruleKey } = await createTradeWithRule();
      const result = await updateTradeRuleCheck(
        workspaceId,
        actorUserId,
        tradeId,
        ruleKey,
        'bogus_status',
      );
      expect(result).toMatchObject({ ok: false, code: 'invalid_check_status' });
    });

    it('rejects a ruleKey that does not belong to this Trade', async () => {
      const first = await createTradeWithRule();
      const second = await createTradeWithRule();
      const result = await updateTradeRuleCheck(
        workspaceId,
        actorUserId,
        first.tradeId,
        second.ruleKey, // belongs to a different Trade
        'followed',
      );
      expect(result).toMatchObject({ ok: false, code: 'rule_check_not_found' });
    });

    it('rejects a cross-workspace Trade id as not-found', async () => {
      const { tradeId, ruleKey } = await createTradeWithRule();
      const result = await updateTradeRuleCheck(
        otherWorkspaceId,
        otherActorUserId,
        tradeId,
        ruleKey,
        'followed',
      );
      expect(result).toMatchObject({ ok: false, code: 'trade_not_found' });
    });

    it('is denied/not-found on a soft-deleted Trade', async () => {
      const { tradeId, ruleKey } = await createTradeWithRule();
      await softDeleteTrade(workspaceId, actorUserId, tradeId);
      const result = await updateTradeRuleCheck(
        workspaceId,
        actorUserId,
        tradeId,
        ruleKey,
        'followed',
      );
      expect(result).toMatchObject({ ok: false, code: 'trade_not_found' });
    });

    it('emits trade.rule_check_updated with identifiers/field-name metadata only, and no duplicate on a same-value no-op', async () => {
      const { tradeId, ruleKey } = await createTradeWithRule();
      await updateTradeRuleCheck(workspaceId, actorUserId, tradeId, ruleKey, 'followed');
      const repeat = await updateTradeRuleCheck(
        workspaceId,
        actorUserId,
        tradeId,
        ruleKey,
        'followed',
      );
      expect(repeat.ok).toBe(true);

      const events = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'trade.rule_check_updated'));
      const relevant = events.filter(
        (e) => (e.metadata as { tradeId?: string }).tradeId === tradeId,
      );
      expect(relevant).toHaveLength(1);
      const metadata = relevant[0]?.metadata as Record<string, unknown>;
      expect(metadata).toEqual({
        tradeId,
        ruleKey,
        previousStatus: 'not_checked',
        newStatus: 'followed',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Mistakes
  // -------------------------------------------------------------------------
  describe('attachTradeMistake / removeTradeMistake', () => {
    it('attaches a canonical mistake and snapshots severity/weight from the source row', async () => {
      const { tradeId } = await createTradeWithRule();
      const mistakeTypeId = await canonicalMistakeTypeId();
      const [source] = await db
        .select()
        .from(mistakeTypes)
        .where(eq(mistakeTypes.id, mistakeTypeId));

      const result = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        mistakeTypeId,
        'note',
      );
      expect(result).toMatchObject({ ok: true, alreadyAttached: false });

      const [row] = await db
        .select()
        .from(tradeMistakes)
        .where(
          and(eq(tradeMistakes.tradeId, tradeId), eq(tradeMistakes.mistakeTypeId, mistakeTypeId)),
        );
      expect(row?.severityAtTime).toBe(source?.severity);
      expect(row?.weightAtTime).toBe(source?.defaultWeight);
      expect(row?.note).toBe('note');
    });

    it('a duplicate attach is a safe no-op', async () => {
      const { tradeId } = await createTradeWithRule();
      const mistakeTypeId = await canonicalMistakeTypeId();
      const first = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        mistakeTypeId,
        null,
      );
      const second = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        mistakeTypeId,
        null,
      );
      expect(first).toMatchObject({ ok: true, alreadyAttached: false });
      expect(second).toMatchObject({ ok: true, alreadyAttached: true });

      const rows = await db
        .select()
        .from(tradeMistakes)
        .where(
          and(eq(tradeMistakes.tradeId, tradeId), eq(tradeMistakes.mistakeTypeId, mistakeTypeId)),
        );
      expect(rows).toHaveLength(1);
    });

    it('removes an attached mistake, and a repeated remove is a safe no-op', async () => {
      const { tradeId } = await createTradeWithRule();
      const mistakeTypeId = await canonicalMistakeTypeId();
      await attachTradeMistake(workspaceId, actorUserId, tradeId, mistakeTypeId, null);

      const removed = await removeTradeMistake(workspaceId, actorUserId, tradeId, mistakeTypeId);
      expect(removed).toMatchObject({ ok: true, alreadyRemoved: false });
      const repeat = await removeTradeMistake(workspaceId, actorUserId, tradeId, mistakeTypeId);
      expect(repeat).toMatchObject({ ok: true, alreadyRemoved: true });

      const rows = await db
        .select()
        .from(tradeMistakes)
        .where(
          and(eq(tradeMistakes.tradeId, tradeId), eq(tradeMistakes.mistakeTypeId, mistakeTypeId)),
        );
      expect(rows).toHaveLength(0);
    });

    it('rejects a not-found mistake type id', async () => {
      const { tradeId } = await createTradeWithRule();
      const result = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        crypto.randomUUID(),
        null,
      );
      expect(result).toMatchObject({ ok: false, code: 'mistake_type_not_found' });
    });

    it('rejects a custom mistake type belonging to a different workspace', async () => {
      const { tradeId } = await createTradeWithRule();
      const [customType] = await db
        .insert(mistakeTypes)
        .values({
          workspaceId: otherWorkspaceId,
          key: `custom-${crypto.randomUUID()}`,
          label: 'Custom mistake from another workspace',
          severity: 'minor',
          defaultWeight: '0.1500',
          isSystem: false,
        })
        .returning({ id: mistakeTypes.id });
      if (customType === undefined) throw new Error('failed to insert custom mistake type');

      const result = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        customType.id,
        null,
      );
      expect(result).toMatchObject({ ok: false, code: 'mistake_type_not_usable' });
    });

    it('is denied/not-found on a soft-deleted Trade', async () => {
      const { tradeId } = await createTradeWithRule();
      const mistakeTypeId = await canonicalMistakeTypeId();
      await softDeleteTrade(workspaceId, actorUserId, tradeId);

      const attach = await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        mistakeTypeId,
        null,
      );
      expect(attach).toMatchObject({ ok: false, code: 'trade_not_found' });
      const remove = await removeTradeMistake(workspaceId, actorUserId, tradeId, mistakeTypeId);
      expect(remove).toMatchObject({ ok: false, code: 'trade_not_found' });
    });

    it('emits trade.mistake_added / trade.mistake_removed with identifiers only, never the note', async () => {
      const { tradeId } = await createTradeWithRule();
      const mistakeTypeId = await canonicalMistakeTypeId();
      await attachTradeMistake(
        workspaceId,
        actorUserId,
        tradeId,
        mistakeTypeId,
        'a secret note never audited',
      );
      await removeTradeMistake(workspaceId, actorUserId, tradeId, mistakeTypeId);

      const addedEvents = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.mistake_added'), eq(auditLogs.entityId, tradeId)));
      expect(addedEvents).toHaveLength(1);
      expect(addedEvents[0]?.metadata).toEqual({ tradeId, mistakeTypeId });
      expect(JSON.stringify(addedEvents[0]?.metadata)).not.toContain('secret note');

      const removedEvents = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'trade.mistake_removed'), eq(auditLogs.entityId, tradeId)));
      expect(removedEvents).toHaveLength(1);
      expect(removedEvents[0]?.metadata).toEqual({ tradeId, mistakeTypeId });
    });
  });

  // -------------------------------------------------------------------------
  // Authorization (shared helper reuse proof)
  // -------------------------------------------------------------------------
  describe("authorization reuses trade-management's shared context", () => {
    it('denies rule-check/mistake mutations under a read_only workspace', async () => {
      const user = await createUser(db, 'p08b-disc-ro');
      const ws = await createWorkspace(db, user);
      allWorkspaceIds.push(ws);
      const fw = await createFramework(db, ws, user);
      const ruleKey = crypto.randomUUID();
      const rule = await createStrategyRule(ws, user, fw.strategyId, {
        ruleKey,
        category: 'entry',
        title: 'Rule',
      });
      if (!rule.ok) throw new Error('rule creation failed');
      const created = await createTrade(ws, user, basePlanInput(fw));
      if (!created.ok) throw new Error('create failed');

      await db
        .update(workspaceEntitlements)
        .set({
          status: 'canceled',
          currentPeriodStartedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          currentPeriodEndsAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        })
        .where(eq(workspaceEntitlements.workspaceId, ws));

      const ruleResult = await updateTradeRuleCheck(ws, user, created.tradeId, ruleKey, 'followed');
      expect(ruleResult).toMatchObject({ ok: false, code: 'read_only_workspace' });

      const mistakeTypeId = await canonicalMistakeTypeId();
      const attachResult = await attachTradeMistake(ws, user, created.tradeId, mistakeTypeId, null);
      expect(attachResult).toMatchObject({ ok: false, code: 'read_only_workspace' });
    });
  });
});
