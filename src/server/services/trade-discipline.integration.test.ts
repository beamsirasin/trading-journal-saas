import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createConditionSetToken } from '@/lib/setup-conditions/condition-set-token';
import {
  auditLogs,
  emotionTypes,
  mistakeTypes,
  tradeEmotions,
  tradeMistakes,
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
  attachTradeMistake,
  removeTradeMistake,
  replaceTradeEmotions,
  updateTradeReviewNotes,
  updateTradeRuleCheck,
} from './trade-discipline';
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
  // Phase 13D Emotion and post-trade reflection corrections
  // -------------------------------------------------------------------------
  describe('Emotion and post-trade review corrections', () => {
    beforeAll(async () => {
      // The earlier discipline cases intentionally create one active account
      // per isolated framework. Archive those completed fixtures so this
      // later domain group does not trip the Professional plan's 15-account
      // entitlement limit for a reason unrelated to Emotions.
      await db
        .update(tradingAccounts)
        .set({ isArchived: true })
        .where(eq(tradingAccounts.workspaceId, workspaceId));
    });

    it('creates Emotion links atomically from canonical keys and records the zero/nonzero marker', async () => {
      const fw = await createFramework(db, workspaceId, actorUserId);
      const input = basePlanInput(fw, { emotionKeys: ['calm', 'fomo'] });
      const created = await createTrade(workspaceId, actorUserId, input);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const links = await db
        .select({ emotionTypeId: tradeEmotions.emotionTypeId, key: emotionTypes.key })
        .from(tradeEmotions)
        .innerJoin(emotionTypes, eq(emotionTypes.id, tradeEmotions.emotionTypeId))
        .where(eq(tradeEmotions.tradeId, created.tradeId));
      expect(links.map((row) => row.key).sort()).toEqual(['calm', 'fomo']);
      await expect(
        db.insert(tradeEmotions).values({
          tradeId: created.tradeId,
          workspaceId,
          emotionTypeId: links[0]!.emotionTypeId,
        }),
      ).rejects.toThrow();
      expect(await createTrade(workspaceId, actorUserId, input)).toMatchObject({
        ok: true,
        tradeId: created.tradeId,
        alreadyCreated: true,
      });
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, created.tradeId)),
      ).toHaveLength(2);
      const row = await db.query.trades.findFirst({
        where: eq(trades.id, created.tradeId),
      });
      expect(row?.emotionsRecordedAt).toBeInstanceOf(Date);
    });

    it('rejects duplicate and unknown keys without leaving a Trade behind', async () => {
      const fw = await createFramework(db, workspaceId, actorUserId);
      for (const emotionKeys of [['calm', 'calm'], ['invented']]) {
        const mutationKey = crypto.randomUUID();
        const result = await createTrade(
          workspaceId,
          actorUserId,
          basePlanInput(fw, { mutationKey, emotionKeys }),
        );
        expect(result.ok).toBe(false);
        const row = await db.query.trades.findFirst({
          where: and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, mutationKey)),
        });
        expect(row).toBeUndefined();
      }
    });

    it('rejects an archived canonical Emotion authoritatively without creating a Trade', async () => {
      const fw = await createFramework(db, workspaceId, actorUserId);
      await db
        .update(emotionTypes)
        .set({ isArchived: true })
        .where(eq(emotionTypes.key, 'frustrated'));
      try {
        const mutationKey = crypto.randomUUID();
        expect(
          await createTrade(
            workspaceId,
            actorUserId,
            basePlanInput(fw, { mutationKey, emotionKeys: ['frustrated'] }),
          ),
        ).toMatchObject({ ok: false, code: 'emotion_type_not_usable' });
        expect(
          await db.query.trades.findFirst({
            where: and(eq(trades.workspaceId, workspaceId), eq(trades.mutationKey, mutationKey)),
          }),
        ).toBeUndefined();
      } finally {
        await db
          .update(emotionTypes)
          .set({ isArchived: false })
          .where(eq(emotionTypes.key, 'frustrated'));
      }
    });

    it('records a new zero-Emotion Trade distinctly from a historical not-recorded row', async () => {
      const fw = await createFramework(db, workspaceId, actorUserId);
      const created = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { emotionKeys: [] }),
      );
      if (!created.ok) throw new Error(`create failed: ${created.code}`);
      const current = await db.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      expect(current?.emotionsRecordedAt).toBeInstanceOf(Date);
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, created.tradeId)),
      ).toHaveLength(0);

      // Existing pre-0012 rows receive no backfill; NULL plus zero links is
      // the persisted historical "not recorded" shape.
      await db
        .update(trades)
        .set({ emotionsRecordedAt: null })
        .where(eq(trades.id, created.tradeId));
      const historical = await db.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      expect(historical?.emotionsRecordedAt).toBeNull();
    });

    it('database-enforces foreign custom-Emotion isolation and Workspace cascade', async () => {
      const { tradeId } = await createTradeWithRule();
      const [foreignType] = await db
        .insert(emotionTypes)
        .values({
          workspaceId: otherWorkspaceId,
          key: `custom-${crypto.randomUUID()}`,
          label: 'Foreign custom emotion',
          isSystem: false,
        })
        .returning({ id: emotionTypes.id });
      if (foreignType === undefined) throw new Error('custom Emotion insert failed');
      await expect(
        db.insert(tradeEmotions).values({
          tradeId,
          workspaceId,
          emotionTypeId: foreignType.id,
        }),
      ).rejects.toThrow();

      const user = await createUser(db, 'p13d-cascade');
      const ws = await createWorkspace(db, user);
      allWorkspaceIds.push(ws);
      const fw = await createFramework(db, ws, user);
      const created = await createTrade(ws, user, basePlanInput(fw, { emotionKeys: ['calm'] }));
      if (!created.ok) throw new Error(`create failed: ${created.code}`);
      await db.delete(workspaces).where(eq(workspaces.id, ws));
      expect(
        await db.select().from(tradeEmotions).where(eq(tradeEmotions.tradeId, created.tradeId)),
      ).toHaveLength(0);
    });

    it('atomically replaces Emotions, supports a recorded zero, saves review notes, and audits no content', async () => {
      const fw = await createFramework(db, workspaceId, actorUserId);
      const created = await createTrade(
        workspaceId,
        actorUserId,
        basePlanInput(fw, { emotionKeys: ['fearful'] }),
      );
      if (!created.ok) throw new Error(`create failed: ${created.code}`);

      expect(
        await replaceTradeEmotions(workspaceId, actorUserId, created.tradeId, ['calm', 'focused']),
      ).toEqual({ ok: true });
      expect(await replaceTradeEmotions(workspaceId, actorUserId, created.tradeId, [])).toEqual({
        ok: true,
      });
      const links = await db
        .select()
        .from(tradeEmotions)
        .where(eq(tradeEmotions.tradeId, created.tradeId));
      expect(links).toHaveLength(0);

      const secret = 'private review content';
      expect(
        await updateTradeReviewNotes(workspaceId, actorUserId, created.tradeId, secret),
      ).toEqual({ ok: true, reviewNotes: secret });
      expect(
        await updateTradeReviewNotes(workspaceId, actorUserId, created.tradeId, 'corrected review'),
      ).toEqual({ ok: true, reviewNotes: 'corrected review' });
      const row = await db.query.trades.findFirst({ where: eq(trades.id, created.tradeId) });
      expect(row?.reviewNotes).toBe('corrected review');
      expect(row?.emotionsRecordedAt).toBeInstanceOf(Date);

      const events = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.entityId, created.tradeId));
      expect(events.map((event) => event.action)).toEqual(
        expect.arrayContaining(['trade.emotions_corrected', 'trade.corrected']),
      );
      expect(JSON.stringify(events)).not.toContain(secret);
    });

    it('rejects Emotion and review correction in a read-only Workspace', async () => {
      const user = await createUser(db, 'p13d-reflection-ro');
      const ws = await createWorkspace(db, user);
      allWorkspaceIds.push(ws);
      const fw = await createFramework(db, ws, user);
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
      expect(await replaceTradeEmotions(ws, user, created.tradeId, ['calm'])).toMatchObject({
        ok: false,
        code: 'read_only_workspace',
      });
      expect(await updateTradeReviewNotes(ws, user, created.tradeId, 'blocked')).toMatchObject({
        ok: false,
        code: 'read_only_workspace',
      });
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
